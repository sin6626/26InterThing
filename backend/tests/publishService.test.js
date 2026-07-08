const test = require("node:test")
const assert = require("node:assert/strict")

const { attachPublishHelpers } = require("../mqtt/publishService")

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

test("publishOfflineMessages publishes shared direct topic", async () => {
  const calls = []
  const mqttClient = {
    connected: true,
    publish: (topic, payloadText, options, callback) => {
      calls.push({ topic, payloadText, options })
      callback(null)
    },
  }

  attachPublishHelpers(mqttClient)

  await mqttClient.publishOfflineMessages("202111", [
    {
      commandPayload: {
        d_no: "202111",
        topic: "pump",
        value: "off",
      },
    },
  ])

  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], {
    topic: "device/direct",
    payloadText: '{"d_no":"202111","topic":"pump","value":"off"}',
    options: { qos: 1, retain: false },
  })
  assert.deepEqual(calls[1], calls[0])
})
