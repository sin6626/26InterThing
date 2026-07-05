import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatMinuteAxisLabel, createMinuteTimeAxis } from '../src/utils/chartTimeAxis.js'

describe('formatMinuteAxisLabel', () => {
  it('returns HH:mm for same day', () => {
    const now = new Date(2026, 4, 12, 14, 30)
    const value = new Date(2026, 4, 12, 9, 5).getTime()
    assert.equal(formatMinuteAxisLabel(value, now), '09:05')
  })

  it('returns MM-DD HH:mm for different day', () => {
    const now = new Date(2026, 4, 12, 14, 30)
    const value = new Date(2026, 4, 11, 23, 59).getTime()
    assert.equal(formatMinuteAxisLabel(value, now), '05-11 23:59')
  })

  it('handles year boundary cross', () => {
    const now = new Date(2026, 0, 1, 0, 0)
    const value = new Date(2025, 11, 31, 23, 59).getTime()
    assert.equal(formatMinuteAxisLabel(value, now), '12-31 23:59')
  })
})

describe('createMinuteTimeAxis', () => {
  it('returns type category', () => {
    const axis = createMinuteTimeAxis(['14:30', '14:31', '14:32'])
    assert.equal(axis.type, 'category')
  })

  it('sets data from xAxisData', () => {
    const categories = ['14:30', '14:31', '14:32']
    const axis = createMinuteTimeAxis(categories)
    assert.deepEqual(axis.data, categories)
  })

  it('enables hideOverlap', () => {
    const axis = createMinuteTimeAxis([])
    assert.equal(axis.axisLabel.hideOverlap, true)
  })

  it('has a formatter function', () => {
    const axis = createMinuteTimeAxis([])
    assert.equal(typeof axis.axisLabel.formatter, 'function')
  })
})
