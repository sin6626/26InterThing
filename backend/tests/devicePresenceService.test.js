process.env.NODE_ENV = "test"
const test = require("node:test")
const assert = require("node:assert/strict")

const devicePresence = require("../services/devicePresenceService")

test.beforeEach(() => {
  devicePresence.__resetForTests()
  devicePresence.__setConfigLoaderForTests(async () => [])
})

test.after(() => {
  devicePresence.__resetForTests()
})

test("devicePresenceService: 初始设备判定为离线", async () => {
  devicePresence.__resetForTests()
  const status = await devicePresence.getDevicePresence("TEST_DEV_01")
  assert.equal(status.status, "offline")
  assert.equal(status.text, "离线")
})

test("devicePresenceService: 收到数据后切换为在线并触发广播", async () => {
  devicePresence.__resetForTests()
  let broadcastMsg = null
  devicePresence.__setBroadcastForTests((topic, payload) => {
    broadcastMsg = { topic, payload }
  })

  await devicePresence.recordDeviceActivity("TEST_DEV_01")
  const status = await devicePresence.getDevicePresence("TEST_DEV_01")
  assert.equal(status.status, "online")
  assert.equal(status.text, "在线")

  assert.ok(broadcastMsg)
  assert.equal(broadcastMsg.topic, "device_status")
  assert.equal(broadcastMsg.payload.d_no, "TEST_DEV_01")
  assert.equal(broadcastMsg.payload.status, "online")
  assert.equal(broadcastMsg.payload.text, "在线")
})

test("devicePresenceService: 超过超时时间后巡检切为离线并触发广播", async () => {
  devicePresence.__resetForTests()
  let currentTime = 10000
  devicePresence.__setNowProviderForTests(() => currentTime)

  let broadcastEvents = []
  devicePresence.__setBroadcastForTests((topic, payload) => {
    broadcastEvents.push({ topic, payload })
  })

  // 模拟自定义超时为 3 秒
  devicePresence.__setConfigLoaderForTests(async (dNo) => [
    { topic: "device_offline_timeout", value: "3" },
  ])

  await devicePresence.recordDeviceActivity("TEST_DEV_01")
  assert.equal((await devicePresence.getDevicePresence("TEST_DEV_01")).status, "online")
  assert.equal(broadcastEvents.length, 1)

  // 推进 2 秒（未超时）
  currentTime += 2000
  await devicePresence.checkOfflineDevices()
  assert.equal((await devicePresence.getDevicePresence("TEST_DEV_01")).status, "online")
  assert.equal(broadcastEvents.length, 1)

  // 推进到 4 秒（超过 3 秒阈值）
  currentTime += 2000
  await devicePresence.checkOfflineDevices()
  assert.equal((await devicePresence.getDevicePresence("TEST_DEV_01")).status, "offline")
  assert.equal(broadcastEvents.length, 2)
  assert.equal(broadcastEvents[1].payload.status, "offline")
  assert.equal(broadcastEvents[1].payload.text, "离线")

  // 再次收到数据恢复在线
  currentTime += 500
  await devicePresence.recordDeviceActivity("TEST_DEV_01")
  assert.equal((await devicePresence.getDevicePresence("TEST_DEV_01")).status, "online")
  assert.equal(broadcastEvents.length, 3)
  assert.equal(broadcastEvents[2].payload.status, "online")

  devicePresence.__resetForTests()
})
