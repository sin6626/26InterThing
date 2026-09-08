const mqttClient = require("../mqtt")
const { buildDeviceCommandEnvelope } = require("../mqtt/commandMapper")
const { resolveCommandTimeoutSeconds, waitForPublish } = require("../mqtt/publishTimeout")
const directHistoryRepository = require("../repositories/directHistoryRepository")
const directRepository = require("../repositories/directRepository")
const { buildTree } = require("../utils/directTree")
const { createTimeSyncService } = require("./timeSyncService")
const { isPidConfig, readControlParams, validateControlParams, canonicalTopic } = require('./pidControlConfig')
const isLocalTemperatureConfig = topic => isPidConfig(topic) || topic === 'target_temperature'

const validateConfigUpdate = async (config, value, dNo) => {
  const { DEFAULT_CONTROL_PARAMS } = require('./waterControlEngine')
  if (!config || !(canonicalTopic(config.topic) in DEFAULT_CONTROL_PARAMS)) return
  const validate = (rows) => {
    const updated = rows.map(row => row.id === config.id ? { ...row, value } : row)
    const error = validateControlParams(readControlParams(updated, DEFAULT_CONTROL_PARAMS))
    if (error) throw new Error(error)
  }
  if (dNo) validate(await directRepository.getDeviceConfigRows(dNo))
  else {
    validate(await directRepository.getGlobalConfigRows())
    for (const device of await directRepository.getAllDeviceNumbers()) {
      const rows = await directRepository.getDeviceConfigRows(device)
      // 有设备覆盖时，该设备的有效值不随全局默认值变化。
      if (rows.find(row => row.id === config.id)?.device_value == null) validate(rows)
    }
  }
}

const saveLocalConfigHistory = async (config, newValue, oldValue, dNo) => {
  const engine = require('./waterControlEngine')
  const devices = dNo ? [dNo] : await directRepository.getAllDeviceNumbers()
  for (const device of devices) {
    engine.invalidateConfig(device)
    const { params } = await engine.loadDeviceControlConfig(device)
    await engine.checkControlConfiguration(device, params)
    engine.notifyStatusChange(device)
  }
  await directHistoryRepository.insertDirectHistory({
    config_id: config.id, d_no: dNo, direct_name: config.t_name, direct_type: config.topic,
    new_value: newValue, old_value: oldValue, result: 'success', remark: '应用层控温参数保存（无需MQTT下发）',
  })
}

// 指令服务层：
// 负责“读指令树、写数据库、下发 MQTT”。当前不使用心跳状态拦截指令。
const timeSyncService = createTimeSyncService({ mqttClient })

const normalizeValue = (value, fType) => {
  // 页面控件值需要先转成数据库里统一保存的字符串形态。
  if (fType === "1") return value ? "on" : "off"
  if (fType === "6" && Array.isArray(value)) return value.join(",")
  return value
}

const getDirectTrees = async (dNo) => {
  // 同时拉全局配置树和设备个性化配置树，前端页面会并排展示。
  const [globalRows, deviceRows] = await Promise.all([
    directRepository.getGlobalConfigRows(),
    directRepository.getDeviceConfigRows(dNo),
  ])

  return {
    globalTree: buildTree(globalRows),
    deviceTree: buildTree(deviceRows),
  }
}

const publishCommand = async (dNo, commandEnvelope) => {
  const configRows = await directRepository.getDeviceConfigRows(dNo)
  const timeoutSeconds = resolveCommandTimeoutSeconds(configRows)
  return waitForPublish(
    mqttClient.publishToDevice(commandEnvelope.topic, commandEnvelope.payload),
    timeoutSeconds,
  )
}

const beginControlCommand = (dNo, config, value) => {
  const waterControlEngine = require("./waterControlEngine")
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  const desiredKey = config?.topic === "pump"
    ? "desiredPumpState"
    : (config?.topic === "heater" ? "desiredHeaterState" : null)
  const previousDesired = desiredKey ? state[desiredKey] : null
  const startedAt = new Date().toISOString()
  if (desiredKey) state[desiredKey] = value
  state.lastCommandStatus = {
    topic: config?.topic || "unknown",
    value,
    status: "pending",
    startedAt,
  }
  waterControlEngine.notifyStatusChange(dNo)
  return {
    desiredKey,
    previousDesired,
    startedAt,
    state,
    topic: config?.topic || "unknown",
    value,
    waterControlEngine,
  }
}

const finishControlCommand = (context, status, error = null) => {
  if (status === "failed" && context.desiredKey) {
    context.state[context.desiredKey] = context.previousDesired
  }
  context.state.lastCommandStatus = {
    topic: context.topic,
    value: context.value,
    status,
    error: error?.message,
    startedAt: context.startedAt,
    finishedAt: new Date().toISOString(),
  }
  context.waterControlEngine.notifyStatusChange(context.state.deviceId)
}

const dispatchGlobalCommand = async (config, value) => {
  // 全局指令的含义是“对所有设备都生效”，所以这里要遍历所有设备编号。
  const deviceNumbers = await directRepository.getAllDeviceNumbers()

  const results = []
  for (const dNo of deviceNumbers) {
    if (['heater', 'pump'].includes(config?.topic)) {
      try {
        await require('./waterControlEngine').executeManualAction(dNo, config.topic, value)
        results.push({ dNo, status: 'published' })
      } catch (error) { results.push({ dNo, status: 'failed', error: error.message }) }
      continue
    }
    const commandContext = beginControlCommand(dNo, config, value)
    try {
      // 先把页面/数据库里的值翻译成设备端真正认识的 payload。
      const commandEnvelope = buildDeviceCommandEnvelope({
        d_no: dNo,
        config_id: config?.id,
        topic: config?.topic,
        publish_topic: config?.publish_topic,
        payload_template: config?.payload_template,
        value_map: config?.value_map,
        value,
      })

      await publishCommand(dNo, commandEnvelope)
      finishControlCommand(commandContext, "success")
      results.push({ dNo, status: "published" })
    } catch (error) {
      finishControlCommand(commandContext, "failed", error)
      results.push({ dNo, status: "failed", error: error.message })
    }
  }

  console.log(`全局指令处理完成：${results.filter((item) => item.status === "published").length} 台已发布，${results.filter((item) => item.status === "failed").length} 台发布失败`)
  return results
}

const updateGlobalDirect = async ({ config_id, f_type, value }) => {
  // 先写数据库，保证页面刷新后能看到最新值；
  // MQTT 下发作为异步副作用继续执行。
  const newValue = normalizeValue(value, f_type)
  const [oldValue, config] = await Promise.all([
    directRepository.getGlobalDirectValue(config_id),
    directRepository.getDirectConfigById(config_id),
  ])

  await validateConfigUpdate(config, newValue, null)

  if (['heater', 'pump'].includes(config?.topic)) {
    const results = await dispatchGlobalCommand(config, newValue)
    const failed = results.filter(result => result.status !== 'published')
    if (failed.length) throw new Error(failed.map(result => `${result.dNo}: ${result.error}`).join('；'))
    await directRepository.upsertGlobalDirect(config_id, newValue)
    return
  }

  await directRepository.upsertGlobalDirect(config_id, newValue)
  if (isLocalTemperatureConfig(config?.topic)) return saveLocalConfigHistory(config, newValue, oldValue)

  // 如果更新的是主控制模式(config_id=0 或 topic=master)，同步更新单设备表中的记录，避免单设备残留旧值覆盖全局
  if (config?.topic === "master" || String(config_id) === "0") {
    try {
      const { query } = require("../repositories/query")
      await query("UPDATE t_direct SET value = ? WHERE config_id = ?", [newValue, config_id])
    } catch {}
  }

  if (!config) return

  try {
    const waterControlEngine = require("./waterControlEngine")
    const deviceNumbers = await directRepository.getAllDeviceNumbers()
    const stopErrors = []
    for (const dNo of deviceNumbers) {
      const state = waterControlEngine.getOrCreateDeviceState(dNo)
      if (config.topic === "master" || String(config_id) === "0") {
        waterControlEngine.invalidateConfig(dNo)
        state.mode = newValue === "on" ? "auto" : "manual"
        if (newValue === "off") {
          try {
            await waterControlEngine.stopAuto(dNo)
          } catch (error) {
            stopErrors.push({ dNo, error: error.message })
          }
        }
      }
      waterControlEngine.notifyStatusChange(dNo)
    }

    const dispatchResults = await dispatchGlobalCommand(config, newValue)
    const failedResults = dispatchResults.filter((item) => item.status !== "published")
    if (failedResults.length || stopErrors.length) {
      const publishSummary = failedResults
        .map((item) => `${item.dNo}: ${item.error || "未发布"}`)
        .join("；")
      const stopSummary = stopErrors
        .map((item) => `${item.dNo}: 停止流程失败(${item.error})`)
        .join("；")
      throw new Error(`部分设备控制失败: ${[stopSummary, publishSummary].filter(Boolean).join("；")}`)
    }
    await directHistoryRepository.insertDirectHistory({
      config_id,
      direct_name: config.t_name,
      direct_type: config.topic || "global",
      new_value: newValue,
      old_value: oldValue,
      result: "success",
      remark: "应用层下发；MQTT发布成功",
    })
  } catch (error) {
    await directHistoryRepository.insertDirectHistory({
      config_id,
      direct_name: config.t_name,
      direct_type: config.topic || "global",
      new_value: newValue,
      old_value: oldValue,
      result: "failed",
      remark: `应用层下发失败: ${error.message}`,
    })
    throw error
  }
}

const dispatchDeviceCommand = async (dNo, configId, newValue) => {
  // 单设备指令比全局指令少一步“遍历所有设备”，其他思路一致。
  const config = await directRepository.getDirectConfigById(configId)
  if (!config) {
    throw new Error("未找到对应的指令配置")
  }
  if (['heater', 'pump'].includes(config.topic)) return require('./waterControlEngine').executeManualAction(dNo, config.topic, newValue)

  const commandEnvelope = buildDeviceCommandEnvelope({
    d_no: dNo,
    config_id: configId,
    topic: config.topic,
    publish_topic: config.publish_topic,
    payload_template: config.payload_template,
    value_map: config.value_map,
    value: newValue,
  })
  const commandContext = beginControlCommand(dNo, config, newValue)

  try {
    await publishCommand(dNo, commandEnvelope)
    finishControlCommand(commandContext, "success")
  } catch (error) {
    finishControlCommand(commandContext, "failed", error)
    throw error
  }
  return { status: "published" }
}

const updateDeviceDirect = async (dNo, { config_id, f_type, value }) => {
  // 单设备值存在就 update，不存在就 insert。
  const newValue = normalizeValue(value, f_type)
  const [oldValue, config] = await Promise.all([
    directRepository.getDeviceDirectValue(config_id, dNo),
    directRepository.getDirectConfigById(config_id),
  ])
  await validateConfigUpdate(config, newValue, dNo)
  if (['heater', 'pump'].includes(config?.topic)) {
    await require('./waterControlEngine').executeManualAction(dNo, config.topic, newValue)
    const result = await directRepository.updateDeviceDirectValue(config_id, newValue, dNo)
    if (result.affectedRows === 0) await directRepository.insertDeviceDirectValue(config_id, newValue, dNo)
    return
  }
  if ((config?.topic === 'master' || String(config_id) === '0') && newValue === 'off') await require('./waterControlEngine').stopAuto(dNo)

  const results = await directRepository.updateDeviceDirectValue(config_id, newValue, dNo)

  if (results.affectedRows === 0) {
    await directRepository.insertDeviceDirectValue(config_id, newValue, dNo)
  }
  if (isLocalTemperatureConfig(config?.topic)) return saveLocalConfigHistory(config, newValue, oldValue, dNo)

  try {
    const dispatchResult = await dispatchDeviceCommand(dNo, config_id, newValue)
    if (dispatchResult.status !== "published") {
      throw new Error("MQTT指令未发布")
    }
    const waterControlEngine = require("./waterControlEngine")
    const state = waterControlEngine.getOrCreateDeviceState(dNo)
    if (config?.topic === "master" || String(config_id) === "0") {
      waterControlEngine.invalidateConfig(dNo)
      state.mode = newValue === "on" ? "auto" : "manual"
      if (newValue === "off") await waterControlEngine.stopAuto(dNo)
    }
    waterControlEngine.notifyStatusChange(dNo)

    await directHistoryRepository.insertDirectHistory({
      config_id,
      d_no: dNo,
      direct_name: config?.t_name,
      direct_type: config?.topic || "device",
      new_value: newValue,
      old_value: oldValue,
      result: "success",
      remark: "应用层下发；MQTT发布成功",
    })
  } catch (error) {
    await directHistoryRepository.insertDirectHistory({
      config_id,
      d_no: dNo,
      direct_name: config?.t_name,
      direct_type: config?.topic || "device",
      new_value: newValue,
      old_value: oldValue,
      result: "failed",
      remark: `应用层下发失败: ${error.message}`,
    })
    throw error
  }
}

const updateTime = async (time) => {
  // 手动时间同步本质上也是一条“特殊指令”，只是 topic 固定为时间同步主题。
  await timeSyncService.updateTime(time)
  await directHistoryRepository.insertDirectHistory({
    direct_name: "时间同步",
    direct_type: "time_sync",
    new_value: time || "当前时间",
    remark: "应用层下发",
  })
}

const getDirectHistory = async (query) => {
  const result = await directHistoryRepository.getDirectHistory(query)
  return {
    status: 0,
    message: "查询成功",
    data: result.rows,
    total: result.total,
  }
}

const getDirectTypes = async () => {
  const rows = await directRepository.getDirectTypes()
  return {
    status: 0,
    message: "查询成功",
    data: [
      ...rows,
      { value: "time_sync", label: "时间同步" },
    ],
  }
}

const startWaterControl = async (dNo) => {
  const waterControlEngine = require("./waterControlEngine")
  const rootConfig = (await directRepository.getDeviceConfigRows(dNo))
    .find((config) => config.topic === "master")
  const rootConfigId = rootConfig?.id
  const [previousGlobalValue, previousDeviceValue] = await Promise.all([
    rootConfigId === undefined ? Promise.resolve(null) : directRepository.getGlobalDirectValue(rootConfigId),
    dNo && rootConfigId !== undefined
      ? directRepository.getDeviceDirectValue(rootConfigId, dNo)
      : Promise.resolve(null),
  ])
  if (rootConfigId === undefined) throw new Error("未配置水循环控制模式")

  await directRepository.upsertGlobalDirect(rootConfigId, "on")
  if (dNo) await directRepository.updateDeviceDirectValue(rootConfigId, "on", dNo)
  waterControlEngine.invalidateConfig(dNo)

  try {
    return await waterControlEngine.startAuto(dNo)
  } catch (error) {
    await directRepository.upsertGlobalDirect(rootConfigId, previousGlobalValue ?? "off")
    if (dNo) {
      await directRepository.updateDeviceDirectValue(
        rootConfigId,
        previousDeviceValue ?? previousGlobalValue ?? "off",
        dNo,
      )
    }
    throw error
  }
}

const stopWaterControl = async (dNo) => {
  const waterControlEngine = require("./waterControlEngine")
  return waterControlEngine.stopAuto(dNo)
}

const resetWaterControlFault = async (dNo, confirmed) => {
  if (confirmed !== true) throw new Error("故障复位必须经过用户确认")
  const waterControlEngine = require("./waterControlEngine")
  return waterControlEngine.resetFault(dNo)
}

const getWaterControlStatus = (dNo) => {
  const waterControlEngine = require("./waterControlEngine")
  return waterControlEngine.getDeviceControlStatus(dNo)
}

module.exports = {
  dispatchDeviceCommand,
  getDirectHistory,
  getDirectTrees,
  getDirectTypes,
  getWaterControlStatus,
  resetWaterControlFault,
  startWaterControl,
  stopWaterControl,
  updateDeviceDirect,
  updateGlobalDirect,
  updateTime,
}
