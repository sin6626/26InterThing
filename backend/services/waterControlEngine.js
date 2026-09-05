const { buildDeviceCommandEnvelope } = require("../mqtt/commandMapper")
const { waitForPublish } = require("../mqtt/publishTimeout")

const DEFAULT_CONTROL_PARAMS = {
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
  BUILD_FLOW_TIMEOUT: "BUILD_FLOW_TIMEOUT",
  COMMAND_PUBLISH_FAILED: "COMMAND_PUBLISH_FAILED",
  LOW_FLOW: "LOW_FLOW",
  OVER_PRESSURE: "OVER_PRESSURE",
  OVER_TEMPERATURE: "OVER_TEMPERATURE",
  SENSOR_FLOW_TIMEOUT: "SENSOR_FLOW_TIMEOUT",
  SENSOR_PRESSURE_TIMEOUT: "SENSOR_PRESSURE_TIMEOUT",
  SENSOR_TEMPERATURE_TIMEOUT: "SENSOR_TEMPERATURE_TIMEOUT",
  UNKNOWN: "UNKNOWN",
}

const deviceStateMap = new Map()

let mqttClientDep = null
let broadcastDep = null
let configLoaderDep = null
let timerId = null

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
    })
  }
  return deviceStateMap.get(dNo)
}

const loadDeviceControlConfig = async (dNo) => {
  let rows = []
  if (typeof configLoaderDep === "function") {
    rows = await configLoaderDep(dNo)
  } else {
    try {
      const directRepository = require("../repositories/directRepository")
      rows = await directRepository.getDeviceConfigRows(dNo)
    } catch (error) {
      console.error(`[WaterControl] 读取设备 ${dNo} 控制配置失败:`, error.message)
    }
  }

  const params = { ...DEFAULT_CONTROL_PARAMS }
  const configsByTopic = {}
  let masterMode = "manual"

  for (const row of rows) {
    if (!row.topic) continue
    configsByTopic[row.topic] = row
    if (row.topic === "master") {
      masterMode = row.value === "on" ? "auto" : "manual"
      continue
    }
    if (row.topic in params) {
      const parsedValue = Number.parseFloat(row.value)
      if (Number.isFinite(parsedValue) && parsedValue > 0) params[row.topic] = parsedValue
    }
  }

  const state = getOrCreateDeviceState(dNo)
  state.mode = masterMode
  state.dataTimeoutSeconds = params.data_timeout
  return { configsByTopic, masterMode, params }
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

const executeDeviceAction = async (dNo, topic, value, remark = "应用层自动控制") => {
  const state = getOrCreateDeviceState(dNo)
  const desiredKey = topic === "pump" ? "desiredPumpState" : "desiredHeaterState"
  const actualKey = topic === "pump" ? "pumpState" : "heaterState"
  const previousDesired = state[desiredKey]
  const startedAt = new Date().toISOString()
  let config = null

  state[desiredKey] = value
  state.lastCommandStatus = { topic, value, status: "pending", startedAt }

  try {
    const loaded = await loadDeviceControlConfig(dNo)
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
    await waitForPublish(mqttClient.publishToDevice(commandEnvelope.topic, commandEnvelope.payload), loaded.params.command_timeout)

    state.lastCommandStatus = {
      topic,
      value,
      status: "success",
      startedAt,
      finishedAt: new Date().toISOString(),
    }
    await insertCommandHistory({
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
    state[desiredKey] = previousDesired
    state.lastCommandStatus = {
      topic,
      value,
      status: "failed",
      error: error.message,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
    await insertCommandHistory({
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

const getStaleSensors = (state, now = Date.now(), timeoutSeconds = state.dataTimeoutSeconds) => {
  const timeoutMs = timeoutSeconds * 1000
  return SENSOR_FIELDS.filter((field) => {
    const updatedAt = state.sensorUpdatedAt[field]
    return state.lastSensors[field] === null || !updatedAt || now - updatedAt > timeoutMs
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
    broadcast("device_status", {
      d_no: dNo,
      status: "unmonitored",
      vstatus: null,
      level: state.fsmState === FSM_STATES.FAULT ? "error" : "unknown",
      text: state.fsmState === FSM_STATES.FAULT ? (state.faultReason || "设备故障") : "未启用心跳",
      updated_at: new Date().toLocaleString(),
      control: getDeviceControlStatus(dNo),
    })
  }
}

const recordFault = async (dNo, faultCode, reason) => {
  const nowTime = new Date().toLocaleString()
  console.warn(`[WaterControl][${faultCode}] 设备 ${dNo}: ${reason}`)

  if (typeof configLoaderDep !== "function") {
    try {
      const { query } = require("../repositories/query")
      await query(
        "INSERT INTO t_error_msg (d_no, c_time, e_msg, e_no, type) VALUES (?, NOW(), ?, ?, ?)",
        [dNo, `安全保护: ${reason}`, faultCode, "7"],
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
    broadcast("error_realtime", { d_no: dNo, e_no: faultCode, type: "7", e_msg: `安全保护: ${reason}`, c_time: nowTime })
    broadcast("alarm_realtime", { d_no: dNo, code: 7, level: "error", text: `安全保护: ${reason}`, updated_at: nowTime })
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
  const fault = typeof faultOrReason === "string"
    ? { code: FAULT_CODES.UNKNOWN, reason: faultOrReason }
    : faultOrReason
  const stopPump = options.stopPump ?? fault.stopPump ?? true
  setFaultState(state, fault.code || FAULT_CODES.UNKNOWN, fault.reason || "未知故障")

  const actionErrors = []
  try {
    await executeDeviceAction(dNo, "heater", "off", `故障保护: ${state.faultReason}`)
  } catch (error) {
    actionErrors.push(`关闭加热失败: ${error.message}`)
  }
  if (stopPump) {
    try {
      await executeDeviceAction(dNo, "pump", "off", `故障保护: ${state.faultReason}`)
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

const updateNumericSensor = (state, rawData, field, fallbackField, now) => {
  const hasPrimary = Object.prototype.hasOwnProperty.call(rawData, field)
  const hasFallback = fallbackField && Object.prototype.hasOwnProperty.call(rawData, fallbackField)
  if (!hasPrimary && !hasFallback) return
  const rawValue = hasPrimary ? rawData[field] : rawData[fallbackField]
  const parsedValue = typeof rawValue === "number"
    ? rawValue
    : (typeof rawValue === "string" && rawValue.trim() !== "" ? Number(rawValue) : Number.NaN)
  if (Number.isFinite(parsedValue)) {
    state.lastSensors[field] = parsedValue
    state.sensorUpdatedAt[field] = now
  } else {
    state.lastSensors[field] = null
    state.sensorUpdatedAt[field] = 0
  }
}

const updateSensorState = (state, rawData, now) => {
  updateNumericSensor(state, rawData, "temp_in", "field3", now)
  updateNumericSensor(state, rawData, "temp_out", "field2", now)
  updateNumericSensor(state, rawData, "flow_rate", "field5", now)
  updateNumericSensor(state, rawData, "pressure", "field4", now)
  if (Object.prototype.hasOwnProperty.call(rawData, "water_Y2")) state.pumpState = Number(rawData.water_Y2) === 1 ? "on" : "off"
  if (Object.prototype.hasOwnProperty.call(rawData, "heat_Y1")) state.heaterState = Number(rawData.heat_Y1) === 1 ? "on" : "off"
  if (rawData.c_time !== undefined || rawData.time !== undefined) state.lastSensors.c_time = rawData.c_time || rawData.time || null
  state.lastSensorTime = Math.max(...Object.values(state.sensorUpdatedAt))
}

const checkHeaterSafety = async (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  const { params } = await loadDeviceControlConfig(dNo)
  const staleSensors = getStaleSensors(state, Date.now(), params.data_timeout)
  if (staleSensors.length) return { safe: false, reason: `${formatStaleSensors(staleSensors)}数据超时或无效，禁止加热`, staleSensors }
  if (state.fsmState === FSM_STATES.FAULT) return { safe: false, reason: `设备仍处于故障状态: ${state.faultReason || "请先复位"}` }
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

const inspectSafetyConditions = (state, params, now) => {
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

  if (overPressure) {
    const suffix = overTemperature ? "，同时检测到温度超限" : ""
    return { code: FAULT_CODES.OVER_PRESSURE, reason: `管路超压(${pressure.toFixed(1)}kPa >= ${params.max_safe_pressure}kPa)${suffix}`, stopPump: true }
  }
  if (unsafeCoolingFlow) {
    return { code: FAULT_CODES.LOW_FLOW, reason: `冷却期间流量过低(${flow.toFixed(2)}L/min < ${params.min_safe_flow}L/min)`, stopPump: true }
  }
  if (lowFlowConfirmed) {
    return { code: FAULT_CODES.LOW_FLOW, reason: `运行中流量过低(${flow.toFixed(2)}L/min < ${params.min_safe_flow}L/min)`, stopPump: true }
  }
  if (overTemperature) {
    const canCoolSafely = pumpActive && flow >= params.min_safe_flow && pressure < params.max_safe_pressure
    return {
      code: FAULT_CODES.OVER_TEMPERATURE,
      reason: `水温超限(${maximumTemperature.toFixed(1)}℃ >= ${params.max_safe_temperature}℃)`,
      stopPump: pumpActive && !canCoolSafely,
    }
  }
  return null
}

const safeguardFaultCooling = async (dNo, params, now) => {
  const state = getOrCreateDeviceState(dNo)
  if (state.fsmState !== FSM_STATES.FAULT || state.pumpState !== "on") return false
  const staleSensors = getStaleSensors(state, now, params.data_timeout)
  const unsafeSensor = staleSensors.includes("flow_rate") || staleSensors.includes("pressure")
  const unsafeReading = state.lastSensors.flow_rate < params.min_safe_flow || state.lastSensors.pressure >= params.max_safe_pressure
  if (!unsafeSensor && !unsafeReading) return false
  const actionErrors = []
  try {
    await executeDeviceAction(dNo, "heater", "off", "故障散热条件失效: 关闭加热")
  } catch (error) {
    actionErrors.push(`关闭加热失败: ${error.message}`)
  }
  try {
    await executeDeviceAction(dNo, "pump", "off", "故障散热条件失效: 关闭水泵")
  } catch (error) {
    actionErrors.push(`关闭水泵失败: ${error.message}`)
  }
  if (actionErrors.length) {
    state.faultReason = `${state.faultReason || "故障散热条件失效"}；${actionErrors.join("；")}`
  }
  notifyStatusChange(dNo)
  return true
}

const onSensorData = async (dNo, rawData) => {
  if (!rawData || !dNo) return
  const state = getOrCreateDeviceState(dNo)
  const now = Date.now()
  updateSensorState(state, rawData, now)
  const { masterMode, params } = await loadDeviceControlConfig(dNo)
  state.mode = masterMode

  if (state.fsmState === FSM_STATES.FAULT) {
    await safeguardFaultCooling(dNo, params, now)
    notifyStatusChange(dNo)
    return
  }
  if (await handleSensorTimeouts(dNo, params, now)) return
  const safetyFault = inspectSafetyConditions(state, params, now)
  if (safetyFault) {
    await triggerFault(dNo, safetyFault, { stopPump: safetyFault.stopPump })
    return
  }
  if (state.mode !== "auto" || state.fsmState === FSM_STATES.STOPPED) {
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
    const currentTemperature = state.lastSensors.temp_out
    const lowThreshold = params.target_temperature - params.temperature_hysteresis
    const highThreshold = params.target_temperature
    if (currentTemperature <= lowThreshold && state.desiredHeaterState !== "on") {
      await executeDeviceAction(dNo, "heater", "on", "自动控温: 水温低于下限")
    } else if (currentTemperature >= highThreshold && state.desiredHeaterState !== "off") {
      await executeDeviceAction(dNo, "heater", "off", "自动控温: 水温达到目标")
    }
    notifyStatusChange(dNo)
    return
  }

  if (state.fsmState === FSM_STATES.COOLING) {
    if (state.lastSensors.flow_rate <= 0) {
      await executeDeviceAction(dNo, "pump", "off", "冷却期间无流量停泵")
      state.fsmState = state.coolingExitState
      state.fsmText = FSM_STATE_TEXT[state.fsmState]
      state.countdown = 0
    }
    notifyStatusChange(dNo)
  }
}

const watchdogTick = async () => {
  const now = Date.now()
  for (const [dNo, state] of deviceStateMap) {
    const { params } = await loadDeviceControlConfig(dNo)
    if (state.fsmState === FSM_STATES.FAULT) {
      await safeguardFaultCooling(dNo, params, now)
      continue
    }
    if (await handleSensorTimeouts(dNo, params, now)) continue
    if (state.fsmState === FSM_STATES.BUILDING_FLOW) {
      state.countdown = Math.max(0, state.countdown - 1)
      if (state.countdown <= 0) {
        await triggerFault(dNo, {
          code: FAULT_CODES.BUILD_FLOW_TIMEOUT,
          reason: `启动未建流(超过${params.build_flow_timeout}s未达到最低流量)`,
          stopPump: true,
        })
      } else notifyStatusChange(dNo)
      continue
    }
    if (state.fsmState === FSM_STATES.COOLING) {
      state.countdown = Math.max(0, state.countdown - 1)
      if (state.countdown <= 0) {
        try {
          await executeDeviceAction(dNo, "pump", "off", "冷却延时结束自动停泵")
          state.fsmState = state.coolingExitState
          state.fsmText = FSM_STATE_TEXT[state.fsmState]
        } catch (error) {
          setFaultState(state, FAULT_CODES.COMMAND_PUBLISH_FAILED, `冷却结束关泵发布失败: ${error.message}`)
          await recordFault(dNo, state.faultCode, state.faultReason)
        }
      }
      notifyStatusChange(dNo)
    }
  }
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
  const { params } = await loadDeviceControlConfig(dNo)
  validateStartConditions(state, params)
  try {
    await executeDeviceAction(dNo, "heater", "off", "自动运行启动: 初始关闭加热")
    await executeDeviceAction(dNo, "pump", "on", "自动运行启动: 开启水泵建流")
  } catch (error) {
    setFaultState(state, FAULT_CODES.COMMAND_PUBLISH_FAILED, `自动启动指令发布失败: ${error.message}`)
    await recordFault(dNo, state.faultCode, state.faultReason)
    notifyStatusChange(dNo)
    throw error
  }
  state.fsmState = FSM_STATES.BUILDING_FLOW
  state.fsmText = FSM_STATE_TEXT.BUILDING_FLOW
  state.countdown = params.build_flow_timeout
  state.faultCode = null
  state.faultReason = null
  state.coolingExitState = FSM_STATES.STOPPED
  notifyStatusChange(dNo)
  return { success: true, message: "自动运行指令已发布，正在建立水循环..." }
}

const stopAuto = async (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  const { params } = await loadDeviceControlConfig(dNo)
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
  if (wasFaulted) {
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
  const { params } = await loadDeviceControlConfig(dNo)
  const staleSensors = getStaleSensors(state, Date.now(), params.data_timeout)
  if (staleSensors.length) throw new Error(`故障复位失败：${formatStaleSensors(staleSensors)}数据仍超时或无效`)
  const maximumTemperature = Math.max(state.lastSensors.temp_in, state.lastSensors.temp_out)
  if (maximumTemperature >= params.max_safe_temperature) throw new Error(`故障复位失败：当前水温仍达到安全上限(${maximumTemperature}℃)`)
  if (state.lastSensors.pressure >= params.max_safe_pressure) throw new Error(`故障复位失败：当前压力仍达到安全上限(${state.lastSensors.pressure}kPa)`)
  await executeDeviceAction(dNo, "heater", "off", "故障复位")
  await executeDeviceAction(dNo, "pump", "off", "故障复位")
  state.fsmState = FSM_STATES.STOPPED
  state.fsmText = FSM_STATE_TEXT.STOPPED
  state.faultCode = null
  state.faultReason = null
  state.countdown = 0
  state.lowFlowStartTime = 0
  state.coolingExitState = FSM_STATES.STOPPED
  notifyStatusChange(dNo)
  return { success: true, message: "故障已确认复位，系统回到停止状态" }
}

const initEngine = () => {
  syncAllDeviceConfigs().catch((error) => console.error("[WaterControl] 初始化配置同步失败:", error.message))
  if (!timerId) {
    timerId = setInterval(() => watchdogTick().catch((error) => console.error("[WaterControl] Watchdog error:", error)), 1000)
    if (typeof timerId.unref === "function") timerId.unref()
  }
}

const stopEngine = () => {
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
}

module.exports = {
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
