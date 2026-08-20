const DEFAULT_COMMAND_TIMEOUT_SECONDS = 2

const resolveCommandTimeoutSeconds = (configRows, fallback = DEFAULT_COMMAND_TIMEOUT_SECONDS) => {
  const configuredValue = configRows?.find((row) => row.topic === "command_timeout")?.value
  const timeoutSeconds = Number.parseFloat(configuredValue)
  return Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : fallback
}

const waitForPublish = (publishPromise, timeoutSeconds = DEFAULT_COMMAND_TIMEOUT_SECONDS) => {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`MQTT发布超时(${timeoutSeconds}s)`)),
      Math.max(1, timeoutSeconds * 1000),
    )
  })
  return Promise.race([Promise.resolve(publishPromise), timeoutPromise])
    .finally(() => clearTimeout(timeoutId))
}

module.exports = {
  DEFAULT_COMMAND_TIMEOUT_SECONDS,
  resolveCommandTimeoutSeconds,
  waitForPublish,
}
