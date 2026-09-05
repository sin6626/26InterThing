const test = require("node:test")
const assert = require("node:assert/strict")

const { createTopicDispatcher } = require("../mqtt/topicDispatcher")

test("createTopicDispatcher ignores heartbeat messages when heartbeat is disabled", async () => {
  const sideEffects = []
  const dispatch = createTopicDispatcher({
    broadcastToClients: (...args) => sideEffects.push(["broadcast", ...args]),
    directHandler: { updateDirect: (...args) => sideEffects.push(["direct", ...args]) },
    saveHandler: {
      saveSensorData: (...args) => sideEffects.push(["sensor", ...args]),
      savebehaviorData: (...args) => sideEffects.push(["behavior", ...args]),
      saveErrorData: (...args) => sideEffects.push(["error", ...args]),
    },
    timeSyncHandler: {
      handleTimeRequest: (...args) => sideEffects.push(["time", ...args]),
    },
  })

  await dispatch("device/heartbeat", Buffer.from('{"d_no":"202111","VStatus":0}'))

  assert.deepEqual(sideEffects, [])
})

test("createTopicDispatcher routes timeRequest messages using payload d_no", async () => {
  const calls = []
  const dispatch = createTopicDispatcher({
    broadcastToClients: () => {},
    directHandler: { updateDirect: () => {} },
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
    saveHandler: {
      saveSensorData: (topic, payload, callback) => {
        callback(null)
      },
      savebehaviorData: () => {},
      saveErrorData: () => {},
    },
    timeSyncHandler: null,
    waterControlHandler: { onSensorData: () => {} },
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

test("createTopicDispatcher ignores malformed JSON payloads without throwing", async () => {
  const broadcasts = []
  const saveCalls = []
  const directCalls = []
  const errors = []
  const originalConsoleError = console.error
  console.error = (...args) => {
    errors.push(args)
  }

  try {
    const dispatch = createTopicDispatcher({
      broadcastToClients: (type, data) => {
        broadcasts.push({ type, data })
      },
      directHandler: {
        updateDirect: (...args) => {
          directCalls.push(args)
        },
      },
      saveHandler: {
        saveSensorData: (...args) => {
          saveCalls.push(args)
        },
        savebehaviorData: () => {},
        saveErrorData: () => {},
      },
      timeSyncHandler: null,
    })

    await dispatch("device/sensor", Buffer.from('{"d_no":e46488d793284429,"imei":,"iccid":,"time":2026-08-16 20:13:10}'))

    assert.deepEqual(broadcasts, [])
    assert.deepEqual(saveCalls, [])
    assert.deepEqual(directCalls, [])
    assert.equal(errors.length, 1)
    assert.match(String(errors[0][0]), /MQTT消息解析失败/)
  } finally {
    console.error = originalConsoleError
  }
})

test("createTopicDispatcher ignores application outbound echoes on device/direct", async () => {
  const directCalls = []
  const broadcasts = []
  const dispatch = createTopicDispatcher({
    broadcastToClients: (...args) => broadcasts.push(args),
    directHandler: { updateDirect: (...args) => directCalls.push(args) },
    saveHandler: {
      saveSensorData: () => {},
      savebehaviorData: () => {},
      saveErrorData: () => {},
    },
    timeSyncHandler: null,
    outboundEchoTracker: {
      consumeIfTracked: (topic, payloadText) => (
        topic === "device/direct" && payloadText === '{"d_no":"202111","config_id":21,"topic":"pump","value":"on"}'
      ),
    },
  })

  await dispatch(
    "device/direct",
    Buffer.from('{"d_no":"202111","config_id":21,"topic":"pump","value":"on"}'),
  )

  assert.deepEqual(directCalls, [])
  assert.deepEqual(broadcasts, [])
})
