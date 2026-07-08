const test = require("node:test")
const assert = require("node:assert/strict")

const { buildDeviceCommandPayload } = require("../mqtt/commandMapper")

test("buildDeviceCommandPayload stringifies threshold and power values", () => {
  assert.deepEqual(
    buildDeviceCommandPayload({ topic: "airPower", value: 40 }),
    { kong: "40" },
  )
  assert.deepEqual(
    buildDeviceCommandPayload({ topic: "fanPower", value: 75 }),
    { fan: "75" },
  )
  assert.deepEqual(
    buildDeviceCommandPayload({ topic: "light", value: 80 }),
    { light_thresh: "80" },
  )
  assert.deepEqual(
    buildDeviceCommandPayload({ topic: "temperatureLower", value: 20 }),
    { temp_low: "20" },
  )
  assert.deepEqual(
    buildDeviceCommandPayload({ topic: "directUpper", value: 30 }),
    { temp_high: "30" },
  )
})

test("buildDeviceCommandPayload maps light-window controls to begin and end time payloads", () => {
  assert.deepEqual(
    buildDeviceCommandPayload({ topic: "TBegin", value: "20:59:00" }),
    { begintime: "20:59:00" },
  )
  assert.deepEqual(
    buildDeviceCommandPayload({ topic: "TEnd", value: "20:30:00" }),
    { endtime: "20:30:00" },
  )
})

test("buildDeviceCommandPayload keeps switch and mode semantics unchanged", () => {
  assert.deepEqual(
    buildDeviceCommandPayload({ topic: "master", value: "on" }),
    { value: "on" },
  )
  assert.deepEqual(
    buildDeviceCommandPayload({ topic: "airMode", value: "制冷" }),
    { "air mode": "cold" },
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
