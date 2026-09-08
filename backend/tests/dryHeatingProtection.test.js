const test = require("node:test")
const assert = require("node:assert/strict")

const waterControlEngine = require("../services/waterControlEngine")

const baseRows = (overrides = {}) => {
  const map = {
    master: "on",
    target_temperature: "35",
    temperature_hysteresis: "0.5",
    min_safe_flow: "0.5",
    max_safe_pressure: "150",
    max_safe_temperature: "45",
    build_flow_timeout: "5",
    low_flow_confirm_time: "2",
    cooling_delay: "10",
    data_timeout: "3",
    command_timeout: "2",
    temperature_control_strategy: "hysteresis",
    dry_heating_timeout: "5",
    dry_heating_temp_diff: "0.2",
    ...overrides,
  }
  const rows = Object.entries(map).map(([topic, value], idx) => ({ id: idx + 1, topic, value, publish_topic: "device/direct" }))
  rows.push({ id: 21, topic: "pump", t_name: "水泵开关", publish_topic: "device/direct" })
  rows.push({ id: 22, topic: "heater", t_name: "加热开关", publish_topic: "device/direct" })
  return rows
}

test("无温升干烧判定: 正常升温工况(ΔT >= dry_heating_temp_diff)基准动态刷新且不误报", async () => {
  waterControlEngine.__resetForTests()
  const dNo = "TEST_NORMAL_HEATING"
  const published = []
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      published.push({ topic, payload: typeof payload === "string" ? JSON.parse(payload) : payload })
    },
  })
  waterControlEngine.__setConfigLoaderForTests(async () => baseRows())

  // 1. 初始开加热：Tout=25.0
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    time: "2026-09-08 20:00:00",
    heat_Y1: 1,
    water_Y2: 1,
    flow_rate: 2.0,
    pressure: 50.0,
    temp_in: 24.0,
    temp_out: 25.0,
  })

  let state = waterControlEngine.getOrCreateDeviceState(dNo)
  assert.equal(state.dryHeatingBaseTemp, 25.0)
  assert.notEqual(state.faultCode, "DRY_HEATING_NO_TEMP_RISE")

  // 2. 经过 2 秒，温度微升 0.1℃（未达 0.2℃ 门槛），继续累计
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    time: "2026-09-08 20:00:02",
    heat_Y1: 1,
    water_Y2: 1,
    flow_rate: 2.0,
    pressure: 50.0,
    temp_in: 24.0,
    temp_out: 25.1,
  })
  state = waterControlEngine.getOrCreateDeviceState(dNo)
  assert.notEqual(state.faultCode, "DRY_HEATING_NO_TEMP_RISE")

  // 3. 经过 4 秒，温度升至 25.3℃（温升 0.3℃ >= 0.2℃），应触发基准刷新与累计清零
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    time: "2026-09-08 20:00:04",
    heat_Y1: 1,
    water_Y2: 1,
    flow_rate: 2.0,
    pressure: 50.0,
    temp_in: 24.0,
    temp_out: 25.3,
  })
  state = waterControlEngine.getOrCreateDeviceState(dNo)
  assert.equal(state.dryHeatingBaseTemp, 25.3, "有效温升应推进基准温度")
  assert.equal(state.dryHeatingAccumulatedMs, 0, "有效温升应重置累计计时")
  assert.notEqual(state.faultCode, "DRY_HEATING_NO_TEMP_RISE")
})

test("无温升干烧判定: 加热开启但在 dry_heating_timeout 时间内处于缓冲期，不误报", async () => {
  waterControlEngine.__resetForTests()
  const dNo = "TEST_DRY_HEATING_DEBOUNCE"
  const published = []
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      published.push({ topic, payload: typeof payload === "string" ? JSON.parse(payload) : payload })
    },
  })
  waterControlEngine.__setConfigLoaderForTests(async () => baseRows({ dry_heating_timeout: "5" }))

  // t=0: 开加热，Tout=25.0
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    time: "2026-09-08 20:00:00",
    heat_Y1: 1,
    water_Y2: 1,
    flow_rate: 2.0,
    pressure: 50.0,
    temp_in: 24.0,
    temp_out: 25.0,
  })

  // t=3s: 温度无变化 (仍为 25.0)，但未满 5s
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    time: "2026-09-08 20:00:03",
    heat_Y1: 1,
    water_Y2: 1,
    flow_rate: 2.0,
    pressure: 50.0,
    temp_in: 24.0,
    temp_out: 25.0,
  })

  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  assert.notEqual(state.faultCode, "DRY_HEATING_NO_TEMP_RISE", "超时前不应触发干烧故障")
  assert.notEqual(state.fsmState, "FAULT")
})

test("无温升干烧判定: 持续超过 dry_heating_timeout 无有效温升，确诊干烧，切断加热并留泵散热", async () => {
  waterControlEngine.__resetForTests()
  const dNo = "TEST_DRY_HEATING_TRIGGER"
  const published = []
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      published.push({ topic, payload: typeof payload === "string" ? JSON.parse(payload) : payload })
    },
  })
  // 配置超时为 2 秒，方便快速测试
  waterControlEngine.__setConfigLoaderForTests(async () => baseRows({ dry_heating_timeout: "2" }))

  // t=0: 开加热，Tout=25.0
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    time: "2026-09-08 20:00:00",
    heat_Y1: 1,
    water_Y2: 1,
    flow_rate: 2.0,
    pressure: 50.0,
    temp_in: 24.0,
    temp_out: 25.0,
  })

  // 模拟等待 2.1 秒后上报，水温完全没有变化（25.0）
  await new Promise((resolve) => setTimeout(resolve, 2100))
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    time: "2026-09-08 20:00:03",
    heat_Y1: 1,
    water_Y2: 1,
    flow_rate: 2.0,
    pressure: 50.0,
    temp_in: 24.0,
    temp_out: 25.0,
  })

  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  assert.equal(state.fsmState, "FAULT", "状态机应切入 FAULT 态")
  assert.equal(state.faultCode, "DRY_HEATING_NO_TEMP_RISE", "故障码应为 DRY_HEATING_NO_TEMP_RISE")
  assert.match(state.faultReason, /加热无温升干烧保护/)

  // 必须下发关加热
  const heaterOffAction = published.find((p) => p.payload?.topic === "heater" && p.payload?.value === "off")
  assert.ok(heaterOffAction, "干烧保护必须下发关闭加热指令")

  // 水泵在安全水流和压力下应保持运转（散热保护）
  const pumpOffAction = published.find((p) => p.payload?.topic === "pump" && p.payload?.value === "off")
  assert.ok(!pumpOffAction, "水泵在水流压力安全时应保持运转循环散热")

  // 测试复位逻辑
  await waterControlEngine.resetFault(dNo)
  assert.equal(state.fsmState, "STOPPED")
  assert.equal(state.faultCode, null)
  assert.equal(state.dryHeatingStartTime, 0)
  assert.equal(state.dryHeatingBaseTemp, null)
  assert.equal(state.dryHeatingAccumulatedMs, 0)
})
