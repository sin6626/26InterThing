const test = require("node:test")
const assert = require("node:assert/strict")

const { createTopicDispatcher } = require("../mqtt/topicDispatcher")

test("createTopicDispatcher routes timeRequest messages to the time sync handler", async () => {
  const calls = []
  const dispatch = createTopicDispatcher({
    broadcastToClients: () => {},
    directHandler: { updateDirect: () => {} },
    heartbeatHandler: { handleHeartbeat: () => {} },
    pidHandler: null,
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

  await dispatch("device/202111/timeRequest", Buffer.from('{"reason":"power_on"}'))

  assert.deepEqual(calls, [
    {
      deviceId: "202111",
      data: { reason: "power_on" },
    },
  ])
})

test("createTopicDispatcher publishes pid messages as behavior realtime payloads", async () => {
  const broadcasts = []
  const dispatch = createTopicDispatcher({
    broadcastToClients: (type, data) => {
      broadcasts.push({ type, data })
    },
    directHandler: { updateDirect: () => {} },
    heartbeatHandler: { handleHeartbeat: () => {} },
    pidHandler: {
      savePidData: (topic, payload, callback) => {
        callback(null, {
          d_no: "202111",
          pidList: ["BOX1001", "BOX1002"],
          pidText: "BOX1001,BOX1002",
          c_time: "2026-06-04 12:00:00",
          online: "实时数据",
        })
      },
    },
    saveHandler: {
      saveSensorData: () => {},
      savebehaviorData: () => {},
      saveErrorData: () => {},
    },
    timeSyncHandler: null,
  })

  await dispatch("device/202111/pid", Buffer.from('{"PID":["BOX1001","BOX1002"]}'))

  assert.deepEqual(broadcasts, [
    {
      type: "behavior_realtime",
      data: {
        d_no: "202111",
        pid: "BOX1001,BOX1002",
        PID: ["BOX1001", "BOX1002"],
        c_time: "2026-06-04 12:00:00",
        online: "实时数据",
      },
    },
  ])
})
