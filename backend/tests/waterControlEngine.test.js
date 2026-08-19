const test = require("node:test")
const assert = require("node:assert/strict")
const waterControlEngine = require("../services/waterControlEngine")
const { FSM_STATES } = waterControlEngine

const DEFAULT_MOCK_CONFIGS = [
  { id: 0, topic: "master", value: "on" },
  { id: 10, topic: "target_temperature", value: "35.0" },
  { id: 11, topic: "temperature_hysteresis", value: "0.5" },
  { id: 12, topic: "min_safe_flow", value: "0.5" },
  { id: 13, topic: "max_safe_pressure", value: "150.0" },
  { id: 15, topic: "max_safe_temperature", value: "45.0" },
  { id: 16, topic: "build_flow_timeout", value: "5" },
  { id: 17, topic: "low_flow_confirm_time", value: "2" },
  { id: 18, topic: "cooling_delay", value: "10" },
  { id: 19, topic: "data_timeout", value: "5" },
  { id: 21, topic: "pump", t_name: "水泵开关", publish_topic: "device/direct" },
  { id: 22, topic: "heater", t_name: "加热开关", publish_topic: "device/direct" },
]

test.beforeEach(() => {
  waterControlEngine.__resetForTests()
  waterControlEngine.__setConfigLoaderForTests(async () => DEFAULT_MOCK_CONFIGS)
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async () => {},
  })
  waterControlEngine.__setBroadcastForTests(() => {})
})

test.afterEach(() => {
  waterControlEngine.__resetForTests()
})

test("正常升温与回差控制：低于下限自动开启加热，达到目标自动关闭，区间内保持", async () => {
  const actions = []
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (topic, payload) => {
      actions.push({ topic, payload })
    },
  })

  const dNo = "TEST_001"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.mode = "auto"
  state.fsmState = FSM_STATES.RUNNING
  state.pumpState = "on"
  state.heaterState = "off"

  // 1. 水温 34.0 ℃ <= (35.0 - 0.5 = 34.5 ℃)，流量正常 -> 应自动开启加热
  await waterControlEngine.onSensorData(dNo, {
    temp_out: 34.0,
    temp_in: 30.0,
    flow_rate: 1.2,
    pressure: 50.0,
    c_time: "2026-08-18 20:00:00",
  })
  assert.equal(state.heaterState, "on")

  // 2. 水温升至 34.8 ℃（处于 34.5 ~ 35.0 回差区间） -> 加热应保持开启
  await waterControlEngine.onSensorData(dNo, {
    temp_out: 34.8,
    temp_in: 31.0,
    flow_rate: 1.2,
    pressure: 50.0,
  })
  assert.equal(state.heaterState, "on")

  // 3. 水温达到 35.2 ℃ >= 35.0 ℃ -> 应自动关闭加热
  await waterControlEngine.onSensorData(dNo, {
    temp_out: 35.2,
    temp_in: 32.0,
    flow_rate: 1.2,
    pressure: 50.0,
  })
  assert.equal(state.heaterState, "off")

  // 4. 水温小幅回落至 34.8 ℃ -> 加热应保持关闭，避免频繁开关
  await waterControlEngine.onSensorData(dNo, {
    temp_out: 34.8,
    temp_in: 31.5,
    flow_rate: 1.2,
    pressure: 50.0,
  })
  assert.equal(state.heaterState, "off")
})

test("启动未建流保护：超过建流超时时间未达到安全流量，自动停泵并进入故障状态", async () => {
  const dNo = "TEST_002"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.lastSensorTime = Date.now()
  state.lastSensors = { temp_in: 25, temp_out: 25, flow_rate: 0, pressure: 0 }

  await waterControlEngine.startAuto(dNo)
  assert.equal(state.fsmState, FSM_STATES.BUILDING_FLOW)
  assert.equal(state.pumpState, "on")
  assert.equal(state.heaterState, "off")

  // 模拟经过 5 秒看门狗巡检（流量一直为 0）
  for (let i = 0; i < 5; i++) {
    state.lastSensorTime = Date.now() // 保活传感器
    await waterControlEngine.watchdogTick()
  }

  assert.equal(state.fsmState, FSM_STATES.FAULT)
  assert.equal(state.pumpState, "off")
  assert.match(state.faultReason, /启动未建流/)
})

test("运行中失流保护：正常加热中流量过低持续2秒，立即切断加热并报警", async () => {
  const dNo = "TEST_003"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.mode = "auto"
  state.fsmState = FSM_STATES.RUNNING
  state.pumpState = "on"
  state.heaterState = "on"

  // 第一次低流量数据
  await waterControlEngine.onSensorData(dNo, {
    temp_out: 32.0,
    temp_in: 30.0,
    flow_rate: 0.1, // 低于 0.5 L/min
    pressure: 30.0,
  })
  // 刚检测到低流量，还未到 2s 确认时间，暂不切断
  assert.equal(state.fsmState, FSM_STATES.RUNNING)

  // 模拟 2 秒后持续低流
  state.lowFlowStartTime = Date.now() - 2500
  await waterControlEngine.onSensorData(dNo, {
    temp_out: 32.0,
    temp_in: 30.0,
    flow_rate: 0.1,
    pressure: 30.0,
  })

  assert.equal(state.fsmState, FSM_STATES.FAULT)
  assert.equal(state.heaterState, "off")
  assert.match(state.faultReason, /运行中流量过低/)
})

test("超温保护：水温超过安全上限，立即切断加热，水泵保持运行散热", async () => {
  const dNo = "TEST_004"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.mode = "auto"
  state.fsmState = FSM_STATES.RUNNING
  state.pumpState = "on"
  state.heaterState = "on"

  await waterControlEngine.onSensorData(dNo, {
    temp_out: 46.5, // >= 45.0 ℃
    temp_in: 38.0,
    flow_rate: 1.5,
    pressure: 60.0,
  })

  assert.equal(state.fsmState, FSM_STATES.FAULT)
  assert.equal(state.heaterState, "off")
  assert.equal(state.pumpState, "on") // 水泵保持运行以带走余热
  assert.match(state.faultReason, /水温超限/)
})

test("超压保护：管路压力超过安全上限，立即切断加热并停水泵", async () => {
  const dNo = "TEST_005"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.mode = "auto"
  state.fsmState = FSM_STATES.RUNNING
  state.pumpState = "on"
  state.heaterState = "on"

  await waterControlEngine.onSensorData(dNo, {
    temp_out: 32.0,
    temp_in: 30.0,
    flow_rate: 1.5,
    pressure: 160.0, // >= 150.0 kPa
  })

  assert.equal(state.fsmState, FSM_STATES.FAULT)
  assert.equal(state.heaterState, "off")
  assert.equal(state.pumpState, "off")
  assert.match(state.faultReason, /管路超压/)
})

test("正常停止与冷却延时：先关加热，水泵延时运行10秒后关闭", async () => {
  const dNo = "TEST_006"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.mode = "auto"
  state.fsmState = FSM_STATES.RUNNING
  state.pumpState = "on"
  state.heaterState = "on"

  await waterControlEngine.stopAuto(dNo)
  assert.equal(state.fsmState, FSM_STATES.COOLING)
  assert.equal(state.heaterState, "off")
  assert.equal(state.pumpState, "on")
  assert.equal(state.countdown, 10)

  // 经过 10 秒倒计时
  for (let i = 0; i < 10; i++) {
    await waterControlEngine.watchdogTick()
  }

  assert.equal(state.fsmState, FSM_STATES.STOPPED)
  assert.equal(state.pumpState, "off")
})

test("手动控制安全审查：流量不足或水泵未开时拒绝加热，条件满足时允许", async () => {
  const dNo = "TEST_007"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)

  // 1. 水泵未开
  state.lastSensorTime = Date.now()
  state.lastSensors = { temp_in: 25, temp_out: 25, flow_rate: 1.0, pressure: 50 }
  state.pumpState = "off"
  let check = await waterControlEngine.checkHeaterSafety(dNo)
  assert.equal(check.safe, false)
  assert.match(check.reason, /水泵未开启/)

  // 2. 水泵开启但流量不足
  state.pumpState = "on"
  state.lastSensors.flow_rate = 0.2 // < 0.5
  check = await waterControlEngine.checkHeaterSafety(dNo)
  assert.equal(check.safe, false)
  assert.match(check.reason, /流量不足/)

  // 3. 所有条件满足
  state.lastSensors.flow_rate = 1.2
  state.lastSensors.temp_out = 30.0
  state.lastSensors.pressure = 60.0
  check = await waterControlEngine.checkHeaterSafety(dNo)
  assert.equal(check.safe, true)
})

test("全模式全局安全守卫：手动/已停止状态下收到超温、超压、干烧均能立即触发保护并广播错误流", async () => {
  const broadcastLogs = []
  waterControlEngine.__setBroadcastForTests((event, payload) => {
    broadcastLogs.push({ event, payload })
  })

  const dNo = "TEST_GLOBAL_SAFE"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.mode = "manual"
  state.fsmState = FSM_STATES.STOPPED

  // 1. 模拟收到超温数据
  await waterControlEngine.onSensorData(dNo, {
    temp_out: 46.5,
    temp_in: 30.0,
    flow_rate: 0.8,
    pressure: 60.0,
  })

  assert.equal(state.fsmState, FSM_STATES.FAULT)
  assert.match(state.faultReason, /水温超限/)

  // 检查是否同时广播了 error_realtime, alarm_realtime 和 device_status
  const events = broadcastLogs.map((b) => b.event)
  assert.ok(events.includes("error_realtime"), "必须广播 error_realtime")
  assert.ok(events.includes("alarm_realtime"), "必须广播 alarm_realtime")
  assert.ok(events.includes("device_status"), "必须广播 device_status")

  const statusMsg = broadcastLogs.find((b) => b.event === "device_status")
  assert.ok(statusMsg.payload.control, "device_status payload 必须携带 control 属性")
  assert.equal(statusMsg.payload.control.fsmState, FSM_STATES.FAULT)
})

