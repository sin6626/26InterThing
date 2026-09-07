const test = require("node:test")
const assert = require("node:assert/strict")

const waterFlowService = require("../services/waterFlowService")

test("waterFlowService: 梯形微元积分计算累计流量精度测试", async () => {
  waterFlowService.__resetForTests()
  const dNo = "TEST_FLOW_ACCUMULATOR"
  const now = 1_700_000_000_000

  // 模拟数据库 query
  const dbData = new Map()
  waterFlowService.__setQueryForTests(async (sql, params) => {
    if (sql.includes("t_water_flow_accumulator")) {
      dbData.set(params[0], params[1])
    }
    return []
  })
  waterFlowService.__setBroadcastForTests(() => {})
  waterFlowService.__setConfigLoaderForTests(async () => [])

  // 第 1 条数据：t=0s, 流量 60 L/min
  const res1 = await waterFlowService.onSensorFlowData(dNo, { flow_rate: 60 }, now, 3)
  assert.equal(res1.total_volume, 0)

  // 第 2 条数据：t=1s (dt=1s), 流量 60 L/min
  // delta_volume = ((60 + 60) / 2) * (1 / 60) = 1.0 L
  const res2 = await waterFlowService.onSensorFlowData(dNo, { flow_rate: 60 }, now + 1000, 3)
  assert.equal(res2.total_volume, 1.0)

  // 连续再过 9 秒（每秒 60 L/min），总计 10 秒过水量应为 10.0 L
  for (let i = 2; i <= 10; i++) {
    await waterFlowService.onSensorFlowData(dNo, { flow_rate: 60 }, now + i * 1000, 3)
  }
  const status = await waterFlowService.getFlowStatus(dNo)
  assert.equal(status.total_volume, 10.0)
})

test("waterFlowService: 断线超过data_timeout时不把断线时间乘入累计量", async () => {
  waterFlowService.__resetForTests()
  const dNo = "TEST_FLOW_DISCONNECT"
  let now = 1_700_000_000_000

  waterFlowService.__setQueryForTests(async () => [])
  waterFlowService.__setBroadcastForTests(() => {})
  waterFlowService.__setConfigLoaderForTests(async () => [])

  // 正常运行 2 秒：流量 30 L/min
  await waterFlowService.onSensorFlowData(dNo, { flow_rate: 30 }, now, 3)
  // dt=2s, delta = 30 * (2/60) = 1.0 L
  const res = await waterFlowService.onSensorFlowData(dNo, { flow_rate: 30 }, now + 2000, 3)
  assert.equal(res.total_volume, 1.0)

  // 发生数据中断 10 秒（远大于 dataTimeoutSeconds = 3s）
  now += 12000
  // 恢复发包，第一包不应把断线 10 秒累计进去
  const resRecover = await waterFlowService.onSensorFlowData(dNo, { flow_rate: 30 }, now, 3)
  assert.equal(resRecover.total_volume, 1.0)

  // 恢复后正常过 1 秒 (dt=1s)，累加 30 * (1/60) = 0.5 L，总量变为 1.5 L
  const resNext = await waterFlowService.onSensorFlowData(dNo, { flow_rate: 30 }, now + 1000, 3)
  assert.equal(resNext.total_volume, 1.5)
})

test("waterFlowService: 水管内径流速换算与未配置保护", async () => {
  waterFlowService.__resetForTests()
  const dNo = "TEST_VELOCITY"

  // 1. 未配置内径时：流速为 null, velocityStatus 为 'unconfigured'
  waterFlowService.__setConfigLoaderForTests(async () => [])
  waterFlowService.__setQueryForTests(async () => [])

  const res1 = await waterFlowService.onSensorFlowData(dNo, { flow_rate: 15 }, 1_000, 3)
  assert.equal(res1.flow_velocity, null)
  assert.equal(res1.velocity_status, "unconfigured")

  // 2. 配置内径 15mm 时：
  // 截面积 A = π * (0.015)^2 / 4 ≈ 0.00017671458 m^2
  // Q = 60 L/min = 0.001 m^3/s
  // 流速 v = 0.001 / 0.00017671458 ≈ 5.659 m/s
  waterFlowService.__setConfigLoaderForTests(async () => [
    { topic: "pipe_inner_diameter", value: "15" },
  ])
  const res2 = await waterFlowService.onSensorFlowData(dNo, { flow_rate: 60 }, 2_000, 3)
  assert.equal(res2.velocity_status, "ok")
  assert.equal(res2.flow_velocity, 5.659)
})

test("waterFlowService: 清零接口成功置0并记录操作历史", async () => {
  waterFlowService.__resetForTests()
  const dNo = "TEST_FLOW_RESET"
  let historyInserted = null

  waterFlowService.__setQueryForTests(async () => [])
  waterFlowService.__setBroadcastForTests(() => {})
  waterFlowService.__setConfigLoaderForTests(async () => [])
  waterFlowService.__setHistoryLoggerForTests(async (record) => {
    historyInserted = record
  })

  // 累计一些流量
  await waterFlowService.onSensorFlowData(dNo, { flow_rate: 60 }, 1000, 3)
  await waterFlowService.onSensorFlowData(dNo, { flow_rate: 60 }, 2000, 3)
  const beforeReset = await waterFlowService.getFlowStatus(dNo)
  assert.equal(beforeReset.total_volume, 1.0)

  // 执行清零
  const resetRes = await waterFlowService.resetTotalVolume(dNo, "测试清零")
  assert.equal(resetRes.total_volume, 0.0)

  const afterReset = await waterFlowService.getFlowStatus(dNo)
  assert.equal(afterReset.total_volume, 0.0)

  // 验证留痕包含原累计量与清零类型
  assert.ok(historyInserted)
  assert.equal(historyInserted.direct_type, "reset_total_volume")
  assert.equal(historyInserted.d_no, dNo)
  assert.equal(historyInserted.old_value, "1")
  assert.equal(historyInserted.new_value, "0")
})
