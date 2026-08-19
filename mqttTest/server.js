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

// ===== 状态查询 =====

app.get('/api/status', (_req, res) => {
  ok(res, {
    mqttConnected: mqttTest.state.connected,
    mqttOptions: mqttTest.state.mqttOptions,
    deviceId: mqttTest.state.deviceId,
    physics: mqttTest.state.physics,
    autoSensor: {
      enabled: mqttTest.state.autoSensor.enabled,
      intervalMs: mqttTest.state.autoSensor.intervalMs,
      jitter: mqttTest.state.autoSensor.jitter,
    },
    autoHeartbeat: {
      enabled: mqttTest.state.autoHeartbeat.enabled,
      vstatus: mqttTest.state.autoHeartbeat.vstatus,
      intervalMs: mqttTest.state.autoHeartbeat.intervalMs,
    },
    receivedDirectCount: mqttTest.state.receivedDirectList.length,
    lastReceivedUpdateTime: mqttTest.state.lastReceivedUpdateTime,
  })
})

// ===== Broker 配置与重连 =====

app.post('/api/mqtt/reconnect', (req, res) => {
  try {
    const updated = mqttTest.reconnectMqtt(req.body)
    ok(res, updated, '已触发 MQTT 重连')
  } catch (error) {
    fail(res, error)
  }
})

// ===== 设备编号切换 =====

app.post('/api/device/set', (req, res) => {
  const dNo = String(req.body?.deviceId || '').trim()
  if (!dNo) return fail(res, '设备编号不能为空')
  mqttTest.state.deviceId = dNo
  ok(res, { deviceId: dNo }, '设备编号已更新')
})

// ===== 物理仿真状态 =====

app.post('/api/physics/update', (req, res) => {
  try {
    const next = mqttTest.updatePhysics(req.body)
    ok(res, next, '物理状态已更新')
  } catch (error) {
    fail(res, error)
  }
})

// ===== 自动传感器连续上报 =====

app.post('/api/sensor/auto/start', (req, res) => {
  try {
    mqttTest.startAutoSensor({
      intervalMs: req.body?.intervalMs,
      jitter: req.body?.jitter,
    })
    ok(res, mqttTest.state.autoSensor, '自动连续上报已开启')
  } catch (error) {
    fail(res, error)
  }
})

app.post('/api/sensor/auto/stop', (_req, res) => {
  mqttTest.stopAutoSensor()
  ok(res, mqttTest.state.autoSensor, '自动连续上报已停止')
})

// ===== 自动心跳 =====

app.post('/api/heartbeat/auto/start', (req, res) => {
  try {
    mqttTest.startAutoHeartbeat({
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

// ===== 单次发送：心跳 / 传感器 / 行为 / 错误 / 校时 / 指令上报 =====

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

app.post('/api/sensor/send', async (req, res) => {
  try {
    const result = await mqttTest.sendSensor({
      deviceId: req.body?.deviceId,
      payload: req.body?.payload,
      custom: req.body?.custom,
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

// ===== 一键场景测试宏 =====

app.post('/api/scenario/run', async (req, res) => {
  try {
    const result = await mqttTest.runScenario(req.body?.type, req.body?.options)
    ok(res, result, result.message || '场景已执行')
  } catch (error) {
    fail(res, error)
  }
})

// ===== 接收到的下发消息查询 =====

app.get('/api/received/direct', (_req, res) => {
  ok(res, { list: mqttTest.state.receivedDirectList }, 'ok')
})

app.get('/api/received/update-time', (_req, res) => {
  ok(res, { data: mqttTest.state.lastReceivedUpdateTime }, 'ok')
})

app.post('/api/received/clear', (_req, res) => {
  mqttTest.state.receivedDirectList = []
  mqttTest.state.lastReceivedUpdateTime = null
  ok(res, {}, '已清空接收历史')
})

// ===== 静态页面 =====

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.use('/public', express.static(path.join(__dirname, 'public')))

app.listen(PORT, () => {
  console.log(`MQTT Test UI running at http://localhost:${PORT}`)
})