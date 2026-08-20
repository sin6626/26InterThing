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
  { id: 19, topic: "data_timeout", value: "3" },
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
  assert.equal(state.desiredHeaterState, "on")

  // 2. 水温升至 34.8 ℃（处于 34.5 ~ 35.0 回差区间） -> 加热应保持开启
  await waterControlEngine.onSensorData(dNo, {
    temp_out: 34.8,
    temp_in: 31.0,
    flow_rate: 1.2,
    pressure: 50.0,
  })
  assert.equal(state.desiredHeaterState, "on")

  // 3. 水温达到 35.2 ℃ >= 35.0 ℃ -> 应自动关闭加热
  await waterControlEngine.onSensorData(dNo, {
    temp_out: 35.2,
    temp_in: 32.0,
    flow_rate: 1.2,
    pressure: 50.0,
  })
  assert.equal(state.desiredHeaterState, "off")

  // 4. 水温小幅回落至 34.8 ℃ -> 加热应保持关闭，避免频繁开关
  await waterControlEngine.onSensorData(dNo, {
    temp_out: 34.8,
    temp_in: 31.5,
    flow_rate: 1.2,
    pressure: 50.0,
  })
  assert.equal(state.desiredHeaterState, "off")
})

test("启动未建流保护：超过建流超时时间未达到安全流量，自动停泵并进入故障状态", async () => {
  const dNo = "TEST_002"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  await waterControlEngine.onSensorData(dNo, {
    temp_in: 25,
    temp_out: 25,
    flow_rate: 0,
    pressure: 0,
    water_Y2: 0,
    heat_Y1: 0,
  })

  await waterControlEngine.startAuto(dNo)
  assert.equal(state.fsmState, FSM_STATES.BUILDING_FLOW)
  assert.equal(state.desiredPumpState, "on")
  assert.equal(state.desiredHeaterState, "off")

  // 模拟经过 5 秒看门狗巡检（流量一直为 0）
  for (let i = 0; i < 5; i++) {
    state.lastSensorTime = Date.now() // 保活传感器
    await waterControlEngine.watchdogTick()
  }

  assert.equal(state.fsmState, FSM_STATES.FAULT)
  assert.equal(state.desiredPumpState, "off")
  assert.match(state.faultReason, /启动未建流/)
})

test("运行中失流保护：正常加热中流量过低持续2秒，立即切断加热并报警", async () => {
  const dNo = "TEST_003"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.mode = "auto"
  state.fsmState = FSM_STATES.RUNNING
  state.pumpState = "on"
  state.heaterState = "on"
  state.desiredPumpState = "on"
  state.desiredHeaterState = "on"

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
  assert.equal(state.desiredHeaterState, "off")
  assert.equal(state.desiredPumpState, "off")
  assert.match(state.faultReason, /运行中流量过低/)
})

test("超温保护：水温超过安全上限，立即切断加热，水泵保持运行散热", async () => {
  const dNo = "TEST_004"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.mode = "auto"
  state.fsmState = FSM_STATES.RUNNING
  state.pumpState = "on"
  state.heaterState = "on"
  state.desiredPumpState = "on"
  state.desiredHeaterState = "on"

  await waterControlEngine.onSensorData(dNo, {
    temp_out: 46.5, // >= 45.0 ℃
    temp_in: 38.0,
    flow_rate: 1.5,
    pressure: 60.0,
  })

  assert.equal(state.fsmState, FSM_STATES.FAULT)
  assert.equal(state.desiredHeaterState, "off")
  assert.equal(state.pumpState, "on") // 水泵保持运行以带走余热
  assert.equal(state.desiredPumpState, "on")
  assert.match(state.faultReason, /水温超限/)
})

test("超压保护：管路压力超过安全上限，立即切断加热并停水泵", async () => {
  const dNo = "TEST_005"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.mode = "auto"
  state.fsmState = FSM_STATES.RUNNING
  state.pumpState = "on"
  state.heaterState = "on"
  state.desiredPumpState = "on"
  state.desiredHeaterState = "on"

  await waterControlEngine.onSensorData(dNo, {
    temp_out: 32.0,
    temp_in: 30.0,
    flow_rate: 1.5,
    pressure: 160.0, // >= 150.0 kPa
  })

  assert.equal(state.fsmState, FSM_STATES.FAULT)
  assert.equal(state.desiredHeaterState, "off")
  assert.equal(state.desiredPumpState, "off")
  assert.match(state.faultReason, /管路超压/)
})

test("正常停止与冷却延时：先关加热，水泵延时运行10秒后关闭", async () => {
  const dNo = "TEST_006"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.mode = "auto"
  state.fsmState = FSM_STATES.RUNNING
  state.pumpState = "on"
  state.heaterState = "on"
  state.desiredPumpState = "on"
  state.desiredHeaterState = "on"

  await waterControlEngine.onSensorData(dNo, {
    temp_in: 31,
    temp_out: 34.8,
    flow_rate: 1.2,
    pressure: 60,
    water_Y2: 1,
    heat_Y1: 1,
  })

  await waterControlEngine.stopAuto(dNo)
  assert.equal(state.fsmState, FSM_STATES.COOLING)
  assert.equal(state.desiredHeaterState, "off")
  assert.equal(state.pumpState, "on")
  assert.equal(state.countdown, 10)

  // 经过 10 秒倒计时
  for (let i = 0; i < 10; i++) {
    await waterControlEngine.watchdogTick()
  }

  assert.equal(state.fsmState, FSM_STATES.STOPPED)
  assert.equal(state.desiredPumpState, "off")
})

test("手动控制安全审查：流量不足或水泵未开时拒绝加热，条件满足时允许", async () => {
  const dNo = "TEST_007"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)

  // 1. 水泵未开
  await waterControlEngine.onSensorData(dNo, {
    temp_in: 25,
    temp_out: 25,
    flow_rate: 1.0,
    pressure: 50,
    water_Y2: 0,
    heat_Y1: 0,
  })
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

test("单个流量传感器停止更新时，明确标记流量超时并安全停机", async () => {
  const realNow = Date.now
  let now = 1_800_000_000_000
  Date.now = () => now

  try {
    const dNo = "TEST_SENSOR_FLOW_STALE"
    const state = waterControlEngine.getOrCreateDeviceState(dNo)
    state.mode = "auto"
    state.fsmState = FSM_STATES.RUNNING

    await waterControlEngine.onSensorData(dNo, {
      temp_in: 30,
      temp_out: 32,
      flow_rate: 1.2,
      pressure: 60,
      water_Y2: 1,
      heat_Y1: 0,
    })

    now += 6_000
    await waterControlEngine.onSensorData(dNo, {
      temp_in: 30.1,
      temp_out: 32.1,
      pressure: 61,
      water_Y2: 1,
      heat_Y1: 0,
    })

    const status = waterControlEngine.getDeviceControlStatus(dNo)
    assert.deepEqual(status.staleSensors, ["flow_rate"])
    assert.equal(status.fsmState, FSM_STATES.FAULT)
    assert.equal(status.faultCode, "SENSOR_FLOW_TIMEOUT")
    assert.equal(status.desiredHeaterState, "off")
    assert.equal(status.desiredPumpState, "off")
  } finally {
    Date.now = realNow
  }
})

test("运行中即使加热已经关闭，持续低流量仍会停泵并进入故障", async () => {
  const dNo = "TEST_LOW_FLOW_HEATER_OFF"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.fsmState = FSM_STATES.RUNNING
  state.pumpState = "on"
  state.heaterState = "off"
  state.desiredPumpState = "on"

  await waterControlEngine.onSensorData(dNo, {
    temp_in: 31,
    temp_out: 35,
    flow_rate: 0.1,
    pressure: 40,
    water_Y2: 1,
    heat_Y1: 0,
  })
  state.lowFlowStartTime = Date.now() - 2_000
  await waterControlEngine.onSensorData(dNo, {
    temp_in: 31,
    temp_out: 35,
    flow_rate: 0.1,
    pressure: 40,
    water_Y2: 1,
    heat_Y1: 0,
  })

  assert.equal(state.faultCode, "LOW_FLOW")
  assert.equal(state.desiredPumpState, "off")
  assert.equal(state.desiredHeaterState, "off")
})

test("手动开泵低流量不会误进入自动建流，停泵时高压力也不触发超压", async () => {
  waterControlEngine.__setConfigLoaderForTests(async () => [
    ...DEFAULT_MOCK_CONFIGS.filter((item) => item.topic !== "master"),
    { id: 0, topic: "master", value: "off" },
  ])

  const dNo = "TEST_MANUAL_PUMP"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  await waterControlEngine.onSensorData(dNo, {
    temp_in: 30,
    temp_out: 31,
    flow_rate: 0,
    pressure: 20,
    water_Y2: 1,
    heat_Y1: 0,
  })
  assert.equal(state.fsmState, FSM_STATES.STOPPED)

  await waterControlEngine.onSensorData(dNo, {
    temp_in: 30,
    temp_out: 31,
    flow_rate: 0,
    pressure: 160,
    water_Y2: 0,
    heat_Y1: 0,
  })
  assert.equal(state.fsmState, FSM_STATES.STOPPED)
  assert.equal(state.faultCode, null)
})

test("同时超温和超压时以超压停泵策略优先", async () => {
  const dNo = "TEST_COMPOUND_FAULT"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.fsmState = FSM_STATES.RUNNING
  state.desiredPumpState = "on"
  state.desiredHeaterState = "on"

  await waterControlEngine.onSensorData(dNo, {
    temp_in: 46,
    temp_out: 45,
    flow_rate: 1,
    pressure: 150,
    water_Y2: 1,
    heat_Y1: 1,
  })

  assert.equal(state.faultCode, "OVER_PRESSURE")
  assert.equal(state.desiredPumpState, "off")
  assert.match(state.faultReason, /同时检测到温度超限/)
})

test("仅温度传感器停止更新时关闭加热并短时冷却", async () => {
  const realNow = Date.now
  let now = 1_800_000_100_000
  Date.now = () => now

  try {
    const dNo = "TEST_TEMPERATURE_STALE"
    const state = waterControlEngine.getOrCreateDeviceState(dNo)
    state.fsmState = FSM_STATES.RUNNING
    state.desiredPumpState = "on"
    state.desiredHeaterState = "on"

    await waterControlEngine.onSensorData(dNo, {
      temp_in: 31,
      temp_out: 32,
      flow_rate: 1.1,
      pressure: 60,
      water_Y2: 1,
      heat_Y1: 1,
    })
    now += 6_000
    await waterControlEngine.onSensorData(dNo, {
      flow_rate: 1.1,
      pressure: 60,
      water_Y2: 1,
      heat_Y1: 1,
    })

    assert.equal(state.fsmState, FSM_STATES.COOLING)
    assert.equal(state.faultCode, "SENSOR_TEMPERATURE_TIMEOUT")
    assert.deepEqual(waterControlEngine.getDeviceControlStatus(dNo).staleSensors, ["temp_in", "temp_out"])
    assert.equal(state.desiredHeaterState, "off")
    assert.equal(state.desiredPumpState, "on")
  } finally {
    Date.now = realNow
  }
})

test("温度传感器持续超时时冷却倒计时继续推进，不重复初始化保护流程", async () => {
  const realNow = Date.now
  let now = 1_800_000_200_000
  Date.now = () => now

  try {
    const dNo = "TEST_TEMPERATURE_STALE_COUNTDOWN"
    const state = waterControlEngine.getOrCreateDeviceState(dNo)
    state.fsmState = FSM_STATES.RUNNING
    state.desiredPumpState = "on"
    state.desiredHeaterState = "on"

    await waterControlEngine.onSensorData(dNo, {
      temp_in: 31,
      temp_out: 32,
      flow_rate: 1.1,
      pressure: 60,
      water_Y2: 1,
      heat_Y1: 1,
    })
    now += 6_000
    await waterControlEngine.onSensorData(dNo, {
      flow_rate: 1.1,
      pressure: 60,
      water_Y2: 1,
      heat_Y1: 0,
    })
    assert.equal(state.countdown, 10)

    await waterControlEngine.watchdogTick()
    await waterControlEngine.watchdogTick()

    assert.equal(state.countdown, 8)
    assert.equal(state.fsmState, FSM_STATES.COOLING)

    for (let index = 0; index < 8; index++) await waterControlEngine.watchdogTick()
    assert.equal(state.fsmState, FSM_STATES.FAULT)
    assert.equal(state.desiredPumpState, "off")
  } finally {
    Date.now = realNow
  }
})

test("四项传感器分别停止更新后均能准确定位，并在恢复上报后清除离线标记", async () => {
  const realNow = Date.now
  let now = 1_800_000_300_000
  Date.now = () => now
  const validPayload = {
    temp_in: 31,
    temp_out: 34,
    flow_rate: 1,
    pressure: 60,
    water_Y2: 1,
    heat_Y1: 0,
  }

  try {
    for (const field of ["temp_in", "temp_out", "flow_rate", "pressure"]) {
      const dNo = `TEST_STALE_${field}`
      const state = waterControlEngine.getOrCreateDeviceState(dNo)
      state.fsmState = FSM_STATES.RUNNING
      await waterControlEngine.onSensorData(dNo, validPayload)

      now += 6_000
      const missingPayload = { ...validPayload }
      delete missingPayload[field]
      await waterControlEngine.onSensorData(dNo, missingPayload)
      assert.deepEqual(waterControlEngine.getDeviceControlStatus(dNo).staleSensors, [field])

      await waterControlEngine.onSensorData(dNo, { [field]: validPayload[field] })
      assert.deepEqual(waterControlEngine.getDeviceControlStatus(dNo).staleSensors, [])
    }
  } finally {
    Date.now = realNow
  }
})

test("四项传感器分别收到非法值时均不会覆盖为数值零", async () => {
  const validPayload = {
    temp_in: 31,
    temp_out: 34,
    flow_rate: 1,
    pressure: 60,
    water_Y2: 1,
    heat_Y1: 0,
  }

  for (const field of ["temp_in", "temp_out", "flow_rate", "pressure"]) {
    const dNo = `TEST_INVALID_${field}`
    const state = waterControlEngine.getOrCreateDeviceState(dNo)
    state.fsmState = FSM_STATES.RUNNING
    await waterControlEngine.onSensorData(dNo, {
      ...validPayload,
      [field]: "not-a-number",
    })
    assert.equal(state.lastSensors[field], null)
    assert.deepEqual(waterControlEngine.getDeviceControlStatus(dNo).staleSensors, [field])
  }
})

test("传感器超时边界按超过配置秒数触发，恰好5秒仍视为有效", async () => {
  waterControlEngine.__setConfigLoaderForTests(async () => [
    ...DEFAULT_MOCK_CONFIGS.filter((item) => item.topic !== "data_timeout"),
    { id: 19, topic: "data_timeout", value: "5" },
  ])
  const realNow = Date.now
  let now = 1_800_000_400_000
  Date.now = () => now

  try {
    const dNo = "TEST_DATA_TIMEOUT_BOUNDARY"
    const state = waterControlEngine.getOrCreateDeviceState(dNo)
    state.fsmState = FSM_STATES.RUNNING
    await waterControlEngine.onSensorData(dNo, {
      temp_in: 31,
      temp_out: 34,
      flow_rate: 1,
      pressure: 60,
      water_Y2: 1,
      heat_Y1: 0,
    })

    now += 5_000
    await waterControlEngine.onSensorData(dNo, {
      temp_in: 31,
      temp_out: 34,
      flow_rate: 1,
      water_Y2: 1,
      heat_Y1: 0,
    })
    assert.equal(state.fsmState, FSM_STATES.RUNNING)
    assert.deepEqual(waterControlEngine.getDeviceControlStatus(dNo).staleSensors, [])

    now += 1
    await waterControlEngine.onSensorData(dNo, {
      temp_in: 31,
      temp_out: 34,
      flow_rate: 1,
      water_Y2: 1,
      heat_Y1: 0,
    })
    assert.equal(state.faultCode, "SENSOR_PRESSURE_TIMEOUT")
  } finally {
    Date.now = realNow
  }
})

test("温度超时时期望水泵已开但实际未回报，也会发布停泵并清除期望状态", async () => {
  const realNow = Date.now
  let now = 1_800_000_500_000
  Date.now = () => now

  try {
    const dNo = "TEST_TEMPERATURE_STALE_DESIRED_PUMP"
    const state = waterControlEngine.getOrCreateDeviceState(dNo)
    state.fsmState = FSM_STATES.BUILDING_FLOW
    state.desiredPumpState = "on"
    await waterControlEngine.onSensorData(dNo, {
      temp_in: 31,
      temp_out: 34,
      flow_rate: 0,
      pressure: 0,
      water_Y2: 0,
      heat_Y1: 0,
    })

    now += 4_000
    await waterControlEngine.onSensorData(dNo, {
      flow_rate: 0,
      pressure: 0,
      water_Y2: 0,
      heat_Y1: 0,
    })

    assert.equal(state.fsmState, FSM_STATES.FAULT)
    assert.equal(state.faultCode, "SENSOR_TEMPERATURE_TIMEOUT")
    assert.equal(state.desiredPumpState, "off")
  } finally {
    Date.now = realNow
  }
})

test("手动开泵已发布但实际状态未回报时，传感器超时仍执行安全停机", async () => {
  const realNow = Date.now
  let now = 1_800_000_550_000
  Date.now = () => now

  try {
    const dNo = "TEST_MANUAL_DESIRED_PUMP_STALE"
    const state = waterControlEngine.getOrCreateDeviceState(dNo)
    await waterControlEngine.onSensorData(dNo, {
      temp_in: 31,
      temp_out: 34,
      flow_rate: 1,
      pressure: 60,
      water_Y2: 0,
      heat_Y1: 0,
    })
    state.desiredPumpState = "on"

    now += 4_000
    await waterControlEngine.onSensorData(dNo, {
      temp_in: 31,
      temp_out: 34,
      pressure: 60,
      water_Y2: 0,
      heat_Y1: 0,
    })

    assert.equal(state.fsmState, FSM_STATES.FAULT)
    assert.equal(state.faultCode, "SENSOR_FLOW_TIMEOUT")
    assert.equal(state.desiredPumpState, "off")
  } finally {
    Date.now = realNow
  }
})

test("温度超时关闭加热发布失败时进入故障并保留水泵", async () => {
  const realNow = Date.now
  let now = 1_800_000_600_000
  Date.now = () => now

  try {
    const dNo = "TEST_TEMPERATURE_STALE_HEATER_FAILURE"
    const state = waterControlEngine.getOrCreateDeviceState(dNo)
    state.fsmState = FSM_STATES.RUNNING
    state.desiredPumpState = "on"
    state.desiredHeaterState = "on"
    await waterControlEngine.onSensorData(dNo, {
      temp_in: 31,
      temp_out: 34,
      flow_rate: 1,
      pressure: 60,
      water_Y2: 1,
      heat_Y1: 1,
    })
    waterControlEngine.__setMqttClientForTests({
      publishToDevice: async (_topic, payload) => {
        if (payload.topic === "heater") throw new Error("关加热发布失败")
      },
    })

    now += 4_000
    await waterControlEngine.onSensorData(dNo, {
      flow_rate: 1,
      pressure: 60,
      water_Y2: 1,
      heat_Y1: 1,
    })

    assert.equal(state.fsmState, FSM_STATES.FAULT)
    assert.equal(state.faultCode, "COMMAND_PUBLISH_FAILED")
    assert.equal(state.desiredPumpState, "on")
    assert.match(state.faultReason, /关闭加热发布失败/)
  } finally {
    Date.now = realNow
  }
})

test("冷却期间流量低于安全阈值时立即停泵并进入故障", async () => {
  const dNo = "TEST_COOLING_LOW_FLOW"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.fsmState = FSM_STATES.COOLING
  state.coolingExitState = FSM_STATES.STOPPED
  state.desiredPumpState = "on"

  await waterControlEngine.onSensorData(dNo, {
    temp_in: 31,
    temp_out: 34,
    flow_rate: 0.49,
    pressure: 60,
    water_Y2: 1,
    heat_Y1: 0,
  })

  assert.equal(state.fsmState, FSM_STATES.FAULT)
  assert.equal(state.faultCode, "LOW_FLOW")
  assert.equal(state.desiredPumpState, "off")
})

test("带尾随字符的传感器值按非法数据处理，不被 parseFloat 截断接受", async () => {
  const dNo = "TEST_INVALID_SENSOR_VALUE"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.fsmState = FSM_STATES.RUNNING

  await waterControlEngine.onSensorData(dNo, {
    temp_in: 31,
    temp_out: 34,
    flow_rate: "0.8异常",
    pressure: 60,
    water_Y2: 1,
    heat_Y1: 0,
  })

  assert.equal(state.lastSensors.flow_rate, null)
  assert.equal(state.faultCode, "SENSOR_FLOW_TIMEOUT")
  assert.equal(state.desiredPumpState, "off")
})

test("故障状态下执行停止不会解除故障锁定", async () => {
  const dNo = "TEST_STOP_WHILE_FAULTED"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.fsmState = FSM_STATES.RUNNING

  await waterControlEngine.onSensorData(dNo, {
    temp_in: 31,
    temp_out: 34,
    flow_rate: 1,
    pressure: 150,
    water_Y2: 1,
    heat_Y1: 1,
  })
  assert.equal(state.fsmState, FSM_STATES.FAULT)

  await waterControlEngine.stopAuto(dNo)

  assert.equal(state.fsmState, FSM_STATES.FAULT)
  assert.equal(state.faultCode, "OVER_PRESSURE")
  await assert.rejects(() => waterControlEngine.startAuto(dNo), /仍处于故障状态/)
})

test("故障散热失效时即使关加热发布失败也继续尝试停泵", async () => {
  const dNo = "TEST_FAULT_COOLING_PUMP_PRIORITY"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.fsmState = FSM_STATES.RUNNING
  state.desiredPumpState = "on"
  state.desiredHeaterState = "on"

  await waterControlEngine.onSensorData(dNo, {
    temp_in: 46,
    temp_out: 45,
    flow_rate: 1,
    pressure: 60,
    water_Y2: 1,
    heat_Y1: 1,
  })
  assert.equal(state.faultCode, "OVER_TEMPERATURE")

  const attemptedTopics = []
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async (_topic, payload) => {
      attemptedTopics.push(payload.topic)
      if (payload.topic === "heater") throw new Error("加热通道发布失败")
    },
  })
  await waterControlEngine.onSensorData(dNo, {
    temp_in: 44,
    temp_out: 44,
    flow_rate: 0.1,
    pressure: 60,
    water_Y2: 1,
    heat_Y1: 1,
  })

  assert.deepEqual(attemptedTopics, ["heater", "pump"])
  assert.equal(state.desiredPumpState, "off")
})

test("故障未复位不能直接重新启动，危险条件未解除不能复位", async () => {
  const dNo = "TEST_FAULT_RESET_GUARD"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  await waterControlEngine.onSensorData(dNo, {
    temp_in: 46,
    temp_out: 45,
    flow_rate: 1,
    pressure: 60,
    water_Y2: 1,
    heat_Y1: 1,
  })

  await assert.rejects(() => waterControlEngine.startAuto(dNo), /仍处于故障状态/)
  await assert.rejects(() => waterControlEngine.resetFault(dNo), /水温仍达到安全上限/)
  assert.equal(state.fsmState, FSM_STATES.FAULT)
})

test("MQTT发布失败时动作失败并保留实际执行器状态", async () => {
  const dNo = "TEST_COMMAND_REJECTED"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  await waterControlEngine.onSensorData(dNo, {
    temp_in: 30,
    temp_out: 31,
    flow_rate: 0,
    pressure: 0,
    water_Y2: 0,
    heat_Y1: 0,
  })
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: async () => { throw new Error("Broker不可用") },
  })

  await assert.rejects(() => waterControlEngine.startAuto(dNo), /Broker不可用/)
  assert.equal(state.fsmState, FSM_STATES.FAULT)
  assert.equal(state.faultCode, "COMMAND_PUBLISH_FAILED")
  assert.equal(state.pumpState, "off")
  assert.equal(state.heaterState, "off")
  assert.equal(state.lastCommandStatus.status, "failed")
})

test("MQTT发布超过command_timeout时按发布失败处理", async () => {
  waterControlEngine.__setConfigLoaderForTests(async () => [
    ...DEFAULT_MOCK_CONFIGS,
    { id: 20, topic: "command_timeout", value: "0.01" },
  ])
  waterControlEngine.__setMqttClientForTests({
    publishToDevice: () => new Promise(() => {}),
  })

  const dNo = "TEST_COMMAND_TIMEOUT"
  await waterControlEngine.onSensorData(dNo, {
    temp_in: 30,
    temp_out: 31,
    flow_rate: 0,
    pressure: 0,
    water_Y2: 0,
    heat_Y1: 0,
  })

  await assert.rejects(() => waterControlEngine.startAuto(dNo), /MQTT发布超时/)
  const status = waterControlEngine.getDeviceControlStatus(dNo)
  assert.equal(status.faultCode, "COMMAND_PUBLISH_FAILED")
  assert.equal(status.lastCommandStatus.status, "failed")
})

test("安全阈值边界采用包含比较：34.5℃开启、35℃关闭、45℃故障且0.5L/min允许运行", async () => {
  const dNo = "TEST_EXACT_BOUNDARIES"
  const state = waterControlEngine.getOrCreateDeviceState(dNo)
  state.fsmState = FSM_STATES.RUNNING
  state.pumpState = "on"
  state.desiredPumpState = "on"

  await waterControlEngine.onSensorData(dNo, {
    temp_in: 30,
    temp_out: 34.5,
    flow_rate: 0.5,
    pressure: 149.9,
    water_Y2: 1,
    heat_Y1: 0,
  })
  assert.equal(state.desiredHeaterState, "on")
  assert.equal(state.fsmState, FSM_STATES.RUNNING)

  await waterControlEngine.onSensorData(dNo, {
    temp_in: 30,
    temp_out: 35,
    flow_rate: 0.5,
    pressure: 149.9,
    water_Y2: 1,
    heat_Y1: 1,
  })
  assert.equal(state.desiredHeaterState, "off")

  await waterControlEngine.onSensorData(dNo, {
    temp_in: 45,
    temp_out: 35,
    flow_rate: 0.5,
    pressure: 149.9,
    water_Y2: 1,
    heat_Y1: 1,
  })
  assert.equal(state.faultCode, "OVER_TEMPERATURE")
})
