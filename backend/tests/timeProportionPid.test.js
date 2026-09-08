const test = require('node:test')
const assert = require('node:assert/strict')
const { createTimeProportionPid } = require('../services/timeProportionPid')
const { PID_DEFAULTS, readControlParams, validateControlParams } = require('../services/pidControlConfig')

const setup = (overrides = {}) => {
  let now = 0
  const pid = createTimeProportionPid({ clock: () => now })
  const params = { ...PID_DEFAULTS, target_temperature: 35, pid_kp: 10, ...overrides }
  return { pid, params, at: time => { now = time }, update: (value, sample) => pid.update({ value, sample, params }) }
}

test('30% 输出在20秒窗口开6秒关14秒，边界不重放', () => {
  const s = setup()
  s.at(3000); s.update(32, 1)
  assert.equal(s.pid.schedule(s.params).desired, 'on')
  s.at(8999); assert.equal(s.pid.schedule(s.params, true).desired, 'on')
  s.at(9000); assert.equal(s.pid.schedule(s.params, true).desired, 'off')
  s.pid.markOff()
  s.at(23000); assert.equal(s.pid.schedule(s.params).desired, 'on')
  s.at(79000); assert.equal(s.pid.schedule(s.params).desired, 'off')
})

test('0%、100%和最短开关限制', () => {
  for (const [temp, duty] of [[35, 0], [25, 100], [34, 0], [25.5, 85]]) {
    const s = setup(); s.at(3000); s.update(temp, 1)
    assert.equal(s.pid.schedule(s.params).plannedDuty, duty)
  }
})

test('重复样本和不足一秒不积分；不规则采样按实际秒数积分', () => {
  const s = setup({ pid_ki: 1 })
  s.update(34, 1)
  s.at(1000); s.update(34, 1)
  assert.equal(s.pid.schedule(s.params).output, 10)
  s.at(2500); s.update(34, 2)
  assert.equal(s.pid.schedule(s.params).output, 12.5)
  s.at(2600); s.update(34, 3)
  assert.equal(s.pid.schedule(s.params).output, 12.5)
})

test('输出饱和不继续积累；微分作用于测量并滤波', () => {
  const s = setup({ pid_ki: 10, pid_kd: 3 })
  s.update(20, 1); s.at(1000); s.update(20, 2)
  assert.equal(s.pid.schedule(s.params).output, 100)
  s.at(2000); s.update(34, 3)
  assert.ok(Math.abs(s.pid.schedule(s.params).output - 6) < 1e-9)
  const d = setup({ pid_kp: 0, pid_kd: 3 })
  d.update(34, 1); d.at(1000); d.update(31, 2)
  assert.equal(d.pid.schedule(d.params).output, 3)
  d.params.target_temperature = 50
  d.at(2000); d.update(31, 3)
  assert.equal(d.pid.schedule(d.params).output, 2)
})

test('窗口锁定输出，延迟开启不足最短时间时舍弃；关闭后等待', () => {
  const s = setup(); s.at(3000); s.update(32, 1)
  assert.equal(s.pid.schedule(s.params).plannedDuty, 30)
  s.at(7000); s.update(25, 2)
  assert.equal(s.pid.schedule(s.params).desired, 'off')
  assert.equal(s.pid.schedule(s.params).plannedDuty, 30)
  s.at(23000); assert.equal(s.pid.schedule(s.params).plannedDuty, 100)
  s.pid.markOff()
  assert.equal(s.pid.schedule(s.params).desired, 'off')
  s.at(26000); assert.equal(s.pid.schedule(s.params).desired, 'on')
  assert.equal(s.pid.schedule(s.params).limitationReason, null)
})

test('设备实例隔离，复位清除积分与窗口', () => {
  const a = setup(), b = setup()
  a.update(25, 1)
  assert.equal(a.pid.schedule(a.params).output, 100)
  assert.equal(b.pid.schedule(b.params).output, 0)
  a.pid.reset()
  assert.equal(a.pid.schedule(a.params).output, 0)
})

test('极端系数导致溢出时安全输出0并给出计算错误', () => {
  const s = setup({ pid_kp: 1e308 })
  s.update(30, 1)
  const result = s.pid.schedule(s.params)
  assert.equal(result.output, 0)
  assert.match(result.calculationError, /超出数值范围/)
})

test('配置兼容旧名，规范值优先；拒绝非法数字及周期组合', () => {
  let p = readControlParams([{ topic: 'pid_min_open_time', value: '5' }], {})
  assert.equal(p.pid_min_on_time, 5)
  p = readControlParams([{ topic: 'pid_min_open_time', value: '5' }, { topic: 'pid_min_on_time', value: '4' }], {})
  assert.equal(p.pid_min_on_time, 4)
  assert.equal(validateControlParams(p), null)
  assert.match(validateControlParams({ ...p, pid_ki: NaN }), /有限数字/)
  assert.match(validateControlParams({ ...p, pid_cycle_time: 2 }), /之和/)
  assert.match(validateControlParams({ ...p, temperature_control_strategy: 'pid' }, { starting: true }), /Kp/)
})

test('达到目标立即截断长脉冲，不受一秒节流和最短开启时间限制', () => {
  const s = setup({ pid_ki: 1 })
  s.at(3000); s.update(30, 1)
  assert.equal(s.pid.schedule(s.params).desired, 'on')
  s.at(3100); s.update(35, 2)
  const result = s.pid.schedule(s.params, true)
  assert.equal(result.desired, 'off')
  assert.equal(result.plannedDuty, 0)
  assert.equal(result.suppressed, true)
  assert.equal(result.resumeTemperature, 34.7)
})

test('恢复回差内保持关热，积分清除，恢复不重放原窗口且遵守最短关闭', () => {
  const s = setup({ pid_ki: 10 })
  s.at(3000); s.update(32, 1); s.pid.schedule(s.params)
  s.at(4000); s.update(32, 2)
  assert.equal(s.pid.schedule(s.params).output, 60)
  s.at(4100); s.update(35.1, 3); s.pid.markOff()
  s.at(5000); s.update(34.8, 4)
  assert.equal(s.pid.schedule(s.params).suppressed, true)
  s.at(6000); s.update(33, 5)
  assert.equal(s.pid.schedule(s.params).output, 20)
  assert.equal(s.pid.schedule(s.params).desired, 'off')
  s.at(23000); s.pid.markOff()
  assert.equal(s.pid.schedule(s.params).desired, 'off')
  s.at(26000); assert.equal(s.pid.schedule(s.params).desired, 'off') // 只剩1秒，舍弃
  s.pid.reset()
  assert.equal(s.pid.schedule(s.params).suppressed, false)
})

test('恢复回差必须为正有限数字且低于目标温度', () => {
  const p = { ...PID_DEFAULTS, target_temperature: 35 }
  for (const value of [0, -1, NaN, Infinity, 35]) {
    assert.ok(validateControlParams({ ...p, pid_resume_hysteresis: value }))
  }
})
