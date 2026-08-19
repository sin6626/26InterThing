const mqtt = require('mqtt')

// 当前 Broker 配置
let mqttOptions = {
  clientId: process.env.MQTT_CLIENT_ID || `device_sim_${Date.now()}`,
  host: process.env.MQTT_HOST || 'localhost',
  port: Number(process.env.MQTT_PORT || 1883),
  username: process.env.MQTT_USERNAME || 'sin',
  password: process.env.MQTT_PASSWORD || '1234',
}

let mqttClient = null

// 时间格式化辅助函数
const nowTimeString = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const parseNumberOr = (value, fallback) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

const normalizeDeviceId = (deviceId) => String(deviceId || '202111').trim() || '202111'

// ========== 全局状态 ==========

const state = {
  connected: false,
  mqttOptions: { ...mqttOptions },
  deviceId: '202111',
  physics: {
    temp_out: 28.5,
    temp_in: 25.0,
    flow_rate: 0.8,
    pressure: 85.0,
    heat_Y1: 0,
    water_Y2: 1,
    vstatus: 0,
  },
  autoSensor: {
    enabled: false,
    intervalMs: 1000,
    jitter: true,
    timer: null,
  },
  autoHeartbeat: {
    enabled: false,
    vstatus: 0,
    intervalMs: 3000,
    timer: null,
  },
  receivedDirectList: [], // 最近 30 条下发指令历史
  lastReceivedUpdateTime: null,
}

// ========== MQTT 连接管理 ==========

const initMqttClient = () => {
  if (mqttClient) {
    try {
      mqttClient.end(true)
    } catch {}
  }

  mqttClient = mqtt.connect(mqttOptions)

  mqttClient.on('connect', () => {
    state.connected = true
    console.log(`[MQTT Sim] 连接成功: ${mqttOptions.host}:${mqttOptions.port} (clientId: ${mqttOptions.clientId})`)

    // 订阅指令下发与时间同步
    mqttClient.subscribe('device/direct', (err) => {
      if (err) console.error('订阅 device/direct 失败:', err.message)
      else console.log('[MQTT Sim] 已订阅指令下发主题: device/direct')
    })

    mqttClient.subscribe('device/updateTime', (err) => {
      if (err) console.error('订阅 device/updateTime 失败:', err.message)
      else console.log('[MQTT Sim] 已订阅时间同步主题: device/updateTime')
    })
  })

  mqttClient.on('message', (topic, rawPayload) => {
    const rawStr = rawPayload.toString()
    const now = new Date().toLocaleTimeString()
    let parsedData = null
    let isModbus = false
    let summary = ''

    try {
      parsedData = JSON.parse(rawStr)
      if (parsedData && parsedData.mb) {
        isModbus = true
        const mb = String(parsedData.mb).toLowerCase()
        if (mb.includes('010600010001')) summary = 'Modbus: 开启水泵 (010600010001)'
        else if (mb.includes('010600010000')) summary = 'Modbus: 关闭水泵 (010600010000)'
        else if (mb.includes('010600020001')) summary = 'Modbus: 开启加热器 (010600020001)'
        else if (mb.includes('010600020000')) summary = 'Modbus: 关闭加热器 (010600020000)'
        else summary = `Modbus: 原始报文 [${mb}]`
      } else if (parsedData && parsedData.topic) {
        summary = `JSON指令: ${parsedData.topic} = ${parsedData.value}`
      }
    } catch {
      summary = `原始字符串: ${rawStr}`
    }

    if (topic === 'device/direct') {
      const record = {
        id: Date.now() + Math.random().toString(36).slice(2, 6),
        time: now,
        timestamp: nowTimeString(),
        topic,
        raw: rawStr,
        data: parsedData,
        isModbus,
        summary: summary || '普通指令',
      }
      state.receivedDirectList.unshift(record)
      if (state.receivedDirectList.length > 30) {
        state.receivedDirectList.pop()
      }
      console.log(`[MQTT Sim][${now}] 收到指令:`, summary || rawStr)
    } else if (topic === 'device/updateTime') {
      state.lastReceivedUpdateTime = {
        time: now,
        timestamp: nowTimeString(),
        topic,
        data: parsedData || rawStr,
      }
      console.log(`[MQTT Sim][${now}] 收到时间同步:`, rawStr)
    }
  })

  mqttClient.on('error', (err) => {
    console.error('[MQTT Sim] 连接错误:', err.message)
  })

  mqttClient.on('reconnect', () => {
    console.log('[MQTT Sim] 正在重连...')
  })

  mqttClient.on('close', () => {
    state.connected = false
    console.log('[MQTT Sim] 连接断开')
  })
}

// 动态重连
const reconnectMqtt = (newOptions = {}) => {
  mqttOptions = {
    ...mqttOptions,
    ...newOptions,
    port: Number(newOptions.port || mqttOptions.port),
  }
  state.mqttOptions = { ...mqttOptions }
  initMqttClient()
  return state.mqttOptions
}

// ========== 发布底层方法 ==========

const publishJson = (topic, data) => {
  return new Promise((resolve, reject) => {
    if (!state.connected || !mqttClient) {
      return reject(new Error('MQTT 客户端未连接'))
    }

    mqttClient.publish(topic, JSON.stringify(data), { qos: 0, retain: false }, (err) => {
      if (err) return reject(err)
      resolve({ topic, data })
    })
  })
}

// ========== Payload 构建 ==========

const buildHeartbeatPayload = (payload = {}) => ({
  d_no: normalizeDeviceId(payload.d_no ?? payload.deviceId ?? state.deviceId),
  VStatus: parseNumberOr(payload.VStatus ?? payload.vstatus, state.physics.vstatus),
  c_time: payload.c_time || nowTimeString(),
})

const buildWaterCycleSensorPayload = (payload = {}, jitter = false) => {
  const p = state.physics
  const dNo = normalizeDeviceId(payload.d_no ?? payload.deviceId ?? state.deviceId)

  let tempOut = parseNumberOr(payload.temp_out, p.temp_out)
  let tempIn = parseNumberOr(payload.temp_in, p.temp_in)
  let flowRate = parseNumberOr(payload.flow_rate ?? payload.flow, p.flow_rate)
  let pressure = parseNumberOr(payload.pressure ?? payload.pressurre, p.pressure)
  const heatY1 = parseNumberOr(payload.heat_Y1, p.heat_Y1)
  const waterY2 = parseNumberOr(payload.water_Y2, p.water_Y2)
  const vstatus = parseNumberOr(payload.VStatus ?? payload.vstatus, p.vstatus)

  // 微小自然波动
  if (jitter) {
    const randomJitter = (range) => Number(((Math.random() - 0.5) * range).toFixed(2))
    tempOut = Number((tempOut + randomJitter(0.2)).toFixed(2))
    tempIn = Number((tempIn + randomJitter(0.15)).toFixed(2))
    if (flowRate > 0) flowRate = Number(Math.max(0, flowRate + randomJitter(0.04)).toFixed(2))
    if (pressure > 0) pressure = Number(Math.max(0, pressure + randomJitter(0.6)).toFixed(1))
  }

  return {
    d_no: dNo,
    c_time: payload.c_time || nowTimeString(),
    temp_out: tempOut,
    temp_in: tempIn,
    flow_rate: flowRate,
    pressure: pressure,
    heat_Y1: heatY1,
    water_Y2: waterY2,
    VStatus: vstatus,
    online: payload.online || '实时数据',
  }
}

const buildBehaviorPayload = (payload = {}) => ({
  d_no: normalizeDeviceId(payload.d_no ?? payload.deviceId ?? state.deviceId),
  text_field: payload.text_field ?? payload.text ?? '水泵运行正常',
  pid: payload.pid ?? payload.PID ?? 'CARD_8899A',
  c_time: payload.c_time || nowTimeString(),
  online: payload.online || '实时数据',
})

const buildErrorPayload = (payload = {}) => ({
  d_no: normalizeDeviceId(payload.d_no ?? payload.deviceId ?? state.deviceId),
  e_no: payload.e_no || 'E001',
  type: String(payload.type ?? '3'),
  e_msg: payload.e_msg || '温度传感器连接超时',
  c_time: payload.c_time || nowTimeString(),
})

const buildTimeRequestPayload = (payload = {}) => ({
  d_no: normalizeDeviceId(payload.d_no ?? payload.deviceId ?? state.deviceId),
  reason: payload.reason || 'power_on',
})

const buildDirectReportPayload = (payload = {}) => ({
  d_no: normalizeDeviceId(payload.d_no ?? payload.deviceId ?? state.deviceId),
  config_id: parseNumberOr(payload.config_id, 7),
  value: payload.value ?? 'off',
})

// ========== 主动发送方法 ==========

const sendHeartbeat = async ({ deviceId, payload }) => {
  const body = buildHeartbeatPayload({ deviceId, ...(payload || {}) })
  const topic = 'device/heartbeat'
  await publishJson(topic, body)
  return { topic, body }
}

const sendSensor = async ({ deviceId, payload, custom = false }) => {
  let body
  if (custom && payload && typeof payload === 'object') {
    body = {
      d_no: normalizeDeviceId(deviceId || payload.d_no || state.deviceId),
      c_time: payload.c_time || nowTimeString(),
      ...payload,
    }
  } else {
    body = buildWaterCycleSensorPayload({ deviceId, ...(payload || {}) }, false)
  }
  const topic = 'device/sensor'
  await publishJson(topic, body)
  return { topic, body }
}

const sendBehavior = async ({ deviceId, payload }) => {
  const body = buildBehaviorPayload({ deviceId, ...(payload || {}) })
  const topic = 'device/behavior'
  await publishJson(topic, body)
  return { topic, body }
}

const sendError = async ({ deviceId, payload }) => {
  const body = buildErrorPayload({ deviceId, ...(payload || {}) })
  const topic = 'device/error'
  await publishJson(topic, body)
  return { topic, body }
}

const sendTimeRequest = async ({ deviceId, payload }) => {
  const body = buildTimeRequestPayload({ deviceId, ...(payload || {}) })
  const topic = 'device/timeRequest'
  await publishJson(topic, body)
  return { topic, body }
}

const sendDirectReport = async ({ deviceId, payload }) => {
  const body = buildDirectReportPayload({ deviceId, ...(payload || {}) })
  const topic = 'device/direct'
  await publishJson(topic, body)
  return { topic, body }
}

// ========== 物理状态更新 ==========

const updatePhysics = (updates = {}) => {
  state.physics = {
    ...state.physics,
    ...updates,
  }
  return state.physics
}

// ========== 自动传感器上报 ==========

const stopAutoSensor = () => {
  if (state.autoSensor.timer) {
    clearInterval(state.autoSensor.timer)
    state.autoSensor.timer = null
  }
  state.autoSensor.enabled = false
}

const startAutoSensor = ({ intervalMs = 1000, jitter = true } = {}) => {
  stopAutoSensor()
  state.autoSensor.intervalMs = Math.max(200, parseNumberOr(intervalMs, 1000))
  state.autoSensor.jitter = Boolean(jitter)
  state.autoSensor.enabled = true

  const tick = async () => {
    try {
      const body = buildWaterCycleSensorPayload({}, state.autoSensor.jitter)
      await publishJson('device/sensor', body)
    } catch (err) {
      console.error('[MQTT Sim] 自动传感器上报失败:', err.message)
    }
  }

  tick()
  state.autoSensor.timer = setInterval(tick, state.autoSensor.intervalMs)
}

// ========== 自动心跳 ==========

const stopAutoHeartbeat = () => {
  if (state.autoHeartbeat.timer) {
    clearInterval(state.autoHeartbeat.timer)
    state.autoHeartbeat.timer = null
  }
  state.autoHeartbeat.enabled = false
}

const startAutoHeartbeat = ({ vstatus = 0, intervalMs = 3000 } = {}) => {
  stopAutoHeartbeat()
  state.autoHeartbeat.vstatus = parseNumberOr(vstatus, state.physics.vstatus)
  state.autoHeartbeat.intervalMs = Math.max(500, parseNumberOr(intervalMs, 3000))
  state.autoHeartbeat.enabled = true

  const tick = async () => {
    try {
      await sendHeartbeat({
        deviceId: state.deviceId,
        payload: { vstatus: state.autoHeartbeat.vstatus },
      })
    } catch (err) {
      console.error('[MQTT Sim] 自动心跳发送失败:', err.message)
    }
  }

  tick()
  state.autoHeartbeat.timer = setInterval(tick, state.autoHeartbeat.intervalMs)
}

// ========== 一键测试场景宏（Macro） ==========

const runScenario = async (type, options = {}) => {
  const dNo = normalizeDeviceId(options.deviceId || state.deviceId)

  switch (type) {
    // 1. 启动未建流：水泵开但流量为0持续6秒
    case 'flow_timeout': {
      updatePhysics({ water_Y2: 1, heat_Y1: 0, flow_rate: 0.0, pressure: 20.0, temp_out: 28.0 })
      for (let i = 0; i < 6; i++) {
        await sendSensor({ deviceId: dNo, payload: { flow_rate: 0.0, water_Y2: 1, heat_Y1: 0, pressure: 20.0 } })
        await new Promise((r) => setTimeout(r, 1000))
      }
      return { message: '已模拟【建流超时】场景（开泵流量=0持续6秒，已触发停泵报警）' }
    }

    // 2. 运行中失流防干烧：加热开着但流量突降为 0.1 持续 4 秒
    case 'flow_loss': {
      updatePhysics({ water_Y2: 1, heat_Y1: 1, flow_rate: 0.1, pressure: 25.0, temp_out: 34.8 })
      for (let i = 0; i < 4; i++) {
        await sendSensor({ deviceId: dNo, payload: { flow_rate: 0.1, water_Y2: 1, heat_Y1: 1, pressure: 25.0 } })
        await new Promise((r) => setTimeout(r, 1000))
      }
      return { message: '已模拟【失流干烧】场景（加热中流量0.1L/min持续4s，已触发切断加热）' }
    }

    // 3. 超温保护：出口水温飙升至 46.5℃
    case 'over_temp': {
      updatePhysics({ temp_out: 46.5, flow_rate: 0.8, pressure: 85.0, heat_Y1: 1, water_Y2: 1 })
      await sendSensor({ deviceId: dNo, payload: { temp_out: 46.5, flow_rate: 0.8, pressure: 85.0, heat_Y1: 1, water_Y2: 1 } })
      return { message: '已模拟【超温告警】场景（temp_out = 46.5℃，已触发关加热保泵散热）' }
    }

    // 4. 超压急停：管路压力跳升至 160kPa
    case 'over_pressure': {
      updatePhysics({ pressure: 160.0, temp_out: 32.0, flow_rate: 0.8, heat_Y1: 1, water_Y2: 1 })
      await sendSensor({ deviceId: dNo, payload: { pressure: 160.0, temp_out: 32.0, flow_rate: 0.8, heat_Y1: 1, water_Y2: 1 } })
      return { message: '已模拟【超压急停】场景（pressure = 160.0kPa，已触发双切断急停）' }
    }

    // 5. 传感器中断：停止上报 6s
    case 'sensor_pause': {
      stopAutoSensor()
      await new Promise((r) => setTimeout(r, 6000))
      return { message: '已模拟【传感器中断】场景（暂停数据 6s 触发看门狗）' }
    }

    // 6. 断网离线：停止心跳 7s
    case 'offline': {
      stopAutoHeartbeat()
      await new Promise((r) => setTimeout(r, 7000))
      return { message: '已模拟【断网离线】场景（暂停心跳 7s，设备已切为离线）' }
    }

    // 7. 重新上线：发送心跳
    case 'online_recover': {
      await sendHeartbeat({ deviceId: dNo, payload: { vstatus: 0 } })
      startAutoHeartbeat({ vstatus: 0, intervalMs: 3000 })
      return { message: '已模拟【重新上线】场景（发送上线心跳并启动自动心跳）' }
    }

    // 8. 错误上报
    case 'custom_error': {
      const eNo = options.e_no || 'E201'
      const type = String(options.type || '6')
      const msg = options.e_msg || '模拟管路超压故障'
      await sendError({ deviceId: dNo, payload: { e_no: eNo, type, e_msg: msg } })
      await sendHeartbeat({ deviceId: dNo, payload: { vstatus: Number(type) } })
      return { message: `已模拟【错误上报】(${eNo}: ${msg})` }
    }

    default:
      throw new Error(`未知场景类型: ${type}`)
  }
}

// 初始化启动连接
initMqttClient()

module.exports = {
  buildBehaviorPayload,
  buildDirectReportPayload,
  buildErrorPayload,
  buildHeartbeatPayload,
  buildTimeRequestPayload,
  buildWaterCycleSensorPayload,
  nowTimeString,
  reconnectMqtt,
  runScenario,
  sendBehavior,
  sendDirectReport,
  sendError,
  sendHeartbeat,
  sendSensor,
  sendTimeRequest,
  startAutoHeartbeat,
  startAutoSensor,
  state,
  stopAutoHeartbeat,
  stopAutoSensor,
  updatePhysics,
}