const test = require("node:test")
const assert = require("node:assert/strict")

const {
  buildDeviceCommandEnvelope,
  buildDeviceCommandPayload,
} = require("../mqtt/commandMapper")

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

test("buildDeviceCommandEnvelope keeps legacy shape when no template is configured", () => {
  assert.deepEqual(
    buildDeviceCommandEnvelope({
      d_no: "202111",
      config_id: 7,
      topic: "pump",
      publish_topic: "device/direct",
      value: "off",
    }),
    {
      topic: "device/direct",
      payload: {
        d_no: "202111",
        config_id: 7,
        topic: "pump",
        value: "off",
      },
    },
  )
})

test("buildDeviceCommandEnvelope supports payload template and value map", () => {
  assert.deepEqual(
    buildDeviceCommandEnvelope({
      d_no: "202111",
      config_id: 21,
      topic: "heater",
      publish_topic: "device/direct",
      payload_template: JSON.stringify({
        mb: "{{mapped_value}}",
        sn: 1,
        ack: 0,
        crc: 1,
        uart: 6,
      }),
      value_map: JSON.stringify({
        on: "010600000001",
        off: "010600000000",
      }),
      value: "on",
    }),
    {
      topic: "device/direct",
      payload: {
        mb: "010600000001",
        sn: 1,
        ack: 0,
        crc: 1,
        uart: 6,
      },
    },
  )
})
