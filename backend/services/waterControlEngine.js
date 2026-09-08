const { buildDeviceCommandEnvelope } = require("../mqtt/commandMapper")
const { waitForPublish } = require("../mqtt/publishTimeout")
const { performance } = require('node:perf_hooks')
const { createTimeProportionPid } = require('./timeProportionPid')
const { PID_DEFAULTS, readControlParams, validateControlParams, controlFingerprint } = require('./pidControlConfig')
const {
  evaluateHydraulicStatus,
  getDeviceDiagnosis,
  lockFaultDiagnosis,
  resetDeviceDiagnosis,
} = require("./hydraulicDiagnosisService")
const {
  ensureErrorMessageMappings,
  getRuleErrorMapping,
} = require("./errorMessageMapping")

const DEFAULT_CONTROL_PARAMS = {
  ...PID_DEFAULTS,
  target_temperature: 35.0,
  temperature_hysteresis: 0.5,
  min_safe_flow: 0.5,
  max_safe_pressure: 150.0,
  max_safe_temperature: 45.0,
  build_flow_timeout: 5,
  low_flow_confirm_time: 2,
  cooling_delay: 10,
  data_timeout: 3,
  command_timeout: 2,
  min_operating_pressure: 20.0,
  pressure_flow_diagnosis_confirm_time: 2.0,
  temperature_rate_window: 60,
  temp_reversed_confirm_time: 5,
  dry_heating_timeout: 15,
  dry_heating_temp_diff: 0.2,
}

const FSM_STATES = {
  STOPPED: "STOPPED",
  BUILDING_FLOW: "BUILDING_FLOW",
  RUNNING: "RUNNING",
  COOLING: "COOLING",
  FAULT: "FAULT",
}

const FSM_STATE_TEXT = {
  STOPPED: "已停止",
  BUILDING_FLOW: "正在建流",
  RUNNING: "自动运行中",
  COOLING: "冷却延时中",
  FAULT: "故障停机",
}

const SENSOR_FIELDS = ["temp_in", "temp_out", "flow_rate", "pressure"]
const SENSOR_LABELS = {
  temp_in: "入口温度",
  temp_out: "出口温度",
  flow_rate: "流量",
  pressure: "压力",
}

const FAULT_CODES = {
  CONTROL_CONFIG_INVALID: 'CONTROL_CONFIG_INVALID',
  BUILD_FLOW_TIMEOUT: "BUILD_FLOW_TIMEOUT",
  COMMAND_PUBLISH_FAILED: "COMMAND_PUBLISH_FAILED",
  LOW_FLOW: "LOW_FLOW",
  DRY_HEATING_NO_TEMP_RISE: "DRY_HEATING_NO_TEMP_RISE",
  OVER_PRESSURE: "OVER_PRESSURE",
  OVER_TEMPERATURE: "OVER_TEMPERATURE",
  SENSOR_FLOW_TIMEOUT: "SENSOR_FLOW_TIMEOUT",
  SENSOR_PRESSURE_TIMEOUT: "SENSOR_PRESSURE_TIMEOUT",
  SENSOR_TEMPERATURE_TIMEOUT: "SENSOR_TEMPERATURE_TIMEOUT",
  TEMP_SENSOR_REVERSED: "TEMP_SENSOR_REVERSED",
  UNKNOWN: "UNKNOWN",
}

const deviceStateMap = new Map()

let mqttClientDep = null
let broadcastDep = null
let configLoaderDep = null
let timerId = null
let monotonicClock = () => performance.now()

const getOrCreateDeviceState = (dNo) => {
  if (!deviceStateMap.has(dNo)) {
    deviceStateMap.set(dNo, {
      deviceId: dNo,
      mode: "manual",
      fsmState: FSM_STATES.STOPPED,
      fsmText: FSM_STATE_TEXT.STOPPED,
      faultCode: null,
      faultReason: null,
      countdown: 0,
      coolingExitState: FSM_STATES.STOPPED,
      lowFlowStartTime: 0,
      tempReversedStartTime: 0,
      dryHeatingStartTime: 0,
      dryHeatingBaseTemp: null,
      dryHeatingAccumulatedMs: 0,
      dryHeatingLastActiveTime: 0,
      dryHeatingLastDeactiveTime: 0,
      zeroStartTime: {
        temp_in: 0,
        temp_out: 0,
        flow_rate: 0,
        pressure: 0,
      },
      lastSensors: {
        temp_in: null,
        temp_out: null,
        flow_rate: null,
        pressure: null,
        c_time: null,
      },
      sensorUpdatedAt: {
        temp_in: 0,
        temp_out: 0,
        flow_rate: 0,
        pressure: 0,
      },
      lastSensorTime: 0,
      dataTimeoutSeconds: DEFAULT_CONTROL_PARAMS.data_timeout,
      pumpState: "off",
      heaterState: "off",
      desiredPumpState: "off",
      desiredHeaterState: "off",
      lastCommandStatus: null,
      generation: 0,
      heatInhibited: false,
      actionTail: Promise.resolve(),
      published: {},
      failedActionAt: {},
      pidController: createTimeProportionPid({ clock: () => monotonicClock() }),
      pid: null,
      sensorSample: 0,
      controlStrategy: 'hysteresis',
      configError: null,
      configFingerprint: null,
      restartReason: null,
      protectionStopPump: false,
      lastHeaterOff: monotonicClock(),
      manualPumpTracking: {
        startedAt: 0,
        flowEstablished: false,
        protecting: false,
      },
    })
  }
  return deviceStateMap.get(dNo)
}

const loadDeviceControlConfig = async (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  if (typeof configLoaderDep !== 'function' && state.configCache && monotonicClock() - state.configCachedAt < 1000) return state.configCache
  let rows = []
  state.configLoadError = null
  if (typeof configLoaderDep === "function") {
    rows = await configLoaderDep(dNo)
  } else {
    try {
      const directRepository = require("../repositories/directRepository")
      rows = await directRepository.getDeviceConfigRows(dNo)
    } catch (error) {
      console.error(`[WaterControl] 读取设备 ${dNo} 控制配置失败:`, error.message)
      state.configLoadError = '控制配置读取失败，禁止继续加热'
      if (state.configCache) return state.configCache
    }
  }

  const params = readControlParams(rows, DEFAULT_CONTROL_PARAMS)
  const configsByTopic = {}
  let masterMode = "manual"

  for (const row of rows) {
    if (!row.topic) continue
    configsByTopic[row.topic] = row
    if (row.topic === "master") {
      masterMode = row.value === "on" ? "auto" : "manual"
      continue
    }
  }

  state.mode = masterMode
  state.controlStrategy = params.temperature_control_strategy
  state.configError = validateControlParams(params)
  state.dataTimeoutSeconds = Number.isFinite(params.data_timeout) && params.data_timeout > 0 ? params.data_timeout : DEFAULT_CONTROL_PARAMS.data_timeout
  state.configCache = { configsByTopic, masterMode, params }
  state.configCachedAt = monotonicClock()
  return state.configCache
}

const syncAllDeviceConfigs = async () => {
  if (typeof configLoaderDep === "function") return
  try {
    const directRepository = require("../repositories/directRepository")
    const deviceNumbers = await directRepository.getAllDeviceNumbers()
    for (const dNo of deviceNumbers) await loadDeviceControlConfig(dNo)
  } catch (error) {
    console.error("[WaterControl] 同步设备控制配置失败:", error.message)
  }
}

const getMqttClient = () => {
  if (mqttClientDep) return mqttClientDep
  try {
    return require("../mqtt")
  } catch {
    return null
  }
}

const insertCommandHistory = async ({ config, dNo, topic, value, oldValue, remark, result }) => {
  if (typeof configLoaderDep === "function") return
  try {
    const directHistoryRepository = require("../repositories/directHistoryRepository")
    await directHistoryRepository.insertDirectHistory({
      config_id: config?.id,
      d_no: dNo,
      direct_name: config?.t_name || topic,
      direct_type: config?.topic || topic,
      new_value: value,
      old_value: oldValue,
      result,
      remark,
    })
  } catch (error) {
    console.error(`[WaterControl] 写入设备 ${dNo} 指令历史失败:`, error.message)
  }
}

const publishDeviceAction = async (dNo, topic, value, remark, options, generation) => {
  const state = getOrCreateDeviceState(dNo)
  if (options.manual && value === 'on' && (state.starting || [FSM_STATES.RUNNING, FSM_STATES.BUILDING_FLOW, FSM_STATES.COOLING, FSM_STATES.FAULT].includes(state.fsmState))) throw new Error('自动运行、冷却或故障期间不能手动开启，请先停止并等待流程结束')
  if (value === 'on' && generation !== state.generation) return { cancelled: true }
  if (value === 'on' && options.automatic && (state.heatInhibited || state.mode !== 'auto' || state.fsmState !== FSM_STATES.RUNNING)) return { cancelled: true }
  // 安全关闭重复发布只在失败时重试，最多每秒一次。
  if (options.protection && state.failedActionAt[topic]?.value === value
    && monotonicClock() - state.failedActionAt[topic].time < 1000) return { skipped: true }
  if (state.published[topic] === value && !options.force) return { skipped: true }
  const desiredKey = topic === "pump" ? "desiredPumpState" : "desiredHeaterState"
  const actualKey = topic === "pump" ? "pumpState" : "heaterState"
  const previousDesired = state[desiredKey]
  const startedAt = new Date().toISOString()
  let config = null
  let publishPhase = false

  try {
    // 关闭不能等待数据库；使用最近一次确认的设备模板。
    const loaded = value === 'off' && state.configCache ? state.configCache : await loadDeviceControlConfig(dNo)
    if (value === 'on' && generation !== state.generation) return { cancelled: true }
    if (options.automatic && state.configFingerprint && state.configFingerprint !== controlFingerprint(loaded.params)) return { cancelled: true }
    if (options.pidWindow !== undefined && value === 'on') {
      const schedule = state.pidController.schedule(loaded.params, state.published.heater === 'on')
      if (schedule.windowIndex !== options.pidWindow || schedule.desired !== 'on') return { cancelled: true }
    }
    if (options.manual && value === 'on' && (state.starting || [FSM_STATES.RUNNING, FSM_STATES.BUILDING_FLOW, FSM_STATES.COOLING, FSM_STATES.FAULT].includes(state.fsmState))) throw new Error('自动运行、冷却或故障期间不能手动开启，请先停止并等待流程结束')
    if (topic === 'heater' && value === 'on') {
      if (options.automatic && (state.heatInhibited || state.mode !== 'auto' || state.fsmState !== FSM_STATES.RUNNING)) return { cancelled: true }
      const safety = heaterSafetyFromConfig(state, loaded.params)
      if (!safety.safe) throw new Error(safety.reason)
      if (loaded.params.temperature_control_strategy === 'pid' && monotonicClock() - state.lastHeaterOff < loaded.params.pid_min_off_time * 1000) return { cancelled: true }
    }
    publishPhase = true
    config = loaded.configsByTopic[topic]
    if (!config) throw new Error(`未配置${topic}控制指令`)

    const commandEnvelope = buildDeviceCommandEnvelope({
      d_no: dNo,
      config_id: config.id,
      topic: config.topic,
      publish_topic: config.publish_topic,
      payload_template: config.payload_template,
      value_map: config.value_map,
      value,
    })

    const mqttClient = getMqttClient()
    if (!mqttClient || typeof mqttClient.publishToDevice !== "function") throw new Error("MQTT发布客户端不可用")
    state[desiredKey] = value
    state.lastCommandStatus = { topic, value, status: 'pending', startedAt }
    // 新消息可能已执行但PUBACK丢失，不能继续用旧成功值去重安全关闭。
    delete state.published[topic]
    const controller = new AbortController()
    try {
      await waitForPublish(mqttClient.publishToDevice(commandEnvelope.topic, commandEnvelope.payload, { single: true, signal: controller.signal }),
        Number.isFinite(loaded.params.command_timeout) && loaded.params.command_timeout > 0 ? loaded.params.command_timeout : DEFAULT_CONTROL_PARAMS.command_timeout)
    } finally { controller.abort() }
    state.published[topic] = value
    delete state.failedActionAt[topic]
    if (topic === 'heater' && value === 'off') {
      state.pidController.markOff()
      state.lastHeaterOff = monotonicClock()
    }
    if (generation === state.generation || value === 'off') state.lastCommandStatus = {
      topic,
      value,
      status: "success",
      startedAt,
      finishedAt: new Date().toISOString(),
    }
    // 历史落库不能占用执行器队列，否则数据库迟滞会阻塞安全关闭。
    void insertCommandHistory({
      config,
      dNo,
      topic,
      value,
      oldValue: state[actualKey],
      remark: `${remark}；MQTT发布成功`,
      result: "success",
    })
    return commandEnvelope
  } catch (error) {
    if (!publishPhase) throw error
    error.publishFailed = true
    state.failedActionAt[topic] = { time: monotonicClock(), value }
    if (generation === state.generation) state[desiredKey] = previousDesired
    if (generation === state.generation || value === 'off') state.lastCommandStatus = {
      topic,
      value,
      status: "failed",
      error: error.message,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
    void insertCommandHistory({
      config,
      dNo,
      topic,
      value,
      oldValue: state[actualKey],
      remark: `${remark}；MQTT发布失败: ${error.message}`,
      result: "failed",
    })
    throw error
  }
}

const executeDeviceAction = (dNo, topic, value, remark = '应用层自动控制', options = {}) => {
  const state = getOrCreateDeviceState(dNo)
  const generation = state.generation
  const action = state.actionTail.then(() => publishDeviceAction(dNo, topic, value, remark, options, generation))
  state.actionTail = action.catch(() => {})
  return action
}

const revokeHeating = (state) => {
  state.generation++
  state.heatInhibited = true
  state.desiredHeaterState = 'off'
  state.pidController.reset()
  state.pid = null
}

const executeManualAction = async (dNo, topic, value) => {
  const state = getOrCreateDeviceState(dNo)
  if (value === 'off' && (state.starting || state.fsmState !== FSM_STATES.STOPPED)) {
    await stopAuto(dNo)
    if (topic === 'heater') return { status: 'published' }
  }
  try {
    const result = await executeDeviceAction(dNo, topic, value, '手动控制', { manual: true })
    if (result?.cancelled) throw new Error('操作已取消或尚未满足最短关闭时间')
    if (topic === 'pump') {
      if (value === 'on') {
        state.manualPumpTracking.startedAt = monotonicClock()
        state.manualPumpTracking.flowEstablished = false
        state.manualPumpTracking.protecting = false
      } else {
        state.manualPumpTracking.startedAt = 0
        state.manualPumpTracking.flowEstablished = false
        state.manualPumpTracking.protecting = false
      }
    }
    notifyStatusChange(dNo)
    return { status: 'published' }
  } catch (error) {
    // 前置审查失败不改变运行状态；实际发布失败沿用故障联锁。
    if (error.publishFailed) await triggerFault(dNo, { code: FAULT_CODES.COMMAND_PUBLISH_FAILED, reason: error.message, stopPump: true })
    throw error
  }
}

const isAbnormalZero = (state, field, value) => {
  if (value === null || value === undefined) return false
  const num = Number(value)
  if (!Number.isFinite(num) || num > 0.0001) return false
  if (field === "temp_in" || field === "temp_out") {
    return true
  }
  if (field === "flow_rate" || field === "pressure") {
    const runningWithPump = state.pumpState === "on" && state.fsmState !== FSM_STATES.BUILDING_FLOW
    return runningWithPump
  }
  return false
}

const getStaleSensors = (state, now = Date.now(), timeoutSeconds = state.dataTimeoutSeconds) => {
  const timeoutMs = timeoutSeconds * 1000
  return SENSOR_FIELDS.filter((field) => {
    const updatedAt = state.sensorUpdatedAt[field]
    const zeroStart = state.zeroStartTime?.[field] || 0
    const isZeroExpired = zeroStart > 0 && (now - zeroStart > timeoutMs)
    return state.lastSensors[field] === null || !updatedAt || now - updatedAt > timeoutMs || isZeroExpired
  })
}

const getDeviceControlStatus = (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  return {
    deviceId: dNo,
    mode: state.mode,
    fsmState: state.fsmState,
    fsmText: state.fsmText,
    faultCode: state.faultCode,
    faultReason: state.faultReason,
    countdown: state.countdown,
    pumpState: state.pumpState,
    heaterState: state.heaterState,
    desiredPumpState: state.desiredPumpState,
    desiredHeaterState: state.desiredHeaterState,
    lastCommandStatus: state.lastCommandStatus,
    lastSensors: { ...state.lastSensors },
    sensorUpdatedAt: { ...state.sensorUpdatedAt },
    staleSensors: getStaleSensors(state),
    hydraulicDiagnosis: getDeviceDiagnosis(dNo),
    controlStrategy: state.controlStrategy,
    configError: state.configError,
    restartReason: state.restartReason,
    pid: state.pid ? { ...state.pid, configError: state.configError } : null,
    manualPumpTracking: { ...state.manualPumpTracking },
  }
}

const notifyStatusChange = (dNo) => {
  const state = getOrCreateDeviceState(dNo)

  let broadcast = broadcastDep
  if (!broadcast) {
    try {
      broadcast = require("../websocket").broadcastToClients
    } catch {
      broadcast = null
    }
  }

  if (typeof broadcast === "function") {
    let presence = { status: "offline", text: "离线", updated_at: null }
    try {
      const devicePresenceService = require("./devicePresenceService")
      presence = devicePresenceService.getDevicePresenceSync(dNo)
    } catch {}

    broadcast("device_status", {
      d_no: dNo,
      status: presence.status,
      vstatus: null,
      level: state.fsmState === FSM_STATES.FAULT ? "error" : (presence.status === "online" ? "normal" : "unknown"),
      text: state.fsmState === FSM_STATES.FAULT ? (state.faultReason || "设备故障") : presence.text,
      updated_at: presence.updated_at || new Date().toLocaleString(),
      control: getDeviceControlStatus(dNo),
    })
  }
}

const recordFault = async (dNo, faultCode, reason, extraHydraulicDiagnosis = null) => {
  const nowTime = new Date().toLocaleString()
  console.warn(`[WaterControl][${faultCode}] 设备 ${dNo}: ${reason}`)

  // 1. 确定后台规则反查的 key：若存在具体水力联合诊断（过程一~四），优先以水力诊断代码为准
  const hydraulicDiagnosis = extraHydraulicDiagnosis || getDeviceDiagnosis(dNo)
  let ruleKey = faultCode
  if (hydraulicDiagnosis && [
    "HYDRAULIC_BLOCKAGE",
    "HYDRAULIC_PUMP_ABNORMAL",
    "HYDRAULIC_SENSOR_ANOMALY",
    "HYDRAULIC_LEAK_OR_BURST",
  ].includes(hydraulicDiagnosis.code)) {
    ruleKey = hydraulicDiagnosis.code
  }

  // 2. 动态读取后台 t_error_code_mapper 用户配置（带2秒内存缓存，即改即生效）
  let errorMapping = null
  try {
    errorMapping = typeof configLoaderDep === 'function'
      ? { e_no: ruleKey, type: '6', e_msg: reason }
      : await getRuleErrorMapping(ruleKey)
  } catch (err) {
    console.warn("[WaterControl] 读取错误码语义映射异常，使用兜底:", err.message)
    errorMapping = { e_no: ruleKey, type: "6", e_msg: reason }
  }

  const eNo = errorMapping.e_no || ruleKey
  const errorType = String(errorMapping.type || "6")

  // 3. 错误信息生成：以后台配置的中文描述为主，附带实测原因细节
  let finalMsg = errorMapping.e_msg || reason
  if (reason && !reason.includes(finalMsg)) {
    finalMsg = `${finalMsg} (${reason})`
  }

  if (typeof configLoaderDep !== "function") {
    try {
      const { query } = require("../repositories/query")
      await query(
        "INSERT INTO t_error_msg (d_no, c_time, e_msg, e_no, type) VALUES (?, NOW(), ?, ?, ?)",
        [dNo, finalMsg, eNo, errorType],
      )
    } catch (error) {
      console.error(`[WaterControl] 写入设备 ${dNo} 故障失败:`, error.message)
    }
  }

  let broadcast = broadcastDep
  if (!broadcast) {
    try {
      broadcast = require("../websocket").broadcastToClients
    } catch {
      broadcast = null
    }
  }
  if (typeof broadcast === "function") {
    broadcast("error_realtime", { d_no: dNo, e_no: eNo, type: errorType, e_msg: finalMsg, c_time: nowTime })
    broadcast("alarm_realtime", { d_no: dNo, code: Number(errorType) || 6, level: "error", text: finalMsg, updated_at: nowTime })
  }
}

const setFaultState = (state, faultCode, reason) => {
  state.fsmState = FSM_STATES.FAULT
  state.fsmText = FSM_STATE_TEXT.FAULT
  state.faultCode = faultCode
  state.faultReason = reason
  state.countdown = 0
  state.lowFlowStartTime = 0
  state.coolingExitState = FSM_STATES.STOPPED
}

const triggerFault = async (dNo, faultOrReason, options = {}) => {
  const state = getOrCreateDeviceState(dNo)
  revokeHeating(state)
  const fault = typeof faultOrReason === "string"
    ? { code: FAULT_CODES.UNKNOWN, reason: faultOrReason }
    : faultOrReason
  const stopPump = options.stopPump ?? fault.stopPump ?? true
  state.protectionStopPump = stopPump

  const hydraulicDiagnosis = options.hydraulicDiagnosis || getDeviceDiagnosis(dNo)
  if (hydraulicDiagnosis) {
    lockFaultDiagnosis(dNo, hydraulicDiagnosis)
  }

  setFaultState(state, fault.code || FAULT_CODES.UNKNOWN, fault.reason || "未知故障")

  const actionErrors = []
  try {
    await executeDeviceAction(dNo, "heater", "off", `故障保护: ${state.faultReason}`, { protection: true })
  } catch (error) {
    actionErrors.push(`关闭加热失败: ${error.message}`)
  }
  if (stopPump) {
    try {
      await executeDeviceAction(dNo, "pump", "off", `故障保护: ${state.faultReason}`, { protection: true })
    } catch (error) {
      actionErrors.push(`关闭水泵失败: ${error.message}`)
    }
  }
  if (actionErrors.length) state.faultReason = `${state.faultReason}；${actionErrors.join("；")}`
  await recordFault(dNo, state.faultCode, state.faultReason)
  notifyStatusChange(dNo)
}

const formatStaleSensors = (fields) => fields.map((field) => SENSOR_LABELS[field] || field).join("、")

const getSensorFault = (staleSensors) => {
  if (staleSensors.includes("flow_rate")) {
    return { code: FAULT_CODES.SENSOR_FLOW_TIMEOUT, reason: `流量传感器数据超时或无效: ${formatStaleSensors(staleSensors)}`, stopPump: true }
  }
  if (staleSensors.includes("pressure")) {
    return { code: FAULT_CODES.SENSOR_PRESSURE_TIMEOUT, reason: `压力传感器数据超时或无效: ${formatStaleSensors(staleSensors)}`, stopPump: true }
  }
  return { code: FAULT_CODES.SENSOR_TEMPERATURE_TIMEOUT, reason: `温度传感器数据超时或无效: ${formatStaleSensors(staleSensors)}`, stopPump: false }
}

const updateNumericSensor = (state, rawData, field, fallbackField, now, timeoutSeconds = state.dataTimeoutSeconds) => {
  const hasPrimary = Object.prototype.hasOwnProperty.call(rawData, field)
  const hasFallback = fallbackField && Object.prototype.hasOwnProperty.call(rawData, fallbackField)
  if (!hasPrimary && !hasFallback) return
  const rawValue = hasPrimary ? rawData[field] : rawData[fallbackField]
  const parsedValue = typeof rawValue === "number"
    ? rawValue
    : (typeof rawValue === "string" && rawValue.trim() !== "" ? Number(rawValue) : Number.NaN)

  if (!state.zeroStartTime) {
    state.zeroStartTime = { temp_in: 0, temp_out: 0, flow_rate: 0, pressure: 0 }
  }

  if (Number.isFinite(parsedValue)) {
    if (isAbnormalZero(state, field, parsedValue)) {
      if (!state.zeroStartTime[field]) {
        state.zeroStartTime[field] = now
      }
      const timeoutMs = timeoutSeconds * 1000
      if (now - state.zeroStartTime[field] > timeoutMs) {
        state.lastSensors[field] = null
        state.sensorUpdatedAt[field] = 0
      } else {
        state.lastSensors[field] = parsedValue
        state.sensorUpdatedAt[field] = now
      }
    } else {
      state.zeroStartTime[field] = 0
      state.lastSensors[field] = parsedValue
      state.sensorUpdatedAt[field] = now
    }
  } else {
    state.zeroStartTime[field] = 0
    state.lastSensors[field] = null
    state.sensorUpdatedAt[field] = 0
  }
}

const updateSensorState = (state, rawData, now) => {
  if (Object.prototype.hasOwnProperty.call(rawData, "water_Y2")) state.pumpState = Number(rawData.water_Y2) === 1 ? "on" : "off"
  if (Object.prototype.hasOwnProperty.call(rawData, "heat_Y1")) state.heaterState = Number(rawData.heat_Y1) === 1 ? "on" : "off"
  if (rawData.c_time !== undefined || rawData.time !== undefined) state.lastSensors.c_time = rawData.c_time || rawData.time || null

  updateNumericSensor(state, rawData, "temp_in", "field3", now)
  updateNumericSensor(state, rawData, "temp_out", "field2", now)
  updateNumericSensor(state, rawData, "flow_rate", "field5", now)
  updateNumericSensor(state, rawData, "pressure", "field4", now)
  if ((Object.hasOwn(rawData, 'temp_out') || Object.hasOwn(rawData, 'field2')) && Number.isFinite(state.lastSensors.temp_out)) {
    const stamp = rawData.c_time ?? rawData.time
    const key = stamp == null ? null : `${stamp}:${state.lastSensors.temp_out}`
    if (key === null || key !== state.lastTemperaturePacketKey) state.sensorSample++
    state.lastTemperaturePacketKey = key
  }
  state.lastSensorTime = Math.max(...Object.values(state.sensorUpdatedAt))
}

const checkHeaterSafety = async (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  const { params } = await loadDeviceControlConfig(dNo)
  return heaterSafetyFromConfig(state, params)
}

const heaterSafetyFromConfig = (state, params) => {
  const configError = state.configLoadError || validateControlParams(params)
  if (configError) return { safe: false, reason: configError }
  const staleSensors = getStaleSensors(state, Date.now(), params.data_timeout)
  if (staleSensors.length) return { safe: false, reason: `${formatStaleSensors(staleSensors)}数据超时或无效，禁止加热`, staleSensors }
  if (state.fsmState === FSM_STATES.FAULT) return { safe: false, reason: `设备仍处于故障状态: ${state.faultReason || "请先复位"}` }
  if (state.lastSensors.temp_in <= 0 || state.lastSensors.temp_out <= 0) return { safe: false, reason: '温度为断线零值，禁止开启加热' }
  if (state.pumpState !== "on") return { safe: false, reason: "水泵未开启，禁止加热" }
  if (state.lastSensors.flow_rate < params.min_safe_flow) {
    return { safe: false, reason: `当前流量不足(${state.lastSensors.flow_rate.toFixed(2)} < ${params.min_safe_flow} L/min)，严禁打开加热防止干烧` }
  }
  if (state.lastSensors.pressure >= params.max_safe_pressure) {
    return { safe: false, reason: `当前管路压力过高(${state.lastSensors.pressure.toFixed(2)} >= ${params.max_safe_pressure} kPa)` }
  }
  const maximumTemperature = Math.max(state.lastSensors.temp_out, state.lastSensors.temp_in)
  if (maximumTemperature >= params.max_safe_temperature) {
    return { safe: false, reason: `当前水温过高(${maximumTemperature.toFixed(1)} >= ${params.max_safe_temperature} ℃)` }
  }
  return { safe: true }
}

const beginTemperatureSensorCooling = async (dNo, fault, params) => {
  const state = getOrCreateDeviceState(dNo)
  revokeHeating(state)
  const generation = state.generation
  try {
    await executeDeviceAction(dNo, "heater", "off", `温度传感器保护: ${fault.reason}`)
  } catch (error) {
    setFaultState(
      state,
      FAULT_CODES.COMMAND_PUBLISH_FAILED,
      `${fault.reason}；关闭加热发布失败: ${error.message}`,
    )
    await recordFault(dNo, state.faultCode, state.faultReason)
    notifyStatusChange(dNo)
    return
  }
  if (generation !== state.generation) return
  const canCool = state.pumpState === "on"
    && state.lastSensors.flow_rate >= params.min_safe_flow
    && state.lastSensors.pressure < params.max_safe_pressure
  if (canCool) {
    state.fsmState = FSM_STATES.COOLING
    state.fsmText = FSM_STATE_TEXT.COOLING
    state.faultCode = fault.code
    state.faultReason = fault.reason
    state.countdown = params.cooling_delay
    state.coolingExitState = FSM_STATES.FAULT
    await recordFault(dNo, fault.code, fault.reason)
    notifyStatusChange(dNo)
    return
  }
  await triggerFault(dNo, fault, {
    stopPump: state.pumpState === "on" || state.desiredPumpState === "on",
  })
}

const handleSensorTimeouts = async (dNo, params, now) => {
  const state = getOrCreateDeviceState(dNo)
  const staleSensors = getStaleSensors(state, now, params.data_timeout)
  if (!staleSensors.length) return false
  const activeControl = state.fsmState !== FSM_STATES.STOPPED
    || state.pumpState === "on"
    || state.heaterState === "on"
    || state.desiredPumpState === "on"
    || state.desiredHeaterState === "on"
  if (!activeControl) return false
  const fault = getSensorFault(staleSensors)
  const onlyTemperatureSensors = staleSensors.every((field) => field === "temp_in" || field === "temp_out")
  const temperatureCoolingInProgress = onlyTemperatureSensors
    && state.fsmState === FSM_STATES.COOLING
    && state.coolingExitState === FSM_STATES.FAULT
    && state.faultCode === FAULT_CODES.SENSOR_TEMPERATURE_TIMEOUT
  if (temperatureCoolingInProgress) return false
  if (onlyTemperatureSensors) await beginTemperatureSensorCooling(dNo, fault, params)
  else await triggerFault(dNo, fault, { stopPump: true })
  return true
}

const inspectSafetyConditions = (state, params, now, hydraulicDiagnosis = null) => {
  const pumpActive = state.pumpState === "on"
  const flow = state.lastSensors.flow_rate
  const pressure = state.lastSensors.pressure
  const maximumTemperature = Math.max(state.lastSensors.temp_in, state.lastSensors.temp_out)
  const overPressure = pumpActive && pressure >= params.max_safe_pressure
  const overTemperature = maximumTemperature >= params.max_safe_temperature
  const unsafeCoolingFlow = pumpActive
    && state.fsmState === FSM_STATES.COOLING
    && flow < params.min_safe_flow
  const lowFlowObserved = pumpActive
    && (state.fsmState === FSM_STATES.RUNNING || state.heaterState === "on")
    && flow < params.min_safe_flow

  let lowFlowConfirmed = false
  if (lowFlowObserved) {
    if (!state.lowFlowStartTime) state.lowFlowStartTime = now
    lowFlowConfirmed = now - state.lowFlowStartTime >= params.low_flow_confirm_time * 1000
  } else {
    state.lowFlowStartTime = 0
  }

  // 过程 4：水泵运行中检测到水力断崖骤降（疑似脱落/严重泄漏）
  if (pumpActive && hydraulicDiagnosis && hydraulicDiagnosis.code === "HYDRAULIC_LEAK_OR_BURST") {
    return {
      code: FAULT_CODES.LOW_FLOW,
      reason: `水力骤降(${hydraulicDiagnosis.detail}) [联合诊断: ${hydraulicDiagnosis.name}]`,
      stopPump: true,
    }
  }

  if (overPressure) {
    const diagSuffix = hydraulicDiagnosis && hydraulicDiagnosis.code === "HYDRAULIC_BLOCKAGE"
      ? ` [联合诊断: ${hydraulicDiagnosis.name}]`
      : ""
    const suffix = overTemperature ? "，同时检测到温度超限" : ""
    return { code: FAULT_CODES.OVER_PRESSURE, reason: `管路超压(${pressure.toFixed(1)}kPa >= ${params.max_safe_pressure}kPa)${suffix}${diagSuffix}`, stopPump: true }
  }
  if (unsafeCoolingFlow) {
    return { code: FAULT_CODES.LOW_FLOW, reason: `冷却期间流量过低(${flow.toFixed(2)}L/min < ${params.min_safe_flow}L/min)`, stopPump: true }
  }
  if (lowFlowConfirmed) {
    let diagSuffix = ""
    if (hydraulicDiagnosis && [
      "HYDRAULIC_PUMP_ABNORMAL",
      "HYDRAULIC_SENSOR_ANOMALY",
      "HYDRAULIC_BLOCKAGE",
      "HYDRAULIC_LEAK_OR_BURST",
    ].includes(hydraulicDiagnosis.code)) {
      diagSuffix = ` [联合诊断: ${hydraulicDiagnosis.name}]`
    }
    return { code: FAULT_CODES.LOW_FLOW, reason: `运行中流量过低(${flow.toFixed(2)}L/min < ${params.min_safe_flow}L/min)${diagSuffix}`, stopPump: true }
  }
  if (overTemperature) {
    const canCoolSafely = pumpActive && flow >= params.min_safe_flow && pressure < params.max_safe_pressure
    return {
      code: FAULT_CODES.OVER_TEMPERATURE,
      reason: `水温超限(${maximumTemperature.toFixed(1)}℃ >= ${params.max_safe_temperature}℃)`,
      stopPump: pumpActive && !canCoolSafely,
    }
  }

  // 温度传感器装反判定：水流经加热器，正常应为 temp_in <= temp_out；若加热开启且水流正常，但 temp_in > temp_out 持续超限则为装反
  const heaterActive = state.heaterState === "on" || state.desiredHeaterState === "on"
  const tempIn = state.lastSensors.temp_in
  const tempOut = state.lastSensors.temp_out
  const hasValidTemps = typeof tempIn === "number" && Number.isFinite(tempIn)
    && typeof tempOut === "number" && Number.isFinite(tempOut)
    && tempIn > 0 && tempOut > 0
  const tempReversedObserved = pumpActive && flow >= params.min_safe_flow && heaterActive && hasValidTemps && (tempIn > tempOut + 0.1)

  let tempReversedConfirmed = false
  if (tempReversedObserved) {
    if (!state.tempReversedStartTime) state.tempReversedStartTime = now
    const confirmTimeMs = (Number(params.temp_reversed_confirm_time) || 5) * 1000
    tempReversedConfirmed = now - state.tempReversedStartTime >= confirmTimeMs
  } else {
    state.tempReversedStartTime = 0
  }

  if (tempReversedConfirmed) {
    const canCoolSafely = pumpActive && flow >= params.min_safe_flow && pressure < params.max_safe_pressure
    return {
      code: FAULT_CODES.TEMP_SENSOR_REVERSED,
      reason: `进出口温度传感器疑似装反(入口${tempIn.toFixed(1)}℃ > 出口${tempOut.toFixed(1)}℃，持续超过${params.temp_reversed_confirm_time || 5}s)`,
      stopPump: pumpActive && !canCoolSafely,
    }
  }

  // 无温升干烧判定：加热开启且水流正常循环中，持续达到 dry_heating_timeout 出口温度无有效温升（温升 < dry_heating_temp_diff）
  const dryHeatingTimeout = Number(params.dry_heating_timeout) || 15
  const dryHeatingTempDiff = Number(params.dry_heating_temp_diff) || 0.2
  const isHeaterHeating = pumpActive && flow >= params.min_safe_flow && heaterActive && typeof tempOut === "number" && Number.isFinite(tempOut) && tempOut > 0

  if (isHeaterHeating) {
    if (state.dryHeatingLastDeactiveTime) {
      state.dryHeatingLastActiveTime = now
      state.dryHeatingLastDeactiveTime = 0
    }
    if (!state.dryHeatingStartTime) {
      state.dryHeatingStartTime = now
      state.dryHeatingBaseTemp = tempOut
      state.dryHeatingAccumulatedMs = 0
      state.dryHeatingLastActiveTime = now
    } else {
      const deltaMs = Math.max(0, now - (state.dryHeatingLastActiveTime || now))
      state.dryHeatingLastActiveTime = now
      state.dryHeatingAccumulatedMs = (state.dryHeatingAccumulatedMs || 0) + deltaMs

      const tempRise = tempOut - state.dryHeatingBaseTemp
      if (tempRise >= dryHeatingTempDiff) {
        // 出口水温有显著温升，刷新基准温度并清零累计时间
        state.dryHeatingBaseTemp = tempOut
        state.dryHeatingAccumulatedMs = 0
        state.dryHeatingStartTime = now
      } else if (state.dryHeatingAccumulatedMs >= dryHeatingTimeout * 1000) {
        const canCoolSafely = pumpActive && flow >= params.min_safe_flow && pressure < params.max_safe_pressure
        return {
          code: FAULT_CODES.DRY_HEATING_NO_TEMP_RISE,
          reason: `加热无温升干烧保护(加热累计${(state.dryHeatingAccumulatedMs / 1000).toFixed(0)}s温升仅${tempRise.toFixed(2)}℃ < ${dryHeatingTempDiff}℃，基准${state.dryHeatingBaseTemp.toFixed(1)}℃/当前${tempOut.toFixed(1)}℃)`,
          stopPump: pumpActive && !canCoolSafely,
        }
      }
    }
  } else {
    if (!state.dryHeatingLastDeactiveTime) state.dryHeatingLastDeactiveTime = now
    if (now - state.dryHeatingLastDeactiveTime > 30000 || state.fsmState === FSM_STATES.STOPPED || state.fsmState === FSM_STATES.FAULT) {
      state.dryHeatingStartTime = 0
      state.dryHeatingBaseTemp = null
      state.dryHeatingAccumulatedMs = 0
      state.dryHeatingLastActiveTime = 0
    }
  }
  return null
}

const safeguardFaultCooling = async (dNo, params, now) => {
  const state = getOrCreateDeviceState(dNo)
  if (state.fsmState !== FSM_STATES.FAULT) return false
  const staleSensors = getStaleSensors(state, now, params.data_timeout)
  const unsafeSensor = staleSensors.includes("flow_rate") || staleSensors.includes("pressure")
  const unsafeReading = state.pumpState === 'on' && (state.lastSensors.flow_rate < params.min_safe_flow || state.lastSensors.pressure >= params.max_safe_pressure)
  if (unsafeSensor || unsafeReading) state.protectionStopPump = true
  const actionErrors = []
  try {
    await executeDeviceAction(dNo, "heater", "off", "故障保护: 关闭加热", { protection: true })
  } catch (error) {
    actionErrors.push(`关闭加热失败: ${error.message}`)
  }
  try {
    if (state.protectionStopPump) await executeDeviceAction(dNo, "pump", "off", "故障保护: 关闭水泵", { protection: true })
  } catch (error) {
    actionErrors.push(`关闭水泵失败: ${error.message}`)
  }
  if (actionErrors.length) {
    const detail = actionErrors.join('；')
    if (!state.faultReason?.includes(detail)) state.faultReason = `${state.faultReason || "故障散热条件失效"}；${detail}`
  }
  notifyStatusChange(dNo)
  return true
}

const checkControlConfiguration = async (dNo, params) => {
  const state = getOrCreateDeviceState(dNo)
  const active = [FSM_STATES.RUNNING, FSM_STATES.BUILDING_FLOW].includes(state.fsmState)
  const error = state.configLoadError || validateControlParams(params, { starting: active })
  state.configError = error
  if (error) {
    if (state.fsmState !== FSM_STATES.FAULT && (state.fsmState !== FSM_STATES.STOPPED || state.heaterState === 'on' || state.desiredHeaterState === 'on')) {
      await triggerFault(dNo, { code: FAULT_CODES.CONTROL_CONFIG_INVALID, reason: error, stopPump: true })
    }
    return false
  }
  if (active && (state.mode !== 'auto' || (state.configFingerprint && state.configFingerprint !== controlFingerprint(params)))) {
    state.restartReason = '控温配置已变化，请等待冷却结束后重新启动'
    await stopAuto(dNo)
    return false
  }
  return true
}

const runTemperatureControl = async (dNo, params) => {
  const state = getOrCreateDeviceState(dNo)
  if (state.mode !== 'auto' || state.fsmState !== FSM_STATES.RUNNING || state.heatInhibited) return
  let desired = state.desiredHeaterState
  let remark = '自动回差控温'
  if (params.temperature_control_strategy === 'pid') {
    if (state.lastSensors.temp_out <= 0 || getStaleSensors(state).length) return
    state.pidController.update({ value: state.lastSensors.temp_out, sample: state.sensorSample, params })
    state.pid = state.pidController.schedule(params, state.published.heater === 'on')
    if (state.pid.calculationError) {
      state.configError = state.pid.calculationError
      await triggerFault(dNo, { code: FAULT_CODES.CONTROL_CONFIG_INVALID, reason: state.configError, stopPump: true })
      return
    }
    desired = state.pid.desired
    remark = `时间PID: 窗口${state.pid.windowIndex}；输出${state.pid.output.toFixed(2)}%；计划${state.pid.plannedDuty.toFixed(2)}%；${state.pid.limitationReason || '窗口调度'}`
  } else {
    if (state.lastSensors.temp_out <= params.target_temperature - params.temperature_hysteresis) desired = 'on'
    else if (state.lastSensors.temp_out >= params.target_temperature) desired = 'off'
  }
  if (desired === state.desiredHeaterState) return
  // 危险数据立即阻止新开启，故障确认仍交给原有安全联锁。
  if (desired === 'on' && !heaterSafetyFromConfig(state, params).safe) return
  try {
    await executeDeviceAction(dNo, 'heater', desired, remark, { automatic: true, pidWindow: params.temperature_control_strategy === 'pid' ? state.pid.windowIndex : undefined })
  } catch (error) {
    await triggerFault(dNo, { code: FAULT_CODES.COMMAND_PUBLISH_FAILED, reason: `控温发布失败: ${error.message}`, stopPump: true })
  }
}

const evaluateManualPumpIdling = async (dNo, state, params) => {
  if (state.fsmState !== FSM_STATES.STOPPED || state.starting) return

  const pumpActive = state.pumpState === "on" || state.desiredPumpState === "on"
  if (!pumpActive) {
    if (state.manualPumpTracking.startedAt > 0) {
      state.manualPumpTracking.startedAt = 0
      state.manualPumpTracking.flowEstablished = false
      state.manualPumpTracking.protecting = false
    }
    return
  }

  const now = monotonicClock()
  if (!state.manualPumpTracking.startedAt) {
    state.manualPumpTracking.startedAt = now
    state.manualPumpTracking.flowEstablished = false
    state.manualPumpTracking.protecting = false
  }

  const currentFlow = Number(state.lastSensors.flow_rate)
  const minSafeFlow = Number(params.min_safe_flow ?? DEFAULT_CONTROL_PARAMS.min_safe_flow)
  const buildFlowTimeout = Number(params.build_flow_timeout ?? DEFAULT_CONTROL_PARAMS.build_flow_timeout)

  if (Number.isFinite(currentFlow) && currentFlow >= minSafeFlow) {
    state.manualPumpTracking.flowEstablished = true
    return
  }

  if (!state.manualPumpTracking.flowEstablished) {
    const elapsed = now - state.manualPumpTracking.startedAt
    if (elapsed < buildFlowTimeout * 1000) {
      return
    }

    if (state.manualPumpTracking.protecting) return
    state.manualPumpTracking.protecting = true

    const reason = `水泵启动建流超时(超过${buildFlowTimeout}s未达到最低流量)，疑似水泵空转已强制停泵保护`
    console.warn(`[WaterControl][PUMP_IDLING] 设备 ${dNo} 手动模式下空转: ${reason}`)

    try {
      await executeDeviceAction(dNo, "pump", "off", "水泵空转保护自动关泵")
    } catch (err) {
      console.error(`[WaterControl] 空转保护关泵发布失败: ${err.message}`)
    }

    await recordFault(dNo, "HYDRAULIC_PUMP_ABNORMAL", reason)

    state.manualPumpTracking.startedAt = 0
    state.manualPumpTracking.flowEstablished = false
    state.manualPumpTracking.protecting = false
    notifyStatusChange(dNo)
  }
}

const onSensorData = async (dNo, rawData) => {
  if (!rawData || !dNo) return
  const state = getOrCreateDeviceState(dNo)
  const now = Date.now()
  updateSensorState(state, rawData, now)
  const generation = state.generation
  const { masterMode, params } = await loadDeviceControlConfig(dNo)
  if (generation !== state.generation) return
  state.mode = masterMode

  if (state.fsmState === FSM_STATES.FAULT) {
    await safeguardFaultCooling(dNo, params, now)
    notifyStatusChange(dNo)
    return
  }
  if (!await checkControlConfiguration(dNo, params)) return
  if (await handleSensorTimeouts(dNo, params, now)) return
  const hydraulicDiagnosis = evaluateHydraulicStatus(
    dNo,
    {
      pumpState: state.pumpState,
      flowRate: state.lastSensors.flow_rate,
      pressure: state.lastSensors.pressure,
      isBuildingFlow: state.fsmState === FSM_STATES.BUILDING_FLOW,
      isFault: state.fsmState === FSM_STATES.FAULT,
      staleSensors: getStaleSensors(state, now, params.data_timeout),
    },
    params,
    now,
  )
  const safetyFault = inspectSafetyConditions(state, params, now, hydraulicDiagnosis)
  if (safetyFault) {
    await triggerFault(dNo, safetyFault, { stopPump: safetyFault.stopPump, hydraulicDiagnosis })
    return
  }
  if (state.mode !== "auto" || state.fsmState === FSM_STATES.STOPPED) {
    await evaluateManualPumpIdling(dNo, state, params)
    notifyStatusChange(dNo)
    return
  }

  if (state.fsmState === FSM_STATES.BUILDING_FLOW) {
    if (state.pumpState === "on" && state.lastSensors.flow_rate >= params.min_safe_flow && state.lastSensors.pressure < params.max_safe_pressure) {
      state.fsmState = FSM_STATES.RUNNING
      state.fsmText = FSM_STATE_TEXT.RUNNING
      state.countdown = 0
      console.log(`[WaterControl] 设备 ${dNo} 建流成功，进入 RUNNING 自动运行状态`)
    }
    notifyStatusChange(dNo)
    return
  }

  if (state.fsmState === FSM_STATES.RUNNING) {
    await runTemperatureControl(dNo, params)
    notifyStatusChange(dNo)
    return
  }

  if (state.fsmState === FSM_STATES.COOLING) {
    if (state.lastSensors.flow_rate <= 0) {
      const coolingGeneration = state.generation
      await executeDeviceAction(dNo, "pump", "off", "冷却期间无流量停泵")
      if (coolingGeneration !== state.generation || state.fsmState !== FSM_STATES.COOLING) return
      state.fsmState = state.coolingExitState
      state.fsmText = FSM_STATE_TEXT[state.fsmState]
      state.countdown = 0
    }
    notifyStatusChange(dNo)
  }
}

const watchdogDeviceTick = async (dNo, state, now) => {
  // 先用最近配置执行关闭/超时保护，再读取新配置，数据库延迟不能延长加热脉冲。
  if (state.configCache) {
    const cachedParams = state.configCache.params
    if (state.fsmState === FSM_STATES.FAULT) {
      await safeguardFaultCooling(dNo, cachedParams, now)
    } else if (await handleSensorTimeouts(dNo, cachedParams, now)) return
    if (state.fsmState === FSM_STATES.RUNNING && state.pid && cachedParams.temperature_control_strategy === 'pid') {
      const scheduled = state.pidController.schedule(cachedParams, state.published.heater === 'on')
      if (scheduled.desired === 'off' && state.desiredHeaterState === 'on') {
        try { await executeDeviceAction(dNo, 'heater', 'off', `时间PID: 窗口${scheduled.windowIndex}到期关闭；输出${scheduled.output.toFixed(2)}%；计划${scheduled.plannedDuty.toFixed(2)}%`) }
        catch (error) { await triggerFault(dNo, { code: FAULT_CODES.COMMAND_PUBLISH_FAILED, reason: error.message, stopPump: true }); return }
      }
    }
  }
  const { params } = await loadDeviceControlConfig(dNo)
  if (state.fsmState === FSM_STATES.FAULT) {
    await safeguardFaultCooling(dNo, params, now)
    return
  }
  if (!await checkControlConfiguration(dNo, params)) return
  if (await handleSensorTimeouts(dNo, params, now)) return
  if (state.fsmState === FSM_STATES.RUNNING) {
    const fault = inspectSafetyConditions(state, params, now, getDeviceDiagnosis(dNo))
    if (fault) await triggerFault(dNo, fault)
    else await runTemperatureControl(dNo, params)
    notifyStatusChange(dNo)
  }
  if (state.fsmState === FSM_STATES.BUILDING_FLOW) {
    state.countdown = Math.max(0, state.countdown - 1)
    if (state.countdown <= 0) {
      await triggerFault(dNo, {
        code: FAULT_CODES.BUILD_FLOW_TIMEOUT,
        reason: `启动未建流(超过${params.build_flow_timeout}s未达到最低流量)，疑似水泵空转已停泵保护`,
        stopPump: true,
      })
    } else notifyStatusChange(dNo)
    return
  }
  if (state.fsmState === FSM_STATES.COOLING) {
    state.countdown = Math.max(0, state.countdown - 1)
    if (state.countdown <= 0) {
      const coolingGeneration = state.generation
      try {
        await executeDeviceAction(dNo, "pump", "off", "冷却延时结束自动停泵")
        if (coolingGeneration !== state.generation || state.fsmState !== FSM_STATES.COOLING) return
        state.fsmState = state.coolingExitState
        state.fsmText = FSM_STATE_TEXT[state.fsmState]
      } catch (error) {
        setFaultState(state, FAULT_CODES.COMMAND_PUBLISH_FAILED, `冷却结束关泵发布失败: ${error.message}`)
        await recordFault(dNo, state.faultCode, state.faultReason)
      }
    }
    notifyStatusChange(dNo)
    return
  }
  if (state.fsmState === FSM_STATES.STOPPED) {
    await evaluateManualPumpIdling(dNo, state, params)
  }
}

const watchdogTick = async () => {
  // 巡检不能被任一发布/PUBACK阻塞；重叠调用由动作队列去重，安全撤销同步生效。
  const results = await Promise.allSettled([...deviceStateMap].map(([dNo, state]) => watchdogDeviceTick(dNo, state, Date.now())))
  for (const result of results) if (result.status === 'rejected') console.error('[WaterControl] 设备巡检失败:', result.reason)
}

const validateStartConditions = (state, params) => {
  if (state.fsmState === FSM_STATES.FAULT) throw new Error(`启动失败：设备仍处于故障状态，请先确认并复位（${state.faultReason || "未知故障"}）`)
  const staleSensors = getStaleSensors(state, Date.now(), params.data_timeout)
  if (staleSensors.length) throw new Error(`启动失败：${formatStaleSensors(staleSensors)}数据超时或无效`)
  const maximumTemperature = Math.max(state.lastSensors.temp_in, state.lastSensors.temp_out)
  if (maximumTemperature >= params.max_safe_temperature) throw new Error(`启动失败：当前水温(${maximumTemperature}℃)已达到安全上限(${params.max_safe_temperature}℃)`)
  if (state.lastSensors.pressure >= params.max_safe_pressure) throw new Error(`启动失败：当前压力(${state.lastSensors.pressure}kPa)已达到安全上限(${params.max_safe_pressure}kPa)`)
}

const startAuto = async (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  if (state.starting || [FSM_STATES.BUILDING_FLOW, FSM_STATES.RUNNING, FSM_STATES.COOLING].includes(state.fsmState)) throw new Error('请等待当前运行或冷却流程结束再启动')
  state.starting = true
  const generation = state.generation
  try {
    const { params } = await loadDeviceControlConfig(dNo)
    const configError = state.configLoadError || validateControlParams(params, { starting: true })
    if (configError) throw new Error(configError)
    validateStartConditions(state, params)
    if (generation !== state.generation) throw new Error('启动已取消')
    try {
      await executeDeviceAction(dNo, "heater", "off", "自动运行启动: 初始关闭加热", { force: true })
      if (generation !== state.generation) throw new Error('启动已取消')
      await executeDeviceAction(dNo, "pump", "on", "自动运行启动: 开启水泵建流")
    } catch (error) {
      if (generation !== state.generation) throw error
      await triggerFault(dNo, { code: FAULT_CODES.COMMAND_PUBLISH_FAILED, reason: `自动启动指令发布失败: ${error.message}`, stopPump: true })
      throw error
    }
    if (generation !== state.generation) throw new Error('启动已取消')
    state.heatInhibited = false
    state.pidController.reset()
    state.pid = null
    state.configFingerprint = controlFingerprint(params)
    state.restartReason = null
    state.protectionStopPump = false
    state.fsmState = FSM_STATES.BUILDING_FLOW
    state.fsmText = FSM_STATE_TEXT.BUILDING_FLOW
    state.countdown = params.build_flow_timeout
    state.faultCode = null
    state.faultReason = null
    state.coolingExitState = FSM_STATES.STOPPED
    notifyStatusChange(dNo)
    return { success: true, message: "自动运行指令已发布，正在建立水循环..." }
  } finally { state.starting = false }
}

const stopAuto = async (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  revokeHeating(state)
  const { params } = state.configCache || await loadDeviceControlConfig(dNo)
  const wasFaulted = state.fsmState === FSM_STATES.FAULT
  try {
    await executeDeviceAction(dNo, "heater", "off", "用户停止: 立即关闭加热")
  } catch (error) {
    if (wasFaulted) {
      state.faultReason = `${state.faultReason || "设备故障"}；停止时关加热发布失败: ${error.message}`
    } else {
      setFaultState(state, FAULT_CODES.COMMAND_PUBLISH_FAILED, `停止时关加热发布失败: ${error.message}`)
    }
    await recordFault(dNo, state.faultCode, state.faultReason)
    notifyStatusChange(dNo)
    throw error
  }
  if (wasFaulted || state.fsmState === FSM_STATES.FAULT) {
    notifyStatusChange(dNo)
    return { success: true, message: "停止指令已发布；设备仍保持故障锁定，请确认安全后复位" }
  }
  if (state.pumpState === "on" || state.desiredPumpState === "on") {
    state.fsmState = FSM_STATES.COOLING
    state.fsmText = FSM_STATE_TEXT.COOLING
    state.countdown = params.cooling_delay
    state.coolingExitState = FSM_STATES.STOPPED
  } else {
    state.fsmState = FSM_STATES.STOPPED
    state.fsmText = FSM_STATE_TEXT.STOPPED
    state.countdown = 0
  }
  notifyStatusChange(dNo)
  return { success: true, message: "停止指令已发布，进入冷却流程" }
}

const resetFault = async (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  revokeHeating(state)
  const generation = state.generation
  const { params } = state.configCache || await loadDeviceControlConfig(dNo)
  if (generation !== state.generation) throw new Error('复位期间状态变化，请重新确认故障')
  const configError = state.configLoadError || validateControlParams(params)
  if (configError) throw new Error(`故障复位失败：${configError}`)
  const staleSensors = getStaleSensors(state, Date.now(), params.data_timeout)
  if (staleSensors.length) throw new Error(`故障复位失败：${formatStaleSensors(staleSensors)}数据仍超时或无效`)
  const maximumTemperature = Math.max(state.lastSensors.temp_in, state.lastSensors.temp_out)
  if (maximumTemperature >= params.max_safe_temperature) throw new Error(`故障复位失败：当前水温仍达到安全上限(${maximumTemperature}℃)`)
  if (state.lastSensors.pressure >= params.max_safe_pressure) throw new Error(`故障复位失败：当前压力仍达到安全上限(${state.lastSensors.pressure}kPa)`)
  await executeDeviceAction(dNo, "heater", "off", "故障复位", { force: true })
  if (generation !== state.generation) throw new Error('复位期间发生新故障，请重新确认')
  await executeDeviceAction(dNo, "pump", "off", "故障复位", { force: true })
  if (generation !== state.generation) throw new Error('复位期间发生新故障，请重新确认')
  if (getStaleSensors(state, Date.now(), params.data_timeout).length
    || Math.max(state.lastSensors.temp_in, state.lastSensors.temp_out) >= params.max_safe_temperature
    || state.lastSensors.pressure >= params.max_safe_pressure) throw new Error('复位期间安全条件变化，请重新检查')
  state.fsmState = FSM_STATES.STOPPED
  state.fsmText = FSM_STATE_TEXT.STOPPED
  state.faultCode = null
  state.faultReason = null
  state.countdown = 0
  state.lowFlowStartTime = 0
  state.tempReversedStartTime = 0
  state.dryHeatingStartTime = 0
  state.dryHeatingBaseTemp = null
  state.dryHeatingAccumulatedMs = 0
  state.dryHeatingLastActiveTime = 0
  state.dryHeatingLastDeactiveTime = 0
  if (state.zeroStartTime) {
    state.zeroStartTime = { temp_in: 0, temp_out: 0, flow_rate: 0, pressure: 0 }
  }
  state.coolingExitState = FSM_STATES.STOPPED
  resetDeviceDiagnosis(dNo)
  notifyStatusChange(dNo)
  return { success: true, message: "故障已确认复位，系统回到停止状态" }
}

const initEngine = () => {
  syncAllDeviceConfigs().catch((error) => console.error("[WaterControl] 初始化配置同步失败:", error.message))
  ensureErrorMessageMappings().catch((error) => console.error("[WaterControl] 初始化错误码映射失败:", error.message))
  if (!timerId) {
    timerId = setInterval(() => watchdogTick().catch((error) => console.error("[WaterControl] Watchdog error:", error)), 1000)
    if (typeof timerId.unref === "function") timerId.unref()
  }
}

const stopEngine = () => {
  for (const state of deviceStateMap.values()) revokeHeating(state)
  if (timerId) {
    clearInterval(timerId)
    timerId = null
  }
}

const __setMqttClientForTests = (client) => { mqttClientDep = client }
const __setBroadcastForTests = (fn) => { broadcastDep = fn }
const __setConfigLoaderForTests = (fn) => { configLoaderDep = fn }
const __resetForTests = () => {
  deviceStateMap.clear()
  mqttClientDep = null
  broadcastDep = null
  configLoaderDep = null
  stopEngine()
  monotonicClock = () => performance.now()
}

module.exports = {
  invalidateConfig: (dNo) => { getOrCreateDeviceState(dNo).configCachedAt = -Infinity },
  executeManualAction,
  __setClockForTests: (clock) => { monotonicClock = clock },
  checkControlConfiguration,
  loadDeviceControlConfig,
  DEFAULT_CONTROL_PARAMS,
  FAULT_CODES,
  FSM_STATES,
  FSM_STATE_TEXT,
  __resetForTests,
  __setBroadcastForTests,
  __setConfigLoaderForTests,
  __setMqttClientForTests,
  checkHeaterSafety,
  executeDeviceAction,
  getDeviceControlStatus,
  getOrCreateDeviceState,
  initEngine,
  notifyStatusChange,
  onSensorData,
  resetFault,
  startAuto,
  stopAuto,
  stopEngine,
  triggerFault,
  watchdogTick,
}
