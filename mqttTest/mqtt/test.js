const mqtt = require('mqtt')

let mqttOptions = {
  clientId: process.env.MQTT_CLIENT_ID || `test_client_${Date.now()}`,
  host: process.env.MQTT_HOST || 'localhost',
  port: Number(process.env.MQTT_PORT || 1883),
  username: process.env.MQTT_USERNAME || 'sin',
  password: process.env.MQTT_PASSWORD || '1234',
}

let mqttClient = null

const state = {
  connected: false,
  autoPublish: {
    running: false,
    topic: 'device/sensor',
    payload: '',
    intervalMs: 1000,
    count: 0,
    lastSentTime: null,
    lastError: null,
    timer: null,
  },
  logs: [], // 最近 30 条发送记录
}

const addLog = (type, topic, content, success = true) => {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  state.logs.unshift({
    id: Date.now() + Math.random().toString(36).slice(2, 6),
    time,
    type,
    topic,
    content: typeof content === 'string' ? content : JSON.stringify(content),
    success,
  })
  if (state.logs.length > 30) state.logs.pop()
}

const initClient = () => {
  if (mqttClient) {
    try {
      mqttClient.end(true)
    } catch {}
  }

  mqttClient = mqtt.connect(mqttOptions)

  mqttClient.on('connect', () => {
    state.connected = true
    console.log(`[MQTT] 已连接至 ${mqttOptions.host}:${mqttOptions.port} (clientId: ${mqttOptions.clientId})`)
  })

  mqttClient.on('close', () => {
    state.connected = false
  })

  mqttClient.on('error', (err) => {
    state.connected = false
    console.error('[MQTT] 连接异常:', err.message)
  })
}

const publish = (topic, payload) => {
  return new Promise((resolve, reject) => {
    if (!state.connected || !mqttClient) {
      const err = new Error('MQTT 尚未连接')
      addLog('手动发送', topic, payload, false)
      return reject(err)
    }
    const cleanTopic = String(topic || '').trim()
    if (!cleanTopic) {
      const err = new Error('主题(Topic)不能为空')
      return reject(err)
    }

    const payloadStr = typeof payload === 'object' && payload !== null
      ? JSON.stringify(payload)
      : String(payload ?? '')

    mqttClient.publish(cleanTopic, payloadStr, { qos: 0, retain: false }, (err) => {
      if (err) {
        addLog('手动发送', cleanTopic, payloadStr, false)
        return reject(err)
      }
      addLog('手动发送', cleanTopic, payloadStr, true)
      resolve({ topic: cleanTopic, payload: payloadStr })
    })
  })
}

const stopAutoPublish = () => {
  if (state.autoPublish.timer) {
    clearInterval(state.autoPublish.timer)
    state.autoPublish.timer = null
  }
  state.autoPublish.running = false
  return getStatus()
}

const startAutoPublish = ({ topic, payload, intervalMs = 1000 }) => {
  stopAutoPublish()
  const cleanTopic = String(topic || '').trim()
  if (!cleanTopic) throw new Error('自动发送失败：主题(Topic)不能为空')

  const interval = Math.max(100, Number(intervalMs) || 1000)
  const payloadStr = typeof payload === 'object' && payload !== null
    ? JSON.stringify(payload)
    : String(payload ?? '')

  state.autoPublish.running = true
  state.autoPublish.topic = cleanTopic
  state.autoPublish.payload = payloadStr
  state.autoPublish.intervalMs = interval
  state.autoPublish.count = 0
  state.autoPublish.lastError = null

  const sendTick = () => {
    if (!state.connected || !mqttClient) {
      state.autoPublish.lastError = 'MQTT 未连接'
      addLog('自动发送', cleanTopic, payloadStr, false)
      return
    }
    mqttClient.publish(cleanTopic, payloadStr, { qos: 0, retain: false }, (err) => {
      if (err) {
        state.autoPublish.lastError = err.message
        addLog('自动发送', cleanTopic, payloadStr, false)
      } else {
        state.autoPublish.count++
        state.autoPublish.lastSentTime = new Date().toLocaleTimeString()
        state.autoPublish.lastError = null
        addLog('自动发送', cleanTopic, payloadStr, true)
      }
    })
  }

  sendTick()
  state.autoPublish.timer = setInterval(sendTick, interval)
  return getStatus()
}

const reconnectMqtt = (options = {}) => {
  mqttOptions = {
    ...mqttOptions,
    ...options,
    port: Number(options.port || mqttOptions.port),
  }
  initClient()
  return { ...mqttOptions, connected: state.connected }
}

const getStatus = () => ({
  connected: state.connected,
  options: {
    host: mqttOptions.host,
    port: mqttOptions.port,
    username: mqttOptions.username,
    clientId: mqttOptions.clientId,
  },
  autoPublish: {
    running: state.autoPublish.running,
    topic: state.autoPublish.topic,
    payload: state.autoPublish.payload,
    intervalMs: state.autoPublish.intervalMs,
    count: state.autoPublish.count,
    lastSentTime: state.autoPublish.lastSentTime,
    lastError: state.autoPublish.lastError,
  },
  logs: state.logs,
})

const clearLogs = () => {
  state.logs = []
}

initClient()

module.exports = {
  publish,
  startAutoPublish,
  stopAutoPublish,
  reconnectMqtt,
  getStatus,
  clearLogs,
}