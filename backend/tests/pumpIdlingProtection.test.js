const test = require("node:test")
const assert = require("node:assert/strict")

const waterControlEngine = require("../services/waterControlEngine")

const baseRows = (overrides = {}) => {
  const map = {
    master: "off",
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
    ...overrides,
  }
  const rows = Object.entries(map).map(([topic, value], idx) => ({ id: idx + 1, topic, value, publish_topic: "device/direct" }))
  rows.push({ id: 21, topic: "pump", t_name: "水泵开关", publish_topic: "device/direct" })
  rows.push({ id: 22, topic: "heater", t_name: "加热开关", publish_topic: "device/direct" })
  return rows
}

test("水泵空转保护: 手动开泵处于建流期内(<=build_flow_timeout)流量为0时，享受爬升豁免，不提前停泵", async () => {
  waterControlEngine.__resetForTests()
  const dNo = "TEST_IDLING_GRACE"
  const published = []
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      published.push({ topic, payload: typeof payload === "string" ? JSON.parse(payload) : payload })
    },
  })
  waterControlEngine.__setConfigLoaderForTests(async () => baseRows({ master: "off", build_flow_timeout: "5", min_safe_flow: "0.5" }))

  let mockNow = 1000000
  waterControlEngine.__setClockForTests(() => mockNow)

  // 1. 手动开启水泵
  await waterControlEngine.executeManualAction(dNo, "pump", "on")
  published.length = 0 // 清空开泵下发记录

  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  assert.equal(state.desiredPumpState, "on")
  assert.equal(state.manualPumpTracking.flowEstablished, false)

  // 2. 模拟经过 2 秒（仍处于 5 秒建流豁免期内），设备上报流量 0
  mockNow += 2000
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    water_Y2: 1,
    heat_Y1: 0,
    flow_rate: 0,
    pressure: 10,
    temp_in: 25,
    temp_out: 25,
  })

  // 验证：仍在建流豁免期，水泵不应被关停，未发布关泵指令，系统未进入故障态
  assert.equal(state.desiredPumpState, "on")
  assert.equal(published.length, 0, "建流期内不应发布关泵指令")
  assert.equal(state.fsmState, "STOPPED")
  assert.equal(state.faultCode, null)
})

test("水泵空转保护: 手动开泵超过建流时间流量仍低于阈值，确诊空转并立即强制下发关泵指令", async () => {
  waterControlEngine.__resetForTests()
  const dNo = "TEST_IDLING_TRIGGER"
  const published = []
  const alarms = []

  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      published.push({ topic, payload: typeof payload === "string" ? JSON.parse(payload) : payload })
    },
  })
  waterControlEngine.__setBroadcastForTests((topic, data) => {
    if (topic === "alarm_realtime") alarms.push(data)
  })
  waterControlEngine.__setConfigLoaderForTests(async () => baseRows({ master: "off", build_flow_timeout: "5", min_safe_flow: "0.5" }))

  let mockNow = 1000000
  waterControlEngine.__setClockForTests(() => mockNow)

  // 1. 手动开启水泵
  await waterControlEngine.executeManualAction(dNo, "pump", "on")
  published.length = 0

  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  assert.equal(state.desiredPumpState, "on")

  // 2. 模拟时间跃迁超过 5 秒（跃迁 5.1 秒），流量依然为 0
  mockNow += 5100
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    water_Y2: 1,
    heat_Y1: 0,
    flow_rate: 0,
    pressure: 8,
    temp_in: 25,
    temp_out: 25,
  })

  // 3. 验证：立即触发关泵保护！
  const pumpOffCmd = published.find((p) => p.payload && p.payload.topic === "pump" && p.payload.value === "off")
  assert.ok(pumpOffCmd, "应下发关闭水泵指令")
  assert.equal(state.desiredPumpState, "off")

  // 验证告警广播与系统状态：手动模式不锁死为 FAULT，保持 STOPPED 允许随时恢复
  assert.ok(alarms.length > 0, "应触发 alarm_realtime 广播")
  assert.equal(alarms[0].code, 6)
  assert.ok(alarms[0].text.includes("水泵空转") || alarms[0].text.includes("建流超时"))
  assert.equal(state.fsmState, "STOPPED")
})

test("水泵空转保护: 手动开泵在建流期内成功建立流量(>=min_safe_flow)，正常运转不误停泵", async () => {
  waterControlEngine.__resetForTests()
  const dNo = "TEST_IDLING_NORMAL_FLOW"
  const published = []
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      published.push({ topic, payload: typeof payload === "string" ? JSON.parse(payload) : payload })
    },
  })
  waterControlEngine.__setConfigLoaderForTests(async () => baseRows({ master: "off", build_flow_timeout: "5", min_safe_flow: "0.5" }))

  let mockNow = 1000000
  waterControlEngine.__setClockForTests(() => mockNow)

  // 1. 手动开泵
  await waterControlEngine.executeManualAction(dNo, "pump", "on")
  published.length = 0

  const state = waterControlEngine.getOrCreateDeviceState(dNo)

  // 2. 在第 3 秒时水流爬升成功，达到 1.2 L/min
  mockNow += 3000
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    water_Y2: 1,
    heat_Y1: 0,
    flow_rate: 1.2,
    pressure: 45,
    temp_in: 25,
    temp_out: 25,
  })
  assert.equal(state.manualPumpTracking.flowEstablished, true, "流量已成功确立")

  // 3. 经过第 8 秒（总耗时 8 秒，超过 5 秒建流超时），流量保持正常
  mockNow += 5000
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    water_Y2: 1,
    heat_Y1: 0,
    flow_rate: 1.5,
    pressure: 50,
    temp_in: 25,
    temp_out: 25,
  })

  // 验证：水泵持续开启，未发布关泵指令
  assert.equal(state.desiredPumpState, "on")
  assert.equal(published.length, 0)
  assert.equal(state.fsmState, "STOPPED")
})

test("水泵空转保护: 空转强制停泵后，操作员可直接再次点击开启水泵，重新获得建流豁免", async () => {
  waterControlEngine.__resetForTests()
  const dNo = "TEST_IDLING_RESTART"
  const published = []
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      published.push({ topic, payload: typeof payload === "string" ? JSON.parse(payload) : payload })
    },
  })
  waterControlEngine.__setConfigLoaderForTests(async () => baseRows({ master: "off", build_flow_timeout: "5", min_safe_flow: "0.5" }))

  let mockNow = 1000000
  waterControlEngine.__setClockForTests(() => mockNow)

  // 1. 第一次开泵并触发空转停泵
  await waterControlEngine.executeManualAction(dNo, "pump", "on")
  mockNow += 6000
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    water_Y2: 1,
    heat_Y1: 0,
    flow_rate: 0,
    pressure: 5,
    temp_in: 25,
    temp_out: 25,
  })

  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  assert.equal(state.desiredPumpState, "off")

  // 2. 模拟操作员检查管路和水源后，再次手动点击开泵
  published.length = 0
  mockNow += 2000
  const result = await waterControlEngine.executeManualAction(dNo, "pump", "on")
  assert.equal(result.status, "published")
  assert.equal(state.desiredPumpState, "on")

  // 验证新一轮建流计时已经重新开始
  assert.ok(state.manualPumpTracking.startedAt > 0)
  assert.equal(state.manualPumpTracking.flowEstablished, false)

  // 3. 在新的建流期内（经过 2 秒）不触发关泵
  mockNow += 2000
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    water_Y2: 1,
    heat_Y1: 0,
    flow_rate: 0,
    pressure: 10,
    temp_in: 25,
    temp_out: 25,
  })
  assert.equal(state.desiredPumpState, "on")
  assert.equal(published.find((p) => p.payload?.value === "off"), undefined)
})

test("水泵空转保护: 自动运行模式下建流超时同样确诊为疑似水泵空转并停泵进入FAULT锁定", async () => {
  waterControlEngine.__resetForTests()
  const dNo = "TEST_AUTO_IDLING"
  const published = []
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      published.push({ topic, payload: typeof payload === "string" ? JSON.parse(payload) : payload })
    },
  })
  waterControlEngine.__setConfigLoaderForTests(async () => baseRows({ master: "on", build_flow_timeout: "5", min_safe_flow: "0.5" }))

  let mockNow = 1000000
  waterControlEngine.__setClockForTests(() => mockNow)

  // 先给有效传感器数据以满足启动前置条件
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    water_Y2: 0,
    heat_Y1: 0,
    flow_rate: 0,
    pressure: 20,
    temp_in: 25,
    temp_out: 25,
  })

  // 启动自动运行
  await waterControlEngine.startAuto(dNo)
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  assert.equal(state.fsmState, "BUILDING_FLOW")

  // 5 秒倒计时耗尽，流量仍为 0
  for (let i = 0; i < 5; i++) {
    mockNow += 1000
    await waterControlEngine.watchdogTick()
  }

  // 验证：进入 FAULT，原因为启动建流超时/流速未达标禁止加热，水泵强制关闭
  assert.equal(state.fsmState, "FAULT")
  assert.equal(state.faultCode, "BUILD_FLOW_TIMEOUT")
  assert.ok(state.faultReason.includes("流速未达标禁止加热") || state.faultReason.includes("启动建流超时"))
  assert.equal(state.desiredPumpState, "off")
})

test("失流干烧与水泵空转彻底解耦: 加热中失流报干烧，加热关低压低流报空转，常压低流报低流", async () => {
  waterControlEngine.__resetForTests()
  const dNo = "TEST_DECOUPLE_FLOW"
  const published = []
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      published.push({ topic, payload: typeof payload === "string" ? JSON.parse(payload) : payload })
    },
  })
  waterControlEngine.__setConfigLoaderForTests(async () => baseRows({
    master: "on",
    min_safe_flow: "0.5",
    min_operating_pressure: "20",
    low_flow_confirm_time: "2",
  }))

  let mockNow = 1000000
  waterControlEngine.__setClockForTests(() => mockNow)

  // 1. 场景一：加热开启中失流 -> 必须报【失流干烧保护】(LOW_FLOW)
  const state1 = waterControlEngine.getOrCreateDeviceState(dNo)
  state1.fsmState = "RUNNING"
  state1.pumpState = "on"
  state1.heaterState = "on"
  state1.desiredPumpState = "on"
  state1.desiredHeaterState = "on"

  // 流量过低持续 2 秒
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    water_Y2: 1,
    heat_Y1: 1,
    flow_rate: 0.2,
    pressure: 40,
    temp_in: 25,
    temp_out: 30,
  })
  state1.lowFlowStartTime = mockNow - 2100
  mockNow += 2200
  await waterControlEngine.onSensorData(dNo, {
    d_no: dNo,
    water_Y2: 1,
    heat_Y1: 1,
    flow_rate: 0.2,
    pressure: 40,
    temp_in: 25,
    temp_out: 30,
  })

  assert.equal(state1.faultCode, "LOW_FLOW", "加热中失流必须报 LOW_FLOW")
  assert.ok(state1.faultReason.includes("失流干烧保护"), "必须明确是失流干烧保护")

  // 2. 场景二：加热关闭，水泵运转，低压低流(P < 20, Q < 0.5) -> 必须报【水泵空转保护】(PUMP_IDLING)，绝不报干烧
  waterControlEngine.__resetForTests()
  const dNo2 = "TEST_PUMP_IDLING_CASE"
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      published.push({ topic, payload: typeof payload === "string" ? JSON.parse(payload) : payload })
    },
  })
  waterControlEngine.__setConfigLoaderForTests(async () => baseRows({
    master: "on",
    min_safe_flow: "0.5",
    min_operating_pressure: "20",
    low_flow_confirm_time: "2",
  }))
  mockNow = 2000000
  waterControlEngine.__setClockForTests(() => mockNow)

  const state2 = waterControlEngine.getOrCreateDeviceState(dNo2)
  state2.fsmState = "RUNNING"
  state2.pumpState = "on"
  state2.heaterState = "off"
  state2.desiredPumpState = "on"
  state2.desiredHeaterState = "off"

  // 低压低流持续 2 秒：流量 0.1 < 0.5，压力 8 < 20
  await waterControlEngine.onSensorData(dNo2, {
    d_no: dNo2,
    water_Y2: 1,
    heat_Y1: 0,
    flow_rate: 0.1,
    pressure: 8,
    temp_in: 25,
    temp_out: 25,
  })
  state2.lowFlowStartTime = mockNow - 2100
  mockNow += 2200
  await waterControlEngine.onSensorData(dNo2, {
    d_no: dNo2,
    water_Y2: 1,
    heat_Y1: 0,
    flow_rate: 0.1,
    pressure: 8,
    temp_in: 25,
    temp_out: 25,
  })

  assert.equal(state2.faultCode, "PUMP_IDLING", "加热未开启低压低流必须报 PUMP_IDLING")
  assert.ok(state2.faultReason.includes("水泵空转保护"), "必须明确是水泵空转保护")
  assert.ok(!state2.faultReason.includes("干烧"), "加热关着时绝不能出现'干烧'字眼")
})
