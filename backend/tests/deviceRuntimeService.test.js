const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const service = require("../services/deviceRuntimeService")

const TEST_FILE_PATH = path.join(__dirname, "test_runtime_data.json")

test.beforeEach(() => {
  service.__resetForTests()
  service.__setConfigLoaderForTests(async () => [{ topic: "data_timeout", value: "3" }])
  service.__setHistoryLoggerForTests(async () => {})
  service.__setDataFilePathForTests(TEST_FILE_PATH)
  if (fs.existsSync(TEST_FILE_PATH)) {
    fs.unlinkSync(TEST_FILE_PATH)
  }
})

test.afterEach(() => {
  service.__resetForTests()
  if (fs.existsSync(TEST_FILE_PATH)) {
    fs.unlinkSync(TEST_FILE_PATH)
  }
})

test("formatSeconds: 格式化时间显示", () => {
  assert.equal(service.formatSeconds(0), "0秒")
  assert.equal(service.formatSeconds(45), "45秒")
  assert.equal(service.formatSeconds(125), "2分5秒")
  assert.equal(service.formatSeconds(3600), "1小时")
  assert.equal(service.formatSeconds(3665), "1小时1分5秒")
})

test("onSensorRuntimeData: 正常连续采样下，水泵开/加热关时只累加水泵时长", async () => {
  const dNo = "TEST_DEV_01"
  service.__setConfigLoaderForTests(async () => [{ topic: "data_timeout", value: "3" }])

  const t0 = 100000
  // 第 1 包：初始化时间戳，不累加
  await service.onSensorRuntimeData(dNo, { water_Y2: 1, heat_Y1: 0 }, t0)
  let status = service.getRuntimeStatus(dNo)
  assert.equal(status.pump_runtime_seconds, 0)
  assert.equal(status.heater_runtime_seconds, 0)

  // 第 2 包：经过 1 秒 (1000ms)，water_Y2=1, heat_Y1=0
  await service.onSensorRuntimeData(dNo, { water_Y2: 1, heat_Y1: 0 }, t0 + 1000)
  status = service.getRuntimeStatus(dNo)
  assert.equal(status.pump_runtime_seconds, 1.0)
  assert.equal(status.heater_runtime_seconds, 0.0)
  assert.equal(status.pump_state, 1)
  assert.equal(status.heater_state, 0)

  // 第 3 包：再过 1.5 秒，水泵关 (water_Y2=0)，加热开 (heat_Y1=1)
  await service.onSensorRuntimeData(dNo, { water_Y2: 0, heat_Y1: 1 }, t0 + 2500)
  status = service.getRuntimeStatus(dNo)
  // 此 1.5 秒内，上报表明水泵已关，加热已开
  assert.equal(status.pump_runtime_seconds, 1.0)
  assert.equal(status.heater_runtime_seconds, 1.5)
})

test("onSensorRuntimeData: 未带 water_Y2 或 heat_Y1 严格按未开启处理", async () => {
  const dNo = "TEST_DEV_02"
  const t0 = 100000
  await service.onSensorRuntimeData(dNo, {}, t0)
  await service.onSensorRuntimeData(dNo, { temp_out: 25 }, t0 + 1000)

  const status = service.getRuntimeStatus(dNo)
  assert.equal(status.pump_runtime_seconds, 0)
  assert.equal(status.heater_runtime_seconds, 0)
  assert.equal(status.pump_state, 0)
  assert.equal(status.heater_state, 0)
})

test("onSensorRuntimeData: 超过 data_timeout 时触发断网保护，不虚增时间", async () => {
  const dNo = "TEST_DEV_03"
  service.__setConfigLoaderForTests(async () => [{ topic: "data_timeout", value: "3" }])

  const t0 = 100000
  await service.onSensorRuntimeData(dNo, { water_Y2: 1, heat_Y1: 1 }, t0)
  // 正常采样 1 秒后
  await service.onSensorRuntimeData(dNo, { water_Y2: 1, heat_Y1: 1 }, t0 + 1000)
  assert.equal(service.getRuntimeStatus(dNo).pump_runtime_seconds, 1.0)

  // 模拟断线 60 秒后重连 (大于 3 秒)
  await service.onSensorRuntimeData(dNo, { water_Y2: 1, heat_Y1: 1 }, t0 + 1000 + 60000)
  // 断线的 60 秒绝不应算入运行时长，仍然保持 1.0 秒
  assert.equal(service.getRuntimeStatus(dNo).pump_runtime_seconds, 1.0)
  assert.equal(service.getRuntimeStatus(dNo).heater_runtime_seconds, 1.0)
})

test("resetRuntime: 分别清零和全部清零，并成功记录操作历史", async () => {
  const dNo = "TEST_DEV_04"
  const historyLogs = []
  service.__setHistoryLoggerForTests(async (log) => {
    historyLogs.push(log)
  })

  const t0 = 100000
  await service.onSensorRuntimeData(dNo, { water_Y2: 1, heat_Y1: 1 }, t0)
  await service.onSensorRuntimeData(dNo, { water_Y2: 1, heat_Y1: 1 }, t0 + 2000)

  let status = service.getRuntimeStatus(dNo)
  assert.equal(status.pump_runtime_seconds, 2.0)
  assert.equal(status.heater_runtime_seconds, 2.0)

  // 1. 仅清零水泵
  await service.resetRuntime(dNo, "pump")
  status = service.getRuntimeStatus(dNo)
  assert.equal(status.pump_runtime_seconds, 0)
  assert.equal(status.heater_runtime_seconds, 2.0)
  assert.equal(historyLogs.length, 1)
  assert.match(historyLogs[0].direct_name, /水泵/)

  // 2. 清零全部
  await service.resetRuntime(dNo, "all")
  status = service.getRuntimeStatus(dNo)
  assert.equal(status.pump_runtime_seconds, 0)
  assert.equal(status.heater_runtime_seconds, 0)
  assert.equal(historyLogs.length, 2)
})

test("loadAllFromLocalFile & persistAllToLocalFile: 本地文件持久化与加载恢复", async () => {
  const dNo = "TEST_DEV_05"
  const t0 = 100000
  await service.onSensorRuntimeData(dNo, { water_Y2: 1, heat_Y1: 1 }, t0)
  await service.onSensorRuntimeData(dNo, { water_Y2: 1, heat_Y1: 1 }, t0 + 2000)

  // 强制持久化到测试文件
  service.persistAllToLocalFile(true)
  assert.ok(fs.existsSync(TEST_FILE_PATH))

  // 清空内存状态模拟重启
  service.__resetForTests()
  service.__setDataFilePathForTests(TEST_FILE_PATH)
  assert.equal(service.getRuntimeStatus(dNo).pump_runtime_seconds, 0)

  // 从本地文件恢复
  service.loadAllFromLocalFile()
  const recovered = service.getRuntimeStatus(dNo)
  assert.equal(recovered.pump_runtime_seconds, 2.0)
  assert.equal(recovered.heater_runtime_seconds, 2.0)
})
