const toCommandString = (value) => {
  if (value == null) return ""
  return String(value)
}

const buildDeviceCommandPayload = ({ d_no, config_id, topic, value }) => {
  const payload = { value: toCommandString(value) }
  if (!d_no) return payload

  return {
    d_no,
    ...(config_id !== undefined ? { config_id } : {}),
    ...(topic ? { topic } : {}),
    ...payload,
  }
}

module.exports = {
  buildDeviceCommandPayload,
}
