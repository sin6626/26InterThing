const path = require('path')
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const mqttTest = require('./mqtt/test')

require('dotenv').config()

const app = express()
const PORT = Number(process.env.PORT || 4000)

app.use(express.json())
app.use(cors())
app.use(helmet({ contentSecurityPolicy: false }))

const ok = (res, data = {}, message = 'ok') => {
  res.json({ status: 0, message, data })
}

const fail = (res, error, code = 400) => {
  res.status(code).json({
    status: 1,
    message: error instanceof Error ? error.message : String(error),
  })
}

// ===== 状态 =====

app.get('/api/status', (_req, res) => {
  ok(res, {
    mqttConnected: mqttTest.state.connected,
    autoHeartbeat: {
      enabled: mqttTest.state.autoHeartbeat.enabled,
      deviceId: mqttTest.state.autoHeartbeat.deviceId,
      vstatus: mqttTest.state.autoHeartbeat.vstatus,
      intervalMs: mqttTest.state.autoHeartbeat.intervalMs,
    },
  })
})

// ===== 心跳 =====

app.post('/api/heartbeat/send', async (req, res) => {
  try {
    const result = await mqttTest.sendHeartbeat({
      deviceId: req.body?.deviceId,
      payload: req.body?.payload,
    })
    ok(res, result, '心跳已发送')
  } catch (error) {
    fail(res, error)
  }
})

app.post('/api/heartbeat/auto/start', (req, res) => {
  try {
    mqttTest.startAutoHeartbeat({
      deviceId: req.body?.deviceId,
      vstatus: req.body?.vstatus,
      intervalMs: req.body?.intervalMs,
    })
    ok(res, mqttTest.state.autoHeartbeat, '自动心跳已启动')
  } catch (error) {
    fail(res, error)
  }
})

app.post('/api/heartbeat/auto/stop', (_req, res) => {
  mqttTest.stopAutoHeartbeat()
  ok(res, mqttTest.state.autoHeartbeat, '自动心跳已停止')
})

app.post('/api/heartbeat/auto/vstatus', (req, res) => {
  mqttTest.setAutoHeartbeatVstatus(req.body?.vstatus)
  ok(res, mqttTest.state.autoHeartbeat, '自动心跳 VStatus 已更新')
})

app.post('/api/heartbeat/auto/interval', (req, res) => {
  mqttTest.setAutoHeartbeatInterval(req.body?.intervalMs)
  ok(res, mqttTest.state.autoHeartbeat, '自动心跳间隔已更新')
})

// ===== 传感器、行为、错误 =====

app.post('/api/sensor/send', async (req, res) => {
  try {
    const result = await mqttTest.sendSensor({
      deviceId: req.body?.deviceId,
      payload: req.body?.payload,
    })
    ok(res, result, '传感器数据已发送')
  } catch (error) {
    fail(res, error)
  }
})

app.post('/api/behavior/send', async (req, res) => {
  try {
    const result = await mqttTest.sendBehavior({
      deviceId: req.body?.deviceId,
      payload: req.body?.payload,
    })
    ok(res, result, '行为数据已发送')
  } catch (error) {
    fail(res, error)
  }
})

app.post('/api/error/send', async (req, res) => {
  try {
    const result = await mqttTest.sendError({
      deviceId: req.body?.deviceId,
      payload: req.body?.payload,
    })
    ok(res, result, '错误数据已发送')
  } catch (error) {
    fail(res, error)
  }
})

// ===== 时间同步请求 =====

app.post('/api/time-request/send', async (req, res) => {
  try {
    const result = await mqttTest.sendTimeRequest({
      deviceId: req.body?.deviceId,
      payload: req.body?.payload,
    })
    ok(res, result, '时间同步请求已发送')
  } catch (error) {
    fail(res, error)
  }
})

// ===== 指令上报（设备端 -> 后端） =====

app.post('/api/direct/report', async (req, res) => {
  try {
    const result = await mqttTest.sendDirectReport({
      deviceId: req.body?.deviceId,
      payload: req.body?.payload,
    })
    ok(res, result, '指令上报已发送')
  } catch (error) {
    fail(res, error)
  }
})

// ===== 接收到的消息查询 =====

app.get('/api/received/direct', (_req, res) => {
  ok(res, { data: mqttTest.state.lastReceivedDirect }, 'ok')
})

app.get('/api/received/update-time', (_req, res) => {
  ok(res, { data: mqttTest.state.lastReceivedUpdateTime }, 'ok')
})

// ===== 故障场景 =====

app.post('/api/scenario/fault', async (req, res) => {
  try {
    const result = await mqttTest.runFaultScenario({
      deviceId: req.body?.deviceId,
      code: req.body?.code,
      durationMs: req.body?.durationMs,
      e_no: req.body?.e_no,
      e_msg: req.body?.e_msg,
    })
    ok(res, result, '故障场景已执行')
  } catch (error) {
    fail(res, error)
  }
})

app.get('/api/preset/fault-codes', (_req, res) => {
  ok(res, {
    0: '正常',
    1: '一般告警',
    2: '通信异常',
    3: '传感器故障',
    4: '空调故障',
    5: '风机故障',
    6: '断电超时',
    7: '危险气体/湿度超标',
  })
})

// ===== 静态页面 =====

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.use('/public', express.static(path.join(__dirname, 'public')))

app.listen(PORT, () => {
  console.log(`MQTT Test UI running at http://localhost:${PORT}`)
})