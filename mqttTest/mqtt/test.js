const mqtt = require('mqtt')

const mqttOptions = {
  clientId: `mqtt_test_${Date.now()}`,
  host: process.env.MQTT_HOST || '38.95.74.213',
  port: Number(process.env.MQTT_PORT || 6183),
  username: process.env.MQTT_USERNAME || 'sin',
  password: process.env.MQTT_PASSWORD || '1234',
}

const mqttClient = mqtt.connect(mqttOptions)

// 兼容 backend 期望的 nowTime/nowdate 格式
const nowTimeString = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const nowTimeOnly = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const nowDateOnly = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).slice(2)}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

const parseNumberOr = (value, fallback) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

const normalizeDeviceId = (deviceId) => String(deviceId || '202111').trim() || '202111'

// ========== Payload 构建函数（按后端实际期望的字段名） ==========

const buildHeartbeatPayload = (payload = {}) => ({
  d_no: normalizeDeviceId(payload.d_no ?? payload.deviceId),
  VStatus: parseNumberOr(payload.VStatus ?? payload.vstatus, 0),
  c_time: payload.c_time || nowTimeString(),
})

const buildSensorPayload = (payload = {}) => ({
  d_no: normalizeDeviceId(payload.d_no ?? payload.deviceId),
  temp: parseNumberOr(payload.temp, 26.5),
  flow: parseNumberOr(payload.flow, 18.6),
  pressurre: parseNumberOr(payload.pressurre ?? payload.pressure, 12.4),
  VStatus: parseNumberOr(payload.VStatus ?? payload.vstatus, 0),
  c_time: payload.c_time || nowTimeString(),
  online: payload.online || '实时数据',
})

const buildBehaviorPayload = (payload = {}) => ({
  d_no: normalizeDeviceId(payload.d_no ?? payload.deviceId),
  text_field: payload.text_field ?? payload.text ?? '',
  pid: payload.pid ?? payload.PID ?? '',
  c_time: payload.c_time || nowTimeString(),
  online: payload.online || '实时数据',
})

const buildErrorPayload = (payload = {}) => ({
  d_no: normalizeDeviceId(payload.d_no ?? payload.deviceId),
  e_no: payload.e_no || 'E001',
  type: String(payload.type ?? '3'),
  e_msg: payload.e_msg || '温度传感器连接超时',
  c_time: payload.c_time || nowTimeString(),
})

const buildTimeRequestPayload = (payload = {}) => ({
  d_no: normalizeDeviceId(payload.d_no ?? payload.deviceId),
  reason: payload.reason || 'power_on',
})

const buildDirectReportPayload = (payload = {}) => ({
  d_no: normalizeDeviceId(payload.d_no ?? payload.deviceId),
  config_id: parseNumberOr(payload.config_id, 7),
  value: payload.value ?? 'off',
})

// ========== 状态 ==========

const state = {
  connected: false,
  autoHeartbeat: {
    enabled: false,
    deviceId: '202111',
    vstatus: 0,
    intervalMs: 3000,
    timer: null,
  },
  lastReceivedDirect: null,
  lastReceivedUpdateTime: null,
}

// ========== 发布工具 ==========

const publishJson = (topic, data) => {
  return new Promise((resolve, reject) => {
    if (!state.connected) {
      return reject(new Error('MQTT 未连接'))
    }

    mqttClient.publish(topic, JSON.stringify(data), { qos: 0, retain: false }, (err) => {
      if (err) return reject(err)
      resolve({ topic, data })
    })
  })
}

// ========== 发送函数（topic 格式按后端实际：平的，不含 d_no） ==========

const sendHeartbeat = async ({ deviceId, payload }) => {
  const body = buildHeartbeatPayload({ deviceId, ...(payload || {}) })
  const topic = 'device/heartbeat'
  await publishJson(topic, body)
  return { topic, body }
}

const sendSensor = async ({ deviceId, payload }) => {
  const body = buildSensorPayload({ deviceId, ...(payload || {}) })
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

// ========== 自动心跳 ==========

const stopAutoHeartbeat = () => {
  if (state.autoHeartbeat.timer) {
    clearInterval(state.autoHeartbeat.timer)
    state.autoHeartbeat.timer = null
  }
  state.autoHeartbeat.enabled = false
}

const startAutoHeartbeat = ({ deviceId, vstatus = 0, intervalMs = 3000 }) => {
  stopAutoHeartbeat()

  state.autoHeartbeat.deviceId = normalizeDeviceId(deviceId)
  state.autoHeartbeat.vstatus = parseNumberOr(vstatus, 0)
  state.autoHeartbeat.intervalMs = Math.max(1000, parseNumberOr(intervalMs, 3000))
  state.autoHeartbeat.enabled = true

  const tick = async () => {
    try {
      await sendHeartbeat({
        deviceId: state.autoHeartbeat.deviceId,
        payload: { vstatus: state.autoHeartbeat.vstatus },
      })
    } catch (error) {
      console.error('自动心跳发送失败:', error.message)
    }
  }

  tick()
  state.autoHeartbeat.timer = setInterval(tick, state.autoHeartbeat.intervalMs)
}

const setAutoHeartbeatVstatus = (vstatus) => {
  state.autoHeartbeat.vstatus = parseNumberOr(vstatus, 0)
}

const setAutoHeartbeatInterval = (intervalMs) => {
  const next = Math.max(1000, parseNumberOr(intervalMs, 3000))
  state.autoHeartbeat.intervalMs = next

  if (!state.autoHeartbeat.enabled) return
  startAutoHeartbeat({
    deviceId: state.autoHeartbeat.deviceId,
    vstatus: state.autoHeartbeat.vstatus,
    intervalMs: next,
  })
}

// ========== 故障场景 ==========

const runFaultScenario = async ({ deviceId = '202111', code = 3, durationMs = 9000, e_no, e_msg }) => {
  const dNo = normalizeDeviceId(deviceId)
  const faultCode = parseNumberOr(code, 3)

  await sendHeartbeat({ deviceId: dNo, payload: { vstatus: faultCode } })
  await sendError({
    deviceId: dNo,
    payload: {
      e_no: e_no || `E00${faultCode}`,
      type: String(faultCode),
      e_msg: e_msg || `模拟故障 code=${faultCode}`,
    },
  })

  const waitMs = Math.max(0, parseNumberOr(durationMs, 9000))
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }

  await sendHeartbeat({ deviceId: dNo, payload: { vstatus: 0 } })
  return { deviceId: dNo, code: faultCode, durationMs: waitMs }
}

// ========== MQTT 事件 ==========

mqttClient.on('connect', () => {
  state.connected = true
  console.log('MQTT Test 客户端已连接')

  // 订阅指令下发 topic（后端下发指令）
  mqttClient.subscribe('device/direct', (err) => {
    if (err) {
      console.error('订阅 device/direct 失败:', err.message)
      return
    }
    console.log('已订阅 device/direct（指令下发）')
  })

  // 订阅时间同步 topic
  mqttClient.subscribe('device/updateTime', (err) => {
    if (err) {
      console.error('订阅 device/updateTime 失败:', err.message)
      return
    }
    console.log('已订阅 device/updateTime（时间同步）')
  })
})

mqttClient.on('message', (topic, rawPayload) => {
  const now = new Date().toLocaleTimeString()
  try {
    const data = JSON.parse(rawPayload.toString())

    if (topic === 'device/direct') {
      // 后端下发指令
      state.lastReceivedDirect = { time: now, topic, data }
      console.log(`[${now}] 收到指令下发 device/direct:`, JSON.stringify(data))
      // 模拟设备端自动上报执行结果（可选，发布到 device/direct）
      // 不做自动上报，由用户触发
    } else if (topic === 'device/updateTime') {
      // 后端时间同步
      state.lastReceivedUpdateTime = { time: now, topic, data }
      console.log(`[${now}] 收到时间同步 device/updateTime:`, JSON.stringify(data))
    } else {
      console.log(`[${now}] 收到未知主题 ${topic}:`, rawPayload.toString())
    }
  } catch (e) {
    console.log(`[${now}] 收到 ${topic}:`, rawPayload.toString())
  }
})

mqttClient.on('error', (error) => {
  console.error('MQTT 连接错误:', error.message)
})

mqttClient.on('reconnect', () => {
  console.log('MQTT 正在重连...')
})

mqttClient.on('close', () => {
  state.connected = false
  console.log('MQTT 已断开')
})

module.exports = {
  state,
  nowTimeString,
  sendHeartbeat,
  sendSensor,
  sendBehavior,
  sendError,
  sendTimeRequest,
  sendDirectReport,
  startAutoHeartbeat,
  stopAutoHeartbeat,
  setAutoHeartbeatVstatus,
  setAutoHeartbeatInterval,
  runFaultScenario,
}