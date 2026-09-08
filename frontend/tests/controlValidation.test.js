import test from 'node:test'
import assert from 'node:assert/strict'

import { validateControlValue, filterControlTree } from '../src/utils/controlValidation.js'

const controlTree = [
  {
    topic: 'master',
    children: [
      { topic: 'target_temperature', t_name: '目标温度', value: 35 },
      { topic: 'temperature_hysteresis', t_name: '温度回差', value: 0.5 },
      { topic: 'max_safe_temperature', t_name: '最高安全温度', value: 45 },
      { topic: 'data_timeout', t_name: '数据更新超时时间（秒）', value: 3 },
    ],
  },
]

test('validateControlValue accepts valid positive water control parameters', () => {
  assert.doesNotThrow(() => validateControlValue(
    { topic: 'data_timeout', t_name: '数据更新超时时间（秒）', value: 5, min: null, max: null },
    controlTree,
  ))
})

test('PID允许零系数，时间必须整数且满足窗口组合约束', () => {
  for (const topic of ['pid_kp', 'pid_ki', 'pid_kd']) {
    assert.doesNotThrow(() => validateControlValue({ topic, value: 0 }, controlTree))
    assert.throws(() => validateControlValue({ topic, value: -1 }, controlTree))
    assert.throws(() => validateControlValue({ topic, value: '1x' }, controlTree))
  }
  assert.throws(() => validateControlValue({ topic: 'pid_cycle_time', value: 2.5 }, controlTree), /整数/)
  assert.throws(() => validateControlValue({ topic: 'pid_cycle_time', value: 5 }, controlTree), /之和/)
  assert.throws(() => validateControlValue({ topic: 'temperature_control_strategy', value: 'invalid' }, controlTree))
})

test('策略过滤仅影响显示，旧名称与规范名称同时存在时展示规范参数', () => {
  const tree = [{ topic: 'master', children: [
    { topic: 'temperature_control_strategy', value: 'pid' },
    { topic: 'temperature_hysteresis', value: 0.5 },
    { topic: 'pid_kp', value: 10 },
    { topic: 'pid_min_open_time', value: 5 },
    { topic: 'pid_min_on_time', value: 3 },
  ] }]
  assert.deepEqual(filterControlTree(tree)[0].children.map(row => row.topic), ['temperature_control_strategy', 'pid_kp', 'pid_min_on_time'])
  assert.equal(tree[0].children.length, 5)
  tree[0].children[0].value = 'hysteresis'
  assert.deepEqual(filterControlTree(tree)[0].children.map(row => row.topic), ['temperature_control_strategy', 'temperature_hysteresis'])
})

test('validateControlValue rejects non-positive values and unsafe temperature relationships', () => {
  assert.throws(
    () => validateControlValue(
      { topic: 'data_timeout', t_name: '数据更新超时时间（秒）', value: 0, min: null, max: null },
      controlTree,
    ),
    /必须是大于0的数字/,
  )
  assert.throws(
    () => validateControlValue(
      { topic: 'max_safe_temperature', t_name: '最高安全温度', value: 35, min: null, max: null },
      controlTree,
    ),
    /必须大于目标温度/,
  )
})
