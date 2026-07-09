import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyMinuteRealtimeUpdate,
  resolveRealtimeValues,
} from '../src/composables/useMinuteSeries.js'

function freshState() {
  return { xAxisData: [], seriesData: [], minuteStats: {} }
}

describe('applyMinuteRealtimeUpdate', () => {
  it('appends a new minute key', () => {
    const state = freshState()
    applyMinuteRealtimeUpdate(state, {
      minuteKey: '14:30',
      valuesBySeriesName: { temp: 25 },
    })
    assert.deepEqual(state.xAxisData, ['14:30'])
    assert.equal(state.seriesData[0].data[0], 25)
  })

  it('averages values for same minute key (no duplicate point)', () => {
    const state = freshState()
    applyMinuteRealtimeUpdate(state, {
      minuteKey: '14:30',
      valuesBySeriesName: { temp: 20 },
    })
    applyMinuteRealtimeUpdate(state, {
      minuteKey: '14:30',
      valuesBySeriesName: { temp: 30 },
    })
    assert.deepEqual(state.xAxisData, ['14:30'])
    assert.equal(state.seriesData[0].data[0], 25) // (20+30)/2
    assert.equal(state.seriesData[0].data.length, 1)
  })

  it('discards stale packets (minuteKey < last key)', () => {
    const state = freshState()
    applyMinuteRealtimeUpdate(state, {
      minuteKey: '14:31',
      valuesBySeriesName: { temp: 10 },
    })
    applyMinuteRealtimeUpdate(state, {
      minuteKey: '14:30',
      valuesBySeriesName: { temp: 99 },
    })
    assert.deepEqual(state.xAxisData, ['14:31'])
    assert.equal(state.seriesData[0].data[0], 10)
  })

  it('trims to rolling window limit', () => {
    const state = freshState()
    for (let m = 0; m < 65; m++) {
      const h = String(Math.floor(m / 60) + 14).padStart(2, '0')
      const mi = String(m % 60).padStart(2, '0')
      applyMinuteRealtimeUpdate(state, {
        minuteKey: `${h}:${mi}`,
        valuesBySeriesName: { temp: m },
        limit: 60,
      })
    }
    assert.equal(state.xAxisData.length, 60)
    assert.equal(state.xAxisData[0], '14:05') // first 5 trimmed
    assert.equal(state.seriesData[0].data.length, 60)
  })

  it('handles multiple series names', () => {
    const state = freshState()
    applyMinuteRealtimeUpdate(state, {
      minuteKey: '10:00',
      valuesBySeriesName: { temp: 20, humidity: 50 },
    })
    assert.equal(state.seriesData.length, 2)
    assert.equal(state.seriesData.find((s) => s.name === 'temp').data[0], 20)
    assert.equal(state.seriesData.find((s) => s.name === 'humidity').data[0], 50)
  })
})

describe('resolveRealtimeValues', () => {
  it('maps MQTT payload names to display and database field names', () => {
    const metadata = [
      { f_name: '温度', db_name: 'field1', p_name: 'temp' },
      { f_name: '流量', db_name: 'field2', p_name: 'flow' },
      { f_name: '压力', db_name: 'field3', p_name: 'pressurre' },
    ]

    const values = resolveRealtimeValues(
      { temp: 32.5, flow: 18.6, pressurre: 12.4 },
      metadata,
    )

    assert.deepEqual(values.displayValues, { 温度: 32.5, 流量: 18.6, 压力: 12.4 })
    assert.deepEqual(values.databaseValues, { field1: 32.5, field2: 18.6, field3: 12.4 })
  })

  it('preserves zero and reports missing chart values as null', () => {
    const metadata = [
      { f_name: '温度', db_name: 'field1', p_name: 'temp' },
      { f_name: '流量', db_name: 'field2', p_name: 'flow' },
    ]

    const values = resolveRealtimeValues({ temp: 0 }, metadata)

    assert.deepEqual(values.displayValues, { 温度: 0 })
    assert.deepEqual(values.databaseValues, { field1: 0, field2: null })
  })
})
