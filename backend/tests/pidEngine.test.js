const test = require('node:test')
const assert = require('node:assert/strict')
const engine = require('../services/waterControlEngine')
const dNo = 'PID_TEST'
let now, rows, commands
const sensors = (extra = {}) => ({ temp_in: 30, temp_out: 32, flow_rate: 1, pressure: 60, water_Y2: 1, heat_Y1: 0, ...extra })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
test.beforeEach(() => {
  engine.__resetForTests()
  now = 0; commands = []
  rows = [
    { id: 0, topic: 'master', value: 'on' },
    ...Object.entries({ ...engine.DEFAULT_CONTROL_PARAMS, temperature_control_strategy: 'pid', pid_kp: 10 }).map(([topic, value], i) => ({ id: i + 10, topic, value })),
    { id: 90, topic: 'pump' }, { id: 91, topic: 'heater' },
  ]
  engine.__setClockForTests(() => now)
  engine.__setConfigLoaderForTests(async () => rows)
  engine.__setBroadcastForTests(() => {})
  engine.__setMqttClientForTests({ publishToDevice: async (_topic, payload) => { commands.push(payload) } })
})
test.afterEach(() => engine.__resetForTests())
const start = async () => {
  await engine.onSensorData(dNo, sensors({ water_Y2: 0 }))
  await engine.startAuto(dNo)
  await engine.onSensorData(dNo, sensors())
  now = 3000
  await engine.watchdogTick()
}

test('PID在无新传感器包时仍按窗口关加热；实际状态不随PUBACK伪造', async () => {
  await start()
  assert.equal(engine.getDeviceControlStatus(dNo).pid.output, 30)
  assert.equal(engine.getDeviceControlStatus(dNo).heaterState, 'off')
  assert.equal(commands.at(-1).value, 'on')
  now = 9000; await engine.watchdogTick()
  assert.equal(commands.at(-1).value, 'off')
})

test('停止抢占尚在读取配置的开启动作，旧任务不能重新开加热', async () => {
  await start()
  await engine.stopAuto(dNo)
  const count = commands.length
  await engine.onSensorData(dNo, sensors({ temp_out: 20 }))
  now = 25000; await engine.watchdogTick()
  assert.ok(commands.slice(count).every(c => c.value !== 'on'))
})

test('开启发布进行中停止：队列尾部关闭，迟到回调不恢复期望开启', async () => {
  await engine.onSensorData(dNo, sensors({ water_Y2: 0 }))
  await engine.startAuto(dNo); await engine.onSensorData(dNo, sensors())
  const pending = deferred(), entered = deferred()
  engine.__setMqttClientForTests({ publishToDevice: async (_topic, payload) => {
    commands.push(payload)
    if (payload.topic === 'heater' && payload.value === 'on') { entered.resolve(); await pending.promise }
  } })
  now = 3000
  const tick = engine.watchdogTick()
  await entered.promise
  const stop = engine.stopAuto(dNo)
  pending.resolve()
  await Promise.all([tick, stop])
  assert.equal(commands.at(-1).value, 'off')
  assert.equal(engine.getDeviceControlStatus(dNo).desiredHeaterState, 'off')
  assert.equal(engine.getDeviceControlStatus(dNo).fsmState, 'COOLING')
})

test('参数变更停止冷却；非法参数锁定故障；未整定不启动', async () => {
  await start()
  rows.find(r => r.topic === 'pid_kp').value = 12
  await engine.watchdogTick()
  assert.equal(engine.getDeviceControlStatus(dNo).fsmState, 'COOLING')
  assert.match(engine.getDeviceControlStatus(dNo).restartReason, /重新启动/)
  engine.getOrCreateDeviceState(dNo).fsmState = 'STOPPED'
  rows.find(r => r.topic === 'pid_kp').value = 0
  await assert.rejects(engine.startAuto(dNo), /Kp/)
  rows.find(r => r.topic === 'pid_kp').value = 10
  await engine.startAuto(dNo); await engine.onSensorData(dNo, sensors())
  rows.find(r => r.topic === 'pid_cycle_time').value = 'oops'
  await engine.watchdogTick()
  assert.equal(engine.getDeviceControlStatus(dNo).faultCode, 'CONTROL_CONFIG_INVALID')
})

test('运行中拒绝手动开启，手动关闭撤销PID；故障不自动恢复', async () => {
  await start()
  await assert.rejects(engine.executeManualAction(dNo, 'pump', 'on'), /不能手动开启/)
  await engine.executeManualAction(dNo, 'heater', 'off')
  assert.equal(engine.getDeviceControlStatus(dNo).fsmState, 'COOLING')
  await engine.triggerFault(dNo, { code: 'OVER_PRESSURE', reason: '测试', stopPump: true })
  const count = commands.length
  await engine.onSensorData(dNo, sensors())
  now += 1000; await engine.watchdogTick()
  assert.equal(commands.length, count)
  assert.equal(engine.getDeviceControlStatus(dNo).fsmState, 'FAULT')
})

test('发布失败锁定，安全关闭失败按一秒节流且不阻碍停泵', async () => {
  await start()
  let attempts = 0
  engine.__setMqttClientForTests({ publishToDevice: async (_topic, payload) => {
    commands.push(payload)
    if (payload.topic === 'heater') { attempts++; throw new Error('Broker拒绝') }
  } })
  now = 9000; await engine.watchdogTick()
  assert.equal(engine.getDeviceControlStatus(dNo).fsmState, 'FAULT')
  const before = attempts
  await engine.watchdogTick()
  assert.equal(attempts, before)
  now += 1000; await engine.watchdogTick()
  assert.equal(attempts, before + 1)
  assert.ok(commands.some(c => c.topic === 'pump' && c.value === 'off'))
})

test('安全保护绕过最短开启时间并保持实际反馈', async () => {
  await start()
  now += 100
  await engine.onSensorData(dNo, sensors({ temp_out: 45, heat_Y1: 1 }))
  const status = engine.getDeviceControlStatus(dNo)
  assert.equal(status.heaterState, 'on')
  assert.equal(status.desiredHeaterState, 'off')
  assert.equal(status.fsmState, 'FAULT')
})

test('一个设备发布挂起不阻止另一个设备关闭窗口', async () => {
  await start()
  const other = 'PID_OTHER'
  await engine.onSensorData(other, sensors({ water_Y2: 0 }))
  await engine.startAuto(other); await engine.onSensorData(other, sensors())
  const pending = deferred(), entered = deferred()
  engine.__setMqttClientForTests({ publishToDevice: async (_topic, payload) => {
    commands.push(payload)
    if (payload.d_no === other && payload.value === 'on') { entered.resolve(); await pending.promise }
  } })
  now = 6000
  const first = engine.watchdogTick()
  await entered.promise
  now = 9000
  const second = engine.watchdogTick()
  // 第二设备仍挂起时，首设备的off必须已经发出。
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(commands.some(c => c.d_no === dNo && c.topic === 'heater' && c.value === 'off' && c !== commands[0]))
  assert.equal(engine.getDeviceControlStatus(dNo).desiredHeaterState, 'off')
  pending.resolve(); await Promise.all([first, second])
})

test('排队到窗口结束的旧开启不能发布', async () => {
  await engine.onSensorData(dNo, sensors({ water_Y2: 0 }))
  await engine.startAuto(dNo); await engine.onSensorData(dNo, sensors())
  const state = engine.getOrCreateDeviceState(dNo)
  const pending = deferred()
  state.actionTail = pending.promise
  now = 3000
  const tick = engine.watchdogTick()
  await new Promise(resolve => setImmediate(resolve))
  now = 10000
  pending.resolve(); await tick
  assert.ok(commands.every(c => !(c.topic === 'heater' && c.value === 'on')))
})

test('复位等待期间的新超压故障不能被复位完成覆盖', async () => {
  await start()
  const pending = deferred(), entered = deferred()
  engine.__setMqttClientForTests({ publishToDevice: async (_topic, payload) => {
    commands.push(payload)
    if (payload.topic === 'heater' && payload.value === 'off') { entered.resolve(); await pending.promise }
  } })
  const reset = engine.resetFault(dNo)
  const rejected = assert.rejects(reset, /新故障|状态变化/)
  await entered.promise
  const fault = engine.onSensorData(dNo, sensors({ pressure: 160 }))
  await new Promise(resolve => setImmediate(resolve))
  pending.resolve(); await Promise.all([rejected, fault])
  assert.equal(engine.getDeviceControlStatus(dNo).faultCode, 'OVER_PRESSURE')
  assert.equal(engine.getDeviceControlStatus(dNo).fsmState, 'FAULT')
})

test('开启已发但PUBACK超时，必须再次真正发布安全关闭', async () => {
  await engine.onSensorData(dNo, sensors({ water_Y2: 0 }))
  await engine.startAuto(dNo); await engine.onSensorData(dNo, sensors())
  rows.find(r => r.topic === 'command_timeout').value = 0.01
  const received = []
  engine.__setMqttClientForTests({ publishToDevice: async (_topic, payload) => {
    received.push([payload.topic, payload.value])
    if (payload.topic === 'heater' && payload.value === 'on') await new Promise(() => {})
  } })
  now = 3000; await engine.watchdogTick()
  assert.deepEqual(received, [['heater', 'on'], ['heater', 'off'], ['pump', 'off']])
  assert.equal(engine.getDeviceControlStatus(dNo).fsmState, 'FAULT')
})

test('冷却停泵发布迟到不能覆盖新故障', async () => {
  await start(); await engine.stopAuto(dNo)
  engine.getOrCreateDeviceState(dNo).countdown = 1
  const pending = deferred(), entered = deferred()
  engine.__setMqttClientForTests({ publishToDevice: async (_topic, payload) => {
    if (payload.topic === 'pump' && payload.value === 'off') { entered.resolve(); await pending.promise }
  } })
  const cooling = engine.watchdogTick()
  await entered.promise
  const fault = engine.onSensorData(dNo, sensors({ pressure: 160 }))
  await new Promise(resolve => setImmediate(resolve))
  pending.resolve(); await Promise.all([cooling, fault])
  assert.equal(engine.getDeviceControlStatus(dNo).fsmState, 'FAULT')
  assert.equal(engine.getDeviceControlStatus(dNo).faultCode, 'OVER_PRESSURE')
})

test('配置读取挂起也先执行已到期的PID关闭', async () => {
  await start()
  const pending = deferred()
  engine.__setConfigLoaderForTests(async () => { await pending.promise; return rows })
  now = 9000
  const tick = engine.watchdogTick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(commands.at(-1).value, 'off')
  assert.equal(engine.getDeviceControlStatus(dNo).desiredHeaterState, 'off')
  pending.resolve(); await tick
})

test('用户停止不等待数据库，立即用已有模板关闭加热', async () => {
  await start()
  const pending = deferred()
  engine.__setConfigLoaderForTests(async () => { await pending.promise; return rows })
  const stop = engine.stopAuto(dNo)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(commands.at(-1).value, 'off')
  assert.equal(engine.getDeviceControlStatus(dNo).fsmState, 'COOLING')
  pending.resolve(); await stop
})

test('PID达到目标在本窗口立即发布关闭，回差内不重开且不进入故障', async () => {
  await start()
  now = 3100
  await engine.onSensorData(dNo, sensors({ temp_out: 35, heat_Y1: 1 }))
  assert.equal(commands.at(-1).topic, 'heater')
  assert.equal(commands.at(-1).value, 'off')
  assert.equal(engine.getDeviceControlStatus(dNo).pid.suppressed, true)
  assert.equal(engine.getDeviceControlStatus(dNo).fsmState, 'RUNNING')
  now = 4000
  await engine.onSensorData(dNo, sensors({ temp_out: 34.8 }))
  assert.equal(engine.getDeviceControlStatus(dNo).pid.desired, 'off')
})
