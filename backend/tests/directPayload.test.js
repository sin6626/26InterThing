const test = require("node:test")
const assert = require("node:assert/strict")

const { normalizeReportedDirectValue } = require("../mqtt/mqtt_hander/directPayload")

test("normalizeReportedDirectValue keeps direct switch values", () => {
  assert.equal(normalizeReportedDirectValue("on"), "on")
  assert.equal(normalizeReportedDirectValue("off"), "off")
})

test("normalizeReportedDirectValue reads value from device key value payloads", () => {
  assert.equal(normalizeReportedDirectValue("pump off"), "off")
  assert.equal(normalizeReportedDirectValue("temperatureUpper 30"), "30")
})
