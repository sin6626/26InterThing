const test = require("node:test")
const assert = require("node:assert/strict")

const waterControlEngine = require("../services/waterControlEngine")
const thermalAnalysisService = require("../services/thermalAnalysisService")

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
    temp_reversed_confirm_time: "5",
    ...overrides,
  }
  const rows = Object.entries(map).map(([topic, value], idx) => ({ id: idx + 1, topic, value, publish_topic: "device/direct" }))
  rows.push({ id: 21, topic: "pump", t_name: "水泵开关", publish_topic: "device/direct" })
  rows.push({ id: 22, topic: "heater", t_name: "加热开关", publish_topic: "device/direct" })
  return rows
}

test("温度传感器装反判定: 正常升温工况(Tin <= Tout)不误报", async () => {
  waterControlEngine.__resetForTests()
  const dNo = "TEST_NORMAL_TEMP"
  const published = []
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      published.push({ topic, payload: typeof payload === "string" ? JSON.parse(payload) : payload })
    },
  })
  waterControlEngine.__setConfigLoaderForTests(async () => baseRows())

  // 正常数据：Tin=25.0, Tout=28.0 (Tout >= Tin)
  const payload = {
    d_no: dNo,
    time: "2026-09-08 20:00:00",
    heat_Y1: 1,
    water_Y2: 1,
    flow_rate: 2.0,
    pressure: 50.0,
    temp_in: 25.0,
    temp_out: 28.0,
  }

  await waterControlEngine.onSensorData(dNo, payload)
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  assert.equal(state.tempReversedStartTime, 0)
  assert.notEqual(state.faultCode, "TEMP_SENSOR_REVERSED")
  assert.notEqual(state.fsmState, "FAULT")
})

test("温度传感器装反判定: Tin > Tout但未达确认时间处于消抖期，不误报", async () => {
  waterControlEngine.__resetForTests()
  const dNo = "TEST_REVERSED_DEBOUNCE"
  const published = []
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      published.push({ topic, payload: typeof payload === "string" ? JSON.parse(payload) : payload })
    },
  })
  waterControlEngine.__setConfigLoaderForTests(async () => baseRows({ temp_reversed_confirm_time: "5" }))

  // 第 1 秒：加热开，水流正常，但 Tin=30 > Tout=25 (反了)
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    time: "2026-09-08 20:00:01",
    heat_Y1: 1,
    water_Y2: 1,
    flow_rate: 2.0,
    pressure: 50.0,
    temp_in: 30.0,
    temp_out: 25.0,
  })

  let state = waterControlEngine.getOrCreateDeviceState(dNo)
  assert.ok(state.tempReversedStartTime > 0, "应开始记录装反计时")
  assert.notEqual(state.faultCode, "TEMP_SENSOR_REVERSED")

  // 过 2 秒（总共 2 秒，未满 5 秒）
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    time: "2026-09-08 20:00:03",
    heat_Y1: 1,
    water_Y2: 1,
    flow_rate: 2.0,
    pressure: 50.0,
    temp_in: 30.2,
    temp_out: 25.1,
  })

  state = waterControlEngine.getOrCreateDeviceState(dNo)
  assert.notEqual(state.faultCode, "TEMP_SENSOR_REVERSED", "消抖期间不应触发故障")
})

test("温度传感器装反判定: 持续超过temp_reversed_confirm_time确诊，切断加热并留泵散热", async () => {
  waterControlEngine.__resetForTests()
  const dNo = "TEST_REVERSED_TRIGGER"
  const published = []
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      published.push({ topic, payload: typeof payload === "string" ? JSON.parse(payload) : payload })
    },
  })
  // 设置较短的确认时间 2 秒方便测试
  waterControlEngine.__setConfigLoaderForTests(async () => baseRows({ temp_reversed_confirm_time: "2" }))

  // t=0s
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    time: "2026-09-08 20:00:00",
    heat_Y1: 1,
    water_Y2: 1,
    flow_rate: 2.0,
    pressure: 50.0,
    temp_in: 32.0,
    temp_out: 26.0,
  })

  // 等待 2.2 秒，发送第二包数据，满足 >= 2s 确认时间
  await new Promise((resolve) => setTimeout(resolve, 2200))

  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    time: "2026-09-08 20:00:02",
    heat_Y1: 1,
    water_Y2: 1,
    flow_rate: 2.0,
    pressure: 50.0,
    temp_in: 32.5,
    temp_out: 26.2,
  })

  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  assert.equal(state.faultCode, "TEMP_SENSOR_REVERSED")
  assert.equal(state.fsmState, "FAULT")
  assert.ok(state.faultReason.includes("进出口温度传感器疑似装反"))

  // 验证动作：关闭加热（下发了 heater off 指令）
  const heaterOffCmd = published.find((p) => p.payload.topic === "heater" && p.payload.value === "off")
  assert.ok(heaterOffCmd, "确诊装反后应自动发布关闭加热指令")

  // 验证留泵散热：因流量与压力正常，未发布停泵
  const pumpOffCmd = published.find((p) => p.payload.topic === "pump" && p.payload.value === "off")
  assert.equal(pumpOffCmd, undefined, "水流压力正常时应留泵散热，不强行关泵")
})

test("thermalAnalysisService: 加热开启且Tin > Tout时powerStatus标注为reversed", async () => {
  thermalAnalysisService.__resetForTests()
  const dNo = "TEST_THERMAL_REVERSED"
  thermalAnalysisService.__setBroadcastForTests(() => {})
  thermalAnalysisService.__setConfigLoaderForTests(async () => [
    { topic: "min_safe_flow", value: "0.5" },
    { topic: "temperature_rate_window", value: "60" },
  ])

  const res = await thermalAnalysisService.onSensorThermalData(dNo, {
    temp_in: 35.0,
    temp_out: 28.0,
    flow_rate: 2.0,
    heat_Y1: 1,
    water_Y2: 1,
  })

  assert.equal(res.power_status, "reversed")
  assert.equal(res.power_status_text, "温度传感器疑似装反")
  assert.equal(res.estimated_thermal_power, 0.0)
  assert.equal(res.heat_transfer_difference, -7.0)
})
