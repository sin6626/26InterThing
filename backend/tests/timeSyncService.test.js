const test = require("node:test")
const assert = require("node:assert/strict")

const { createTimeSyncService } = require("../services/timeSyncService")

test("handleTimeRequest publishes current time for the requesting device", async () => {
  const calls = []
  const service = createTimeSyncService({
    mqttClient: {
      updateDeviceTime: async (deviceId, payload) => {
        calls.push({ deviceId, payload })
      },
    },
    nowProvider: () => ({ nowTime: "09:30:00", nowdate: "26.06.04" }),
  })

  const payload = await service.handleTimeRequest("202111", { reason: "power_on" })

  assert.deepEqual(payload, { nowTime: "09:30:00", nowdate: "26.06.04" })
  assert.deepEqual(calls, [
    {
      deviceId: "202111",
      payload: { nowTime: "09:30:00", nowdate: "26.06.04" },
    },
  ])
})

test("updateTime keeps manual global time sync behavior", async () => {
  const calls = []
  const service = createTimeSyncService({
    mqttClient: {
      updateTime: async (payload) => {
        calls.push(payload)
      },
    },
    nowProvider: () => ({ nowTime: "10:00:00", nowdate: "26.06.04" }),
  })

  const payload = await service.updateTime()

  assert.deepEqual(payload, { nowTime: "10:00:00", nowdate: "26.06.04" })
  assert.deepEqual(calls, [{ nowTime: "10:00:00", nowdate: "26.06.04" }])
})

test("updateTime converts a provided full datetime into separate time and date fields", async () => {
  const calls = []
  const service = createTimeSyncService({
    mqttClient: {
      updateTime: async (payload) => {
        calls.push(payload)
      },
    },
    nowProvider: () => ({ nowTime: "10:00:00", nowdate: "26.06.04" }),
  })

  const payload = await service.updateTime("2026-06-05 08:00:00")

  assert.deepEqual(payload, { nowTime: "08:00:00", nowdate: "26.06.05" })
  assert.deepEqual(calls, [{ nowTime: "08:00:00", nowdate: "26.06.05" }])
})

test("updateTime converts an already split collection-layer payload shape", async () => {
  const calls = []
  const service = createTimeSyncService({
    mqttClient: {
      updateTime: async (payload) => {
        calls.push(payload)
      },
    },
  })

  const payload = await service.updateTime({
    nowTime: "14:30:00",
    nowdate: "26.06.10",
  })

  assert.deepEqual(payload, { nowTime: "14:30:00", nowdate: "26.06.10" })
  assert.deepEqual(calls, [{ nowTime: "14:30:00", nowdate: "26.06.10" }])
})

test("updateTime can derive the date when only a time string is provided", async () => {
  const calls = []
  const service = createTimeSyncService({
    mqttClient: {
      updateTime: async (payload) => {
        calls.push(payload)
      },
    },
    nowProvider: () => ({ nowTime: "10:00:00", nowdate: "26.06.04" }),
  })

  const payload = await service.updateTime("14:30:00")

  assert.deepEqual(payload, { nowTime: "14:30:00", nowdate: "26.06.04" })
  assert.deepEqual(calls, [{ nowTime: "14:30:00", nowdate: "26.06.04" }])
})
