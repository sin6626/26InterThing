import test from 'node:test'
import assert from 'node:assert/strict'

import { validateControlValue } from '../src/utils/controlValidation.js'

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
