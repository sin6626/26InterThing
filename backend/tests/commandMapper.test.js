const test = require("node:test")
const assert = require("node:assert/strict")

const { buildDeviceCommandPayload } = require("../mqtt/commandMapper")

test("buildDeviceCommandPayload sends current water command shape", () => {
  assert.deepEqual(
    buildDeviceCommandPayload({
      d_no: "202111",
      config_id: 11,
      topic: "flowLow",
      value: 10,
    }),
    {
      d_no: "202111",
      config_id: 11,
      topic: "flowLow",
      value: "10",
    },
  )
  assert.deepEqual(
    buildDeviceCommandPayload({
      d_no: "202111",
      config_id: 13,
      topic: "pressuerLow",
      value: 12,
    }),
    {
      d_no: "202111",
      config_id: 13,
      topic: "pressuerLow",
      value: "12",
    },
  )
})

test("buildDeviceCommandPayload keeps device metadata in payload", () => {
  assert.deepEqual(
    buildDeviceCommandPayload({
      d_no: "202111",
      config_id: 7,
      topic: "pump",
      value: "off",
    }),
    {
      d_no: "202111",
      config_id: 7,
      topic: "pump",
      value: "off",
    },
  )
})
