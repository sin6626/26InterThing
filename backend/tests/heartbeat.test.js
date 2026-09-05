const test = require("node:test")
const assert = require("node:assert/strict")

const heartbeat = require("../mqtt/mqtt_hander/heartbeat")

test("heartbeat compatibility module remains disabled", async () => {
  const calls = []
  heartbeat.setTimeSyncHandler(async (deviceId) => {
    calls.push(deviceId)
  })

  heartbeat.handleHeartbeat("202111", {
    VStatus: 0,
    c_time: "2026-06-04 16:00:00",
  })
  heartbeat.storeOfflineMessage("202111", { payload: "must-not-be-queued" })
  heartbeat.checkOfflineDevices()
  await heartbeat.handleOfflineMessages("202111")

  assert.deepEqual(calls, [])
  assert.equal(heartbeat.getDeviceStatus("202111"), undefined)
  assert.deepEqual(heartbeat.getAllDeviceStatus(), {})
})
