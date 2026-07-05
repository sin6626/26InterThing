const test = require('node:test')
const assert = require('node:assert/strict')

const { buildSensorChartSql } = require('../utils/sensorChartSql')

test('buildSensorChartSql does not filter by online status', () => {
  const sql = buildSensorChartSql({
    tableprefix: 't_sensor',
    fieldAggSql: 'round(avg(field1), 2) as field1',
    timeSql: '',
  })

  assert.match(sql, /where\s+d_no\s*=\s*\?/i)
  assert.doesNotMatch(sql, /and\s+online\s*=\s*/i)
})

test('buildSensorChartSql groups only by minute_time', () => {
  const sql = buildSensorChartSql({
    tableprefix: 't_sensor',
    fieldAggSql: 'round(avg(field1), 2) as field1',
    timeSql: 'and c_time >= ?',
  })

  assert.match(sql, /group\s+by\s+minute_time/i)
  assert.doesNotMatch(sql, /group\s+by[\s\S]*online/i)
})

test('buildSensorChartSql keeps time condition and does not select online column', () => {
  const sql = buildSensorChartSql({
    tableprefix: 't_sensor',
    fieldAggSql: 'round(avg(field1), 2) as field1',
    timeSql: 'and c_time >= ? and c_time <= ?',
  })

  assert.match(sql, /and\s+c_time\s*>=\s*\?\s+and\s+c_time\s*<=\s*\?/i)
  assert.doesNotMatch(sql, /\bonline\b\s*(,|\n|\r)/i)
})
