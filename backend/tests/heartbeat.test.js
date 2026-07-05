const test = require("node:test")
const assert = require("node:assert/strict")

const heartbeat = require("../mqtt/mqtt_hander/heartbeat")

test("handleHeartbeat triggers time sync on first online heartbeat", async () => {
  const calls = []
  heartbeat.__setNowProviderForTests(() => new Date("2026-06-13T14:05:06"))
  heartbeat.setTimeSyncHandler(async (deviceId) => {
    calls.push(deviceId)
  })

  heartbeat.handleHeartbeat("202111", {
    VStatus: 0,
    c_time: "2026-06-04 16:00:00",
  })

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls, ["202111"])
  assert.equal(heartbeat.getDeviceStatus("202111")?.updated_at, "2026-06-13 14:05:06")
  heartbeat.__resetForTests()
})

test("handleHeartbeat triggers time sync when device recovers from offline", async () => {
  const calls = []
  heartbeat.__setNowProviderForTests(() => new Date("2026-06-13T14:05:06"))
  heartbeat.setTimeSyncHandler(async (deviceId) => {
    calls.push(deviceId)
  })

  heartbeat.handleHeartbeat("202111", {
    VStatus: 0,
    c_time: "2026-06-04 16:00:00",
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  const status = heartbeat.getDeviceStatus("202111")
  status.status = "offline"

  heartbeat.__setNowProviderForTests(() => new Date("2026-06-13T14:06:07"))

  heartbeat.handleHeartbeat("202111", {
    VStatus: 0,
    c_time: "2026-06-04 16:01:00",
  })

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls, ["202111", "202111"])
  assert.equal(heartbeat.getDeviceStatus("202111")?.updated_at, "2026-06-13 14:06:07")
  heartbeat.__resetForTests()
})

test("handleHeartbeat does not trigger time sync for normal online heartbeats", async () => {
  const calls = []
  heartbeat.__setNowProviderForTests(() => new Date("2026-06-13T14:05:06"))
  heartbeat.setTimeSyncHandler(async (deviceId) => {
    calls.push(deviceId)
  })

  heartbeat.handleHeartbeat("202111", {
    VStatus: 0,
    c_time: "2026-06-04 16:00:00",
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  heartbeat.handleHeartbeat("202111", {
    VStatus: 0,
    c_time: "2026-06-04 16:00:03",
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(calls, ["202111"])
  assert.equal(heartbeat.getDeviceStatus("202111")?.updated_at, "2026-06-13 14:05:06")
  heartbeat.__resetForTests()
})
