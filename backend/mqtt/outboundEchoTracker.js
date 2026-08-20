const trackedMessages = new Map()
const DEFAULT_TTL_MS = 5_000

const makeKey = (topic, payloadText) => `${topic}\u0000${payloadText}`

const pruneExpired = (now = Date.now()) => {
  for (const [key, entry] of trackedMessages) {
    if (entry.expiresAt <= now) trackedMessages.delete(key)
  }
}

const track = (topic, payloadText, ttlMs = DEFAULT_TTL_MS) => {
  const now = Date.now()
  pruneExpired(now)
  const key = makeKey(topic, payloadText)
  const current = trackedMessages.get(key)
  trackedMessages.set(key, {
    count: (current?.count || 0) + 1,
    expiresAt: now + ttlMs,
  })
}

const consumeIfTracked = (topic, payloadText) => {
  pruneExpired()
  const key = makeKey(topic, payloadText)
  const current = trackedMessages.get(key)
  if (!current) return false
  if (current.count <= 1) trackedMessages.delete(key)
  else trackedMessages.set(key, { ...current, count: current.count - 1 })
  return true
}

const reset = () => trackedMessages.clear()

module.exports = {
  consumeIfTracked,
  reset,
  track,
}
