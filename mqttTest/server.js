const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })

const express = require('express')
const cors = require('cors')
const mqttClient = require('./mqtt/test')

const app = express()
const PORT = Number(process.env.PORT || 4000)

app.use(express.json())
app.use(cors())

const ok = (res, data = {}, message = 'ok') => {
  res.json({ status: 0, message, data })
}

const fail = (res, error, code = 400) => {
  res.status(code).json({
    status: 1,
    message: error instanceof Error ? error.message : String(error),
  })
}

// 获取当前状态与最近日志
app.get('/api/status', (_req, res) => {
  ok(res, mqttClient.getStatus())
})

// 单次发送数据到指定主题
app.post('/api/publish', async (req, res) => {
  try {
    const { topic, payload } = req.body || {}
    const result = await mqttClient.publish(topic, payload)
    ok(res, result, '发送成功')
  } catch (error) {
    fail(res, error)
  }
})

// 开启后台自动循环发送
app.post('/api/auto/start', (req, res) => {
  try {
    const { topic, payload, intervalMs } = req.body || {}
    const status = mqttClient.startAutoPublish({ topic, payload, intervalMs })
    ok(res, status, '已启动后台自动发送')
  } catch (error) {
    fail(res, error)
  }
})

// 停止后台自动循环发送
app.post('/api/auto/stop', (_req, res) => {
  try {
    const status = mqttClient.stopAutoPublish()
    ok(res, status, '已停止自动发送')
  } catch (error) {
    fail(res, error)
  }
})

// 修改 Broker 配置并重连
app.post('/api/mqtt/config', (req, res) => {
  try {
    const result = mqttClient.reconnectMqtt(req.body)
    ok(res, result, 'Broker 配置已更新并触发重连')
  } catch (error) {
    fail(res, error)
  }
})

// 清空日志
app.post('/api/logs/clear', (_req, res) => {
  mqttClient.clearLogs()
  ok(res, {}, '日志已清空')
})

// 托管静态前端
app.use(express.static(path.join(__dirname, 'public')))

app.listen(PORT, () => {
  console.log(`MQTT Test Server running at http://localhost:${PORT}`)
})
