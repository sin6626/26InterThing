import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createLifecycleTracker, onWsLifecycle, _emitLifecycle } from '../src/utils/wsRealtime.js'

describe('createLifecycleTracker', () => {
  it('emits "connected" on first onOpen', () => {
    const events = []
    const tracker = createLifecycleTracker((e) => events.push(e))
    tracker.onOpen()
    assert.deepEqual(events, ['connected'])
  })

  it('emits "reconnected" on every subsequent onOpen', () => {
    const events = []
    const tracker = createLifecycleTracker((e) => events.push(e))
    tracker.onOpen()
    tracker.onOpen()
    tracker.onOpen()
    assert.deepEqual(events, ['connected', 'reconnected', 'reconnected'])
  })

  it('tracks hasOpened state independently per tracker', () => {
    const a = []
    const b = []
    const trackerA = createLifecycleTracker((e) => a.push(e))
    const trackerB = createLifecycleTracker((e) => b.push(e))
    trackerA.onOpen()
    trackerB.onOpen()
    trackerA.onOpen()
    assert.deepEqual(a, ['connected', 'reconnected'])
    assert.deepEqual(b, ['connected'])
  })
})

describe('onWsLifecycle', () => {
  it('returns an unsubscribe function', () => {
    const unsub = onWsLifecycle(() => {})
    assert.equal(typeof unsub, 'function')
    unsub()
  })

  it('unsubscribed callback no longer receives events', () => {
    const events = []
    const unsub = onWsLifecycle((e) => events.push(e))
    _emitLifecycle('connected')
    assert.deepEqual(events, ['connected'])
    unsub()
    _emitLifecycle('reconnected')
    assert.deepEqual(events, ['connected'])
  })
})
