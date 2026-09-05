const test = require("node:test")
const assert = require("node:assert/strict")

const dbPath = require.resolve("../db")
const deviceHandlerPath = require.resolve("../router_handler/device")
const originalDbModule = require.cache[dbPath]
const fakeDb = {
  query: (_sql, callback) => callback(null, [{ number: "202111" }]),
}

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: fakeDb,
}
delete require.cache[deviceHandlerPath]
const deviceHandler = require(deviceHandlerPath)

test.after(() => {
  delete require.cache[deviceHandlerPath]
  if (originalDbModule) require.cache[dbPath] = originalDbModule
  else delete require.cache[dbPath]
})

test("deviceStatus reports registered devices without heartbeat monitoring", async () => {
  const payload = await new Promise((resolve) => {
    deviceHandler.deviceStatus({}, { send: resolve, cc: assert.fail })
  })

  assert.equal(payload.status, 0)
  assert.equal(payload.data["202111"].status, "unmonitored")
  assert.equal(payload.data["202111"].text, "未启用心跳")
})
