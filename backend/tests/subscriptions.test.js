const test = require("node:test")
const assert = require("node:assert/strict")

const { registerSubscriptions } = require("../mqtt/subscriptions")

test("registerSubscriptions listens for device direct reports", () => {
  const topics = []
  const mqttClient = {
    subscribe: (topic, callback) => {
      topics.push(topic)
      callback(null)
    },
  }

  registerSubscriptions(mqttClient, null)

  assert.ok(topics.includes("device/+/direct"))
})
