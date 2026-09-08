const test = require("node:test")
const assert = require("node:assert/strict")

const thermalAnalysisService = require("../services/thermalAnalysisService")

test.beforeEach(() => {
  thermalAnalysisService.__resetForTests()
  thermalAnalysisService.__setConfigLoaderForTests(async () => [])
  thermalAnalysisService.__setBroadcastForTests(() => {})
})

test("thermalAnalysis: 两水箱温差与供热温差计算准确性", async () => {
  const dNo = "TEST_THERMAL_DIFF"
  const now = 1_700_000_000_000

  // 1. 水箱A 35℃，水箱B 31℃
  const res1 = await thermalAnalysisService.onSensorThermalData(
    dNo,
    { temp_in: 35.0, temp_out: 31.0, flow_rate: 2.0, water_Y2: 1 },
    now,
  )
  assert.equal(res1.temp_in, 35.0)
  assert.equal(res1.temp_out, 31.0)
  // 两水箱温差绝对值：|31.0 - 35.0| = 4.0；供热温差 Tout - Tin = -4.0
  assert.equal(res1.temperature_difference, 4.0)
  assert.equal(res1.heat_transfer_difference, -4.0)

  // 2. 水箱A 30℃，水箱B 32.5℃
  const res2 = await thermalAnalysisService.onSensorThermalData(
    dNo,
    { temp_in: 30.0, temp_out: 32.5, flow_rate: 1.0, water_Y2: 0 },
    now + 1000,
  )
  // 两水箱温差绝对值：|32.5 - 30.0| = 2.5
  assert.equal(res2.temperature_difference, 2.5)
  assert.equal(res2.heat_transfer_difference, 2.5)
})

test("thermalAnalysis: 滑动窗口升温速度(℃/min)平滑计算", async () => {
  const dNo = "TEST_HEATING_RATE"
  let now = 1_700_000_000_000

  thermalAnalysisService.__setConfigLoaderForTests(async () => [
    { topic: "temperature_rate_window", value: "60" },
  ])

  // t=0: 水箱A 20.0℃, 水箱B 20.0℃
  await thermalAnalysisService.onSensorThermalData(
    dNo,
    { temp_in: 20.0, temp_out: 20.0, flow_rate: 1.0, water_Y2: 1 },
    now,
  )

  // t=2s (时间差 < 5s，不放大噪声): 升温速率为 0.0
  const resNoise = await thermalAnalysisService.onSensorThermalData(
    dNo,
    { temp_in: 20.1, temp_out: 20.0, flow_rate: 1.0, water_Y2: 1 },
    now + 2000,
  )
  assert.equal(resNoise.heating_rate, 0.0)

  // 模拟经过 60 秒，水箱A升温至 23.0℃ (升温 3.0℃/min)
  now += 60000
  const res60s = await thermalAnalysisService.onSensorThermalData(
    dNo,
    { temp_in: 23.0, temp_out: 21.0, flow_rate: 1.0, water_Y2: 1 },
    now,
  )
  assert.equal(res60s.heating_rate, 3.0) // 3.0 ℃/min
  assert.equal(res60s.heating_rate_out, 1.0) // 1.0 ℃/min
})

test("thermalAnalysis: 估算热传递功率(69.77 * Q * ΔT)计算与正常工况", async () => {
  const dNo = "TEST_POWER_CALC"
  const now = 1_700_000_000_000

  thermalAnalysisService.__setConfigLoaderForTests(async () => [
    { topic: "min_safe_flow", value: "0.5" },
  ])

  // 水泵开启(water_Y2=1)，流量 2.0 L/min，水箱A 35℃，水箱B 32℃ (ΔT = 3.0℃)
  // P = 69.77 * 2.0 * 3.0 = 418.62 W
  const res = await thermalAnalysisService.onSensorThermalData(
    dNo,
    { temp_in: 35.0, temp_out: 32.0, flow_rate: 2.0, water_Y2: 1 },
    now,
  )
  assert.equal(res.power_status, "ok")
  assert.equal(res.power_status_text, "正常热传递")
  assert.equal(res.estimated_thermal_power, 418.62)
})

test("thermalAnalysis: 停水与停泵安全前置保护(不虚报热功率)", async () => {
  const dNo = "TEST_POWER_SAFETY"
  const now = 1_700_000_000_000

  // 1. 水泵关闭 (water_Y2 = 0)
  const resPumpOff = await thermalAnalysisService.onSensorThermalData(
    dNo,
    { temp_in: 40.0, temp_out: 30.0, flow_rate: 2.0, water_Y2: 0 },
    now,
  )
  assert.equal(resPumpOff.power_status, "pump_off")
  assert.equal(resPumpOff.estimated_thermal_power, 0.0)

  // 2. 水泵开启但流量低于安全阈值 0.5 L/min (flow_rate = 0.3)
  const resLowFlow = await thermalAnalysisService.onSensorThermalData(
    dNo,
    { temp_in: 40.0, temp_out: 30.0, flow_rate: 0.3, water_Y2: 1 },
    now + 1000,
  )
  assert.equal(resLowFlow.power_status, "low_flow")
  assert.equal(resLowFlow.estimated_thermal_power, 0.0)

  // 3. 两水箱无温差 (temp_in 30℃, temp_out 30℃)
  const resNoDiff = await thermalAnalysisService.onSensorThermalData(
    dNo,
    { temp_in: 30.0, temp_out: 30.0, flow_rate: 2.0, water_Y2: 1 },
    now + 2000,
  )
  assert.equal(resNoDiff.power_status, "no_diff")
  assert.equal(resNoDiff.estimated_thermal_power, 0.0)

  // 4. 出水高于入水 (例如出水 30℃, 入水 28℃)，正常计算有效热传递功率
  const resDiff2 = await thermalAnalysisService.onSensorThermalData(
    dNo,
    { temp_in: 28.0, temp_out: 30.0, flow_rate: 2.0, water_Y2: 1 },
    now + 3000,
  )
  assert.equal(resDiff2.power_status, "ok")
  assert.equal(resDiff2.estimated_thermal_power, 279.08) // 69.77 * 2.0 * 2.0 = 279.08
})

test("thermalAnalysis: WebSocket 广播与状态快照查询", async () => {
  const dNo = "TEST_BROADCAST"
  const now = 1_700_000_000_000
  let broadcasted = null

  thermalAnalysisService.__setBroadcastForTests((topic, payload) => {
    broadcasted = { topic, payload }
  })

  await thermalAnalysisService.onSensorThermalData(
    dNo,
    { temp_in: 32.0, temp_out: 30.0, flow_rate: 1.5, water_Y2: 1 },
    now,
  )

  assert.ok(broadcasted)
  assert.equal(broadcasted.topic, "thermal_realtime")
  assert.equal(broadcasted.payload.d_no, dNo)
  assert.equal(broadcasted.payload.estimated_thermal_power, 209.31) // 69.77 * 1.5 * 2.0 = 209.31

  // 测试 getThermalStatus 快照查询
  const snapshot = await thermalAnalysisService.getThermalStatus(dNo)
  assert.equal(snapshot.d_no, dNo)
  assert.equal(snapshot.estimated_thermal_power, 209.31)
})
