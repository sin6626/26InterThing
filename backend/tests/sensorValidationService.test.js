const { describe, it, beforeEach, afterEach } = require("node:test")
const assert = require("node:assert/strict")
const {
  __setConfigLoaderForTests,
  evaluateSensorVstatus,
  clearConfigCache,
} = require("../services/sensorValidationService")

describe("sensorValidationService 动态安全阈值判定", () => {
  beforeEach(() => {
    clearConfigCache()
    __setConfigLoaderForTests(async () => ({
      max_safe_temperature: 45,
      max_safe_pressure: 150,
      min_safe_flow: 0.5,
    }))
  })

  afterEach(() => {
    __setConfigLoaderForTests(null)
    clearConfigCache()
  })

  it("自带明确非零 vstatus 时优先采纳", async () => {
    const res = await evaluateSensorVstatus({ d_no: "TEST", VStatus: 2, temp_out: 25 })
    assert.equal(res, 2)
  })

  it("压力超过设定上限(150kPa)时判定为告警 vstatus = 1", async () => {
    const res = await evaluateSensorVstatus({
      d_no: "TEST_DEV",
      pressure: 160,
      temp_out: 28,
    })
    assert.equal(res, 1)
  })

  it("水温超过设定上限(45℃)时判定为告警 vstatus = 1", async () => {
    const res = await evaluateSensorVstatus({
      d_no: "TEST_DEV",
      pressure: 80,
      temp_out: 48,
    })
    assert.equal(res, 1)
  })

  it("处于正常安全范围内时判定为正常 vstatus = 0", async () => {
    const res = await evaluateSensorVstatus({
      d_no: "TEST_DEV",
      water_Y2: 1,
      pressure: 85,
      temp_out: 28.5,
      flow_rate: 0.8,
    })
    assert.equal(res, 0)
  })

  it("水泵开机运行时流量不足(0.4L/min < 0.5L/min)判定为告警 vstatus = 1 (过程二/过程三/低流)", async () => {
    const res = await evaluateSensorVstatus({
      d_no: "TEST_DEV",
      water_Y2: 1,
      pressure: 29,
      temp_out: 28.1,
      flow_rate: 0.4,
    })
    assert.equal(res, 1)
  })

  it("水泵停机静止时零流量不误报告警 vstatus = 0", async () => {
    const res = await evaluateSensorVstatus({
      d_no: "TEST_DEV",
      water_Y2: 0,
      pressure: 0,
      temp_out: 25.0,
      flow_rate: 0,
    })
    assert.equal(res, 0)
  })
})
