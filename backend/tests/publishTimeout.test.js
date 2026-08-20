const test = require("node:test")
const assert = require("node:assert/strict")
const {
  resolveCommandTimeoutSeconds,
  waitForPublish,
} = require("../mqtt/publishTimeout")

test("resolveCommandTimeoutSeconds reads the positive command timeout in seconds", () => {
  assert.equal(resolveCommandTimeoutSeconds([{ topic: "command_timeout", value: "3.5" }]), 3.5)
  assert.equal(resolveCommandTimeoutSeconds([{ topic: "command_timeout", value: "0" }]), 2)
})

test("waitForPublish rejects a publish that does not settle before the configured timeout", async () => {
  await assert.rejects(
    () => waitForPublish(new Promise(() => {}), 0.01),
    /MQTT发布超时\(0.01s\)/,
  )
})
