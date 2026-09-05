const test = require("node:test")
const assert = require("node:assert/strict")

const { registerSubscriptions } = require("../mqtt/subscriptions")

test("registerSubscriptions listens on shared device topics", () => {
  const topics = []
  const mqttClient = {
    subscribe: (topic, callback) => {
      topics.push(topic)
      callback(null)
    },
  }

  registerSubscriptions(mqttClient, null)

  assert.deepEqual(topics, [
    "device/sensor",
    "device/behavior",
    "device/error",
    "device/timeRequest",
    "device/direct",
  ])
})
