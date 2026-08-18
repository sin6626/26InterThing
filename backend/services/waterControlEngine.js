const { buildDeviceCommandEnvelope } = require("../mqtt/commandMapper")

const DEFAULT_CONTROL_PARAMS = {
  target_temperature: 35.0,
  temperature_hysteresis: 0.5,
  min_safe_flow: 0.5,
  max_safe_pressure: 150.0,
  max_safe_temperature: 45.0,
  build_flow_timeout: 5,
  low_flow_confirm_time: 2,
  cooling_delay: 10,
  data_timeout: 5,
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

// 内存中维护各设备的独立水循环控制状态
const deviceStateMap = new Map()

// 依赖注入（便于单元测试中替换）
let mqttClientDep = null
let broadcastDep = null
let configLoaderDep = null
let timerId = null

const getOrCreateDeviceState = (dNo) => {
  if (!deviceStateMap.has(dNo)) {
    deviceStateMap.set(dNo, {
      deviceId: dNo,
      mode: "manual", // 'manual' | 'auto'
      fsmState: FSM_STATES.STOPPED,
      fsmText: FSM_STATE_TEXT.STOPPED,
      faultReason: null,
      countdown: 0,
      lowFlowStartTime: 0,
      lastSensors: {
        temp_in: null,
        temp_out: null,
        flow_rate: null,
        pressure: null,
        c_time: null,
      },
      lastSensorTime: 0,
      pumpState: "off",
      heaterState: "off",
    })
  }
  return deviceStateMap.get(dNo)
}

// 从数据库读取 10 项参数及指令配置
const loadDeviceControlConfig = async (dNo) => {
  let rows = []
  if (typeof configLoaderDep === "function") {
    rows = await configLoaderDep(dNo)
  } else {
    try {
      const directRepository = require("../repositories/directRepository")
      rows = await directRepository.getDeviceConfigRows(dNo)
    } catch {
      rows = []
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
      const numVal = parseFloat(row.value)
      if (Number.isFinite(numVal)) {
        params[row.topic] = numVal
      }
    }
  }

  return { configsByTopic, masterMode, params }
}

// 下发动作并记录操作历史
const executeDeviceAction = async (dNo, topic, value, remark = "应用层自动控制") => {
  const state = getOrCreateDeviceState(dNo)
  if (topic === "pump") state.pumpState = value
  if (topic === "heater") state.heaterState = value

  try {
    const { configsByTopic } = await loadDeviceControlConfig(dNo)
    const config = configsByTopic[topic]
    if (!config) return

    const commandEnvelope = buildDeviceCommandEnvelope({
      d_no: dNo,
      config_id: config.id,
      topic: config.topic,
      publish_topic: config.publish_topic,
      payload_template: config.payload_template,
      value_map: config.value_map,
      value,
    })

    let mqttClient = mqttClientDep
    if (!mqttClient) {
      try {
        mqttClient = require("../mqtt")
      } catch {
        mqttClient = null
      }
    }

    if (mqttClient && typeof mqttClient.publishToDevice === "function") {
      await mqttClient.publishToDevice(commandEnvelope.topic, commandEnvelope.payload)
    }

    if (typeof configLoaderDep !== "function") {
      try {
        const directHistoryRepository = require("../repositories/directHistoryRepository")
        await directHistoryRepository.insertDirectHistory({
          config_id: config.id,
          d_no: dNo,
          direct_name: config.t_name || topic,
          direct_type: config.topic || "device",
          new_value: value,
          old_value: value === "on" ? "off" : "on",
          remark,
        })
      } catch {}
    }
  } catch (err) {
    console.error(`[WaterControl] 执行动作 ${topic}=${value} 失败:`, err.message)
  }
}

// 广播当前设备状态
const notifyStatusChange = (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  let statusInfo = null
  try {
    const heartbeat = require("../mqtt/mqtt_hander/heartbeat")
    statusInfo = heartbeat.getDeviceStatus(dNo)
  } catch {
    statusInfo = null
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
    broadcast("device_status", {
      d_no: dNo,
      status: statusInfo?.status || "online",
      vstatus: statusInfo?.vstatus ?? 0,
      level: state.fsmState === FSM_STATES.FAULT ? "error" : (statusInfo?.level || "normal"),
      text: state.fsmState === FSM_STATES.FAULT ? (state.faultReason || "设备故障") : (statusInfo?.text || "正常"),
      updated_at: statusInfo?.updated_at || new Date().toLocaleString(),
      control: getDeviceControlStatus(dNo),
    })
  }
}

// 触发安全故障处理
const triggerFault = async (dNo, reason) => {
  const state = getOrCreateDeviceState(dNo)
  state.fsmState = FSM_STATES.FAULT
  state.fsmText = FSM_STATE_TEXT.FAULT
  state.faultReason = reason
  state.countdown = 0
  state.lowFlowStartTime = 0

  console.warn(`[WaterControl][故障保护] 设备 ${dNo}: ${reason}`)

  // 安全动作：立即关闭加热
  await executeDeviceAction(dNo, "heater", "off", `故障保护: ${reason}`)

  // 如果非超温故障（如超压、低流、断连等），同时停水泵
  if (!reason.includes("超温") && !reason.includes("水温超限")) {
    await executeDeviceAction(dNo, "pump", "off", `故障保护: ${reason}`)
  }

  // 记录错误信息到数据库
  if (typeof configLoaderDep !== "function") {
    try {
      const db = require("../db")
      const sql = `INSERT INTO t_error_msg (d_no, c_time, e_msg, e_no, type) VALUES (?, NOW(), ?, ?, ?)`
      db.query(sql, [dNo, `安全保护: ${reason}`, "ERR_SAFE", "7"])
    } catch (err) {
      // 写入失败时降级
    }
  }

  // 广播告警
  let broadcast = broadcastDep
  if (!broadcast) {
    try {
      broadcast = require("../websocket").broadcastToClients
    } catch {
      broadcast = null
    }
  }

  if (typeof broadcast === "function") {
    broadcast("alarm_realtime", {
      d_no: dNo,
      code: 7,
      level: "error",
      text: `安全保护: ${reason}`,
      updated_at: new Date().toLocaleString(),
    })
  }

  notifyStatusChange(dNo)
}

// 手动模式开启加热前的安全审查（5项前置审查）
const checkHeaterSafety = async (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  const { params } = await loadDeviceControlConfig(dNo)
  const now = Date.now()
  const sensors = state.lastSensors

  // 1. 数据新鲜度
  if (now - state.lastSensorTime > params.data_timeout * 1000) {
    return { safe: false, reason: "传感器数据超时未更新，禁止加热" }
  }

  // 2. 水泵开启状态
  if (state.pumpState !== "on") {
    return { safe: false, reason: "水泵未开启，禁止加热" }
  }

  // 3. 流量达标检查
  const flow = Number(sensors.flow_rate ?? 0)
  if (flow < params.min_safe_flow) {
    return {
      safe: false,
      reason: `当前流量不足(${flow.toFixed(2)} < ${params.min_safe_flow} L/min)，严禁打开加热防止干烧`,
    }
  }

  // 4. 压力检查
  const pressure = Number(sensors.pressure ?? 0)
  if (params.max_safe_pressure && pressure >= params.max_safe_pressure) {
    return {
      safe: false,
      reason: `当前管路压力过高(${pressure.toFixed(2)} >= ${params.max_safe_pressure} kPa)`,
    }
  }

  // 5. 温度检查
  const tempOut = Number(sensors.temp_out ?? 0)
  const tempIn = Number(sensors.temp_in ?? 0)
  if (tempOut >= params.max_safe_temperature || tempIn >= params.max_safe_temperature) {
    const maxT = Math.max(tempOut, tempIn)
    return {
      safe: false,
      reason: `当前水温过高(${maxT.toFixed(1)} >= ${params.max_safe_temperature} ℃)`,
    }
  }

  return { safe: true }
}

// 接收传感器数据并执行闭环控制
const onSensorData = async (dNo, rawData) => {
  if (!rawData || !dNo) return
  const state = getOrCreateDeviceState(dNo)

  const tempIn = parseFloat(rawData.temp_in ?? rawData.field3)
  const tempOut = parseFloat(rawData.temp_out ?? rawData.field2)
  const flowRate = parseFloat(rawData.flow_rate ?? rawData.field5)
  const pressure = parseFloat(rawData.pressure ?? rawData.field4)

  state.lastSensors = {
    temp_in: Number.isFinite(tempIn) ? tempIn : null,
    temp_out: Number.isFinite(tempOut) ? tempOut : null,
    flow_rate: Number.isFinite(flowRate) ? flowRate : null,
    pressure: Number.isFinite(pressure) ? pressure : null,
    c_time: rawData.c_time || rawData.time || null,
  }
  state.lastSensorTime = Date.now()

  // 同步数据库中的控制模式
  const { masterMode, params } = await loadDeviceControlConfig(dNo)
  state.mode = masterMode

  // 如果处于停止或手动模式，不执行自动控温，只维护传感器数值
  if (state.mode !== "auto" || state.fsmState === FSM_STATES.STOPPED || state.fsmState === FSM_STATES.FAULT) {
    return
  }

  // 状态机处理
  if (state.fsmState === FSM_STATES.BUILDING_FLOW) {
    // 正在建流阶段：检查流量是否达标
    if (state.lastSensors.flow_rate !== null && state.lastSensors.flow_rate >= params.min_safe_flow) {
      if (params.max_safe_pressure && state.lastSensors.pressure !== null && state.lastSensors.pressure >= params.max_safe_pressure) {
        await triggerFault(dNo, `建流超压(${state.lastSensors.pressure} >= ${params.max_safe_pressure} kPa)`)
        return
      }
      // 建流成功！切入正常运行
      state.fsmState = FSM_STATES.RUNNING
      state.fsmText = FSM_STATE_TEXT.RUNNING
      state.countdown = 0
      console.log(`[WaterControl] 设备 ${dNo} 建流成功，进入 RUNNING 自动运行状态`)
      notifyStatusChange(dNo)
    }
    return
  }

  if (state.fsmState === FSM_STATES.RUNNING) {
    // 1. 安全守卫（超温检查）
    if (
      (state.lastSensors.temp_in !== null && state.lastSensors.temp_in >= params.max_safe_temperature) ||
      (state.lastSensors.temp_out !== null && state.lastSensors.temp_out >= params.max_safe_temperature)
    ) {
      const maxTemp = Math.max(state.lastSensors.temp_in || 0, state.lastSensors.temp_out || 0)
      await triggerFault(dNo, `水温超限(${maxTemp.toFixed(1)}℃ >= ${params.max_safe_temperature}℃)`)
      return
    }

    // 2. 安全守卫（超压检查）
    if (params.max_safe_pressure && state.lastSensors.pressure !== null && state.lastSensors.pressure >= params.max_safe_pressure) {
      await triggerFault(dNo, `管路超压(${state.lastSensors.pressure.toFixed(1)}kPa >= ${params.max_safe_pressure}kPa)`)
      return
    }

    // 3. 安全守卫（运行中低流量防干烧）
    if (state.lastSensors.flow_rate !== null && state.lastSensors.flow_rate < params.min_safe_flow) {
      const now = Date.now()
      if (!state.lowFlowStartTime) {
        state.lowFlowStartTime = now
      } else if (now - state.lowFlowStartTime >= params.low_flow_confirm_time * 1000) {
        await triggerFault(dNo, `运行中流量过低(${state.lastSensors.flow_rate.toFixed(2)}L/min < ${params.min_safe_flow}L/min)`)
        return
      }
    } else {
      state.lowFlowStartTime = 0
    }

    // 4. 回差温度控制（以 temp_out 为控制基准）
    if (state.lastSensors.temp_out !== null) {
      const currentTemp = state.lastSensors.temp_out
      const lowThreshold = params.target_temperature - params.temperature_hysteresis
      const highThreshold = params.target_temperature

      if (currentTemp <= lowThreshold) {
        if (state.heaterState !== "on") {
          console.log(`[WaterControl] 设备 ${dNo} 水温(${currentTemp}℃) <= 下限(${lowThreshold}℃)，自动开启加热`)
          await executeDeviceAction(dNo, "heater", "on", "自动控温: 水温低于下限")
          notifyStatusChange(dNo)
        }
      } else if (currentTemp >= highThreshold) {
        if (state.heaterState !== "off") {
          console.log(`[WaterControl] 设备 ${dNo} 水温(${currentTemp}℃) >= 目标(${highThreshold}℃)，自动关闭加热`)
          await executeDeviceAction(dNo, "heater", "off", "自动控温: 水温达到目标")
          notifyStatusChange(dNo)
        }
      }
    }
    return
  }

  if (state.fsmState === FSM_STATES.COOLING) {
    // 冷却阶段如果流量降为0，直接提前停泵
    if (state.lastSensors.flow_rate !== null && state.lastSensors.flow_rate <= 0) {
      await executeDeviceAction(dNo, "pump", "off", "冷却期间无流量停泵")
      state.fsmState = FSM_STATES.STOPPED
      state.fsmText = FSM_STATE_TEXT.STOPPED
      state.countdown = 0
      notifyStatusChange(dNo)
    }
  }
}

// 1秒周期看门狗巡检
const watchdogTick = async () => {
  const now = Date.now()
  for (const [dNo, state] of deviceStateMap) {
    const { params } = await loadDeviceControlConfig(dNo)

    // 传感器超时检查
    if (state.mode === "auto" && state.fsmState !== FSM_STATES.STOPPED && state.fsmState !== FSM_STATES.FAULT) {
      if (state.lastSensorTime > 0 && now - state.lastSensorTime > params.data_timeout * 1000) {
        await triggerFault(dNo, `传感器数据超时未更新(超过${params.data_timeout}s)`)
        continue
      }
    }

    // 建流超时检查
    if (state.fsmState === FSM_STATES.BUILDING_FLOW) {
      if (state.countdown > 0) {
        state.countdown -= 1
      }
      if (state.countdown <= 0) {
        await triggerFault(dNo, `启动未建流(超过${params.build_flow_timeout}s未达到最低流量)`)
      } else {
        notifyStatusChange(dNo)
      }
      continue
    }

    // 冷却延时倒计时检查
    if (state.fsmState === FSM_STATES.COOLING) {
      if (state.countdown > 0) {
        state.countdown -= 1
      }
      if (state.countdown <= 0) {
        await executeDeviceAction(dNo, "pump", "off", "冷却延时结束自动停泵")
        state.fsmState = FSM_STATES.STOPPED
        state.fsmText = FSM_STATE_TEXT.STOPPED
        console.log(`[WaterControl] 设备 ${dNo} 冷却延时结束，进入 STOPPED 状态`)
      }
      notifyStatusChange(dNo)
    }
  }
}

// 启动自动运行
const startAuto = async (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  const { params } = await loadDeviceControlConfig(dNo)
  const now = Date.now()

  // 1. 检查传感器新鲜度
  if (state.lastSensorTime === 0 || now - state.lastSensorTime > params.data_timeout * 1000) {
    throw new Error("启动失败：传感器离线或数据超时未更新")
  }

  // 2. 检查初始温度是否超限
  const maxTemp = Math.max(state.lastSensors.temp_in || 0, state.lastSensors.temp_out || 0)
  if (maxTemp >= params.max_safe_temperature) {
    throw new Error(`启动失败：当前水温(${maxTemp}℃)已超过安全上限(${params.max_safe_temperature}℃)`)
  }

  // 3. 初始动作：确保加热关闭，开启水泵建流
  state.fsmState = FSM_STATES.BUILDING_FLOW
  state.fsmText = FSM_STATE_TEXT.BUILDING_FLOW
  state.countdown = params.build_flow_timeout
  state.faultReason = null

  await executeDeviceAction(dNo, "heater", "off", "自动运行启动: 初始关闭加热")
  await executeDeviceAction(dNo, "pump", "on", "自动运行启动: 开启水泵建流")

  notifyStatusChange(dNo)
  return { success: true, message: "自动运行已启动，正在建立水循环..." }
}

// 停止自动运行
const stopAuto = async (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  const { params } = await loadDeviceControlConfig(dNo)

  // 立即关闭加热
  await executeDeviceAction(dNo, "heater", "off", "用户停止: 立即关闭加热")

  // 若水泵在运行，进入冷却延时
  if (state.pumpState === "on") {
    state.fsmState = FSM_STATES.COOLING
    state.fsmText = FSM_STATE_TEXT.COOLING
    state.countdown = params.cooling_delay
    console.log(`[WaterControl] 设备 ${dNo} 进入 COOLING 冷却阶段(${params.cooling_delay}s)`)
  } else {
    state.fsmState = FSM_STATES.STOPPED
    state.fsmText = FSM_STATE_TEXT.STOPPED
    state.countdown = 0
  }

  notifyStatusChange(dNo)
  return { success: true, message: "已发出停止指令，进入冷却流程" }
}

// 故障复位
const resetFault = async (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  state.fsmState = FSM_STATES.STOPPED
  state.fsmText = FSM_STATE_TEXT.STOPPED
  state.faultReason = null
  state.countdown = 0
  state.lowFlowStartTime = 0

  await executeDeviceAction(dNo, "heater", "off", "故障复位")
  await executeDeviceAction(dNo, "pump", "off", "故障复位")

  notifyStatusChange(dNo)
  return { success: true, message: "故障已复位，系统回到停止状态" }
}

// 获取设备当前水循环控制状态对象
const getDeviceControlStatus = (dNo) => {
  const state = getOrCreateDeviceState(dNo)
  return {
    deviceId: dNo,
    mode: state.mode,
    fsmState: state.fsmState,
    fsmText: state.fsmText,
    faultReason: state.faultReason,
    countdown: state.countdown,
    pumpState: state.pumpState,
    heaterState: state.heaterState,
    lastSensors: state.lastSensors,
  }
}

// 初始化定时器
const initEngine = () => {
  if (!timerId) {
    timerId = setInterval(() => {
      watchdogTick().catch((err) => console.error("[WaterControl] Watchdog error:", err))
    }, 1000)
    if (timerId && typeof timerId.unref === "function") {
      timerId.unref()
    }
  }
}

const stopEngine = () => {
  if (timerId) {
    clearInterval(timerId)
    timerId = null
  }
}

// 测试辅助方法
const __setMqttClientForTests = (client) => {
  mqttClientDep = client
}
const __setBroadcastForTests = (fn) => {
  broadcastDep = fn
}
const __setConfigLoaderForTests = (fn) => {
  configLoaderDep = fn
}
const __resetForTests = () => {
  deviceStateMap.clear()
  mqttClientDep = null
  broadcastDep = null
  configLoaderDep = null
  stopEngine()
}

module.exports = {
  DEFAULT_CONTROL_PARAMS,
  FSM_STATES,
  FSM_STATE_TEXT,
  __resetForTests,
  __setBroadcastForTests,
  __setConfigLoaderForTests,
  __setMqttClientForTests,
  checkHeaterSafety,
  getDeviceControlStatus,
  getOrCreateDeviceState,
  initEngine,
  onSensorData,
  resetFault,
  startAuto,
  stopAuto,
  stopEngine,
  triggerFault,
  watchdogTick,
}
