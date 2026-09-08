const test = require("node:test")
const assert = require("node:assert/strict")

const { attachPublishHelpers } = require("../mqtt/publishService")
const { EventEmitter } = require('node:events')

test('执行器单次QoS1发布，取消时移除未确认消息及监听器', async () => {
  const client = new EventEmitter()
  client.connected = true
  let removed, count = 0
  client.publish = (topic, payload) => { count++; client.emit('packetsend', { cmd: 'publish', topic, payload, messageId: 7 }) }
  client.removeOutgoingMessage = id => { removed = id }
  attachPublishHelpers(client)
  const controller = new AbortController()
  const pending = client.publishToDevice('device/direct', { topic: 'heater', value: 'on' }, { single: true, signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, /取消/)
  assert.equal(count, 1)
  assert.equal(removed, 7)
  assert.equal(client.listenerCount('packetsend'), 0)
  assert.equal(client.listenerCount('close'), 0)
})

test('执行器发布遇到断线直接失败，迟到确认不能转成成功', async () => {
  const client = new EventEmitter()
  client.connected = true
  let ack, removed
  client.publish = (topic, payload, options, callback) => {
    assert.deepEqual(options, { qos: 1, retain: false })
    ack = callback
    client.emit('packetsend', { cmd: 'publish', topic, payload, messageId: 8 })
  }
  client.removeOutgoingMessage = id => { removed = id }
  attachPublishHelpers(client)
  const pending = client.publishToDevice('device/direct', {}, { single: true })
  client.emit('close')
  ack()
  await assert.rejects(pending, /中断/)
  assert.equal(removed, 8)
})

test("updateTime publishes the global time sync topic twice with qos 1", async () => {
  const calls = []
  const mqttClient = {
    connected: true,
    publish: (topic, payloadText, options, callback) => {
      calls.push({ topic, payloadText, options })
      callback(null)
    },
  }

  attachPublishHelpers(mqttClient)

  await mqttClient.updateTime({ nowTime: "14:20:00", nowdate: "26.06.13" })

  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], {
    topic: "device/updateTime",
    payloadText: '{"nowTime":"14:20:00","nowdate":"26.06.13"}',
    options: { qos: 1, retain: false },
  })
  assert.deepEqual(calls[1], calls[0])
})

test("updateDeviceTime publishes shared time sync topic with payload d_no", async () => {
  const calls = []
  const mqttClient = {
    connected: true,
    publish: (topic, payloadText, options, callback) => {
      calls.push({ topic, payloadText, options })
      callback(null)
    },
  }

  attachPublishHelpers(mqttClient)

  await mqttClient.updateDeviceTime("202111", {
    nowTime: "14:20:00",
    nowdate: "26.06.13",
  })

  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], {
    topic: "device/updateTime",
    payloadText: '{"nowTime":"14:20:00","nowdate":"26.06.13","d_no":"202111"}',
    options: { qos: 1, retain: false },
  })
  assert.deepEqual(calls[1], calls[0])
})

test("attachPublishHelpers does not expose offline message replay", () => {
  const mqttClient = {
    connected: true,
    publish: () => {},
  }

  attachPublishHelpers(mqttClient)

  assert.equal(mqttClient.publishOfflineMessages, undefined)
})

test("publishToDevice fails immediately when Broker is disconnected and never queues", async () => {
  const mqttClient = {
    connected: false,
    publish: () => assert.fail("断开连接时不应调用底层publish"),
  }

  attachPublishHelpers(mqttClient)

  await assert.rejects(
    mqttClient.publishToDevice("device/direct", { mb: "010600010000" }),
    /后端的MQTT客户端未连接/,
  )
  assert.equal(mqttClient.publishOfflineMessages, undefined)
})
