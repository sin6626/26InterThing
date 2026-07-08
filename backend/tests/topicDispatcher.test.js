const test = require("node:test")
const assert = require("node:assert/strict")

const { createTopicDispatcher } = require("../mqtt/topicDispatcher")

test("createTopicDispatcher routes timeRequest messages using payload d_no", async () => {
  const calls = []
  const dispatch = createTopicDispatcher({
    broadcastToClients: () => {},
    directHandler: { updateDirect: () => {} },
    heartbeatHandler: { handleHeartbeat: () => {} },
    saveHandler: {
      saveSensorData: () => {},
      savebehaviorData: () => {},
      saveErrorData: () => {},
    },
    timeSyncHandler: {
      handleTimeRequest: async (deviceId, data) => {
        calls.push({ deviceId, data })
      },
    },
  })

  await dispatch("device/timeRequest", Buffer.from('{"d_no":"202111","reason":"power_on"}'))

  assert.deepEqual(calls, [
    {
      deviceId: "202111",
      data: { d_no: "202111", reason: "power_on" },
    },
  ])
})

test("createTopicDispatcher keeps sensor d_no from payload on shared topic", async () => {
  const broadcasts = []
  const dispatch = createTopicDispatcher({
    broadcastToClients: (type, data) => {
      broadcasts.push({ type, data })
    },
    directHandler: { updateDirect: () => {} },
    heartbeatHandler: { handleHeartbeat: () => {} },
    saveHandler: {
      saveSensorData: (topic, payload, callback) => {
        callback(null)
      },
      savebehaviorData: () => {},
      saveErrorData: () => {},
    },
    timeSyncHandler: null,
  })

  await dispatch("device/sensor", Buffer.from('{"d_no":"202111","temp":26.5}'))

  assert.deepEqual(broadcasts, [
    {
      type: "sensor_realtime",
      data: {
        d_no: "202111",
        temp: 26.5,
      },
    },
  ])
})
