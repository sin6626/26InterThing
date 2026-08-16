const LEGACY_DIRECT_TOPIC = "device/direct"
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

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

const parseJsonObject = (value, fieldName) => {
  if (!value) return null
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      throw new Error(`${fieldName} 不能是数组`)
    }
    return value
  }

  try {
    const parsed = JSON.parse(value)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error(`${fieldName} 必须是 JSON 对象`)
    }
    return parsed
  } catch (error) {
    throw new Error(`${fieldName} 不是合法 JSON: ${error.message}`)
  }
}

const resolveMappedValue = (value, valueMap) => {
  const mapping = parseJsonObject(valueMap, "value_map")
  if (!mapping) return value

  const directKey = String(value)
  if (Object.prototype.hasOwnProperty.call(mapping, directKey)) {
    return mapping[directKey]
  }

  return value
}

const resolveTemplateValue = (template, context) => {
  if (typeof template === "string") {
    const exactMatch = template.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/)
    if (exactMatch) {
      return context[exactMatch[1]]
    }

    return template.replace(PLACEHOLDER_RE, (_, key) => {
      const value = context[key]
      return value == null ? "" : String(value)
    })
  }

  if (Array.isArray(template)) {
    return template.map((item) => resolveTemplateValue(item, context))
  }

  if (template && typeof template === "object") {
    return Object.fromEntries(
      Object.entries(template).map(([key, value]) => [key, resolveTemplateValue(value, context)]),
    )
  }

  return template
}

const buildDeviceCommandEnvelope = ({ d_no, config_id, topic, publish_topic, payload_template, value_map, value }) => {
  const mappedValue = resolveMappedValue(value, value_map)
  const mqttTopic = String(publish_topic || LEGACY_DIRECT_TOPIC).trim() || LEGACY_DIRECT_TOPIC

  if (!payload_template) {
    return {
      topic: mqttTopic,
      payload: buildDeviceCommandPayload({
        d_no,
        config_id,
        topic,
        value,
      }),
    }
  }

  const template = parseJsonObject(payload_template, "payload_template")
  const payload = resolveTemplateValue(template, {
    d_no,
    config_id,
    topic,
    value: toCommandString(value),
    mapped_value: mappedValue,
    command_value: mappedValue,
    publish_topic: mqttTopic,
  })

  return {
    topic: mqttTopic,
    payload,
  }
}

module.exports = {
  buildDeviceCommandEnvelope,
  buildDeviceCommandPayload,
}
