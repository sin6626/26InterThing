// 这个文件定义“应用层内部配置值”如何翻译成“设备侧真正认识的 JSON 字段”。
// 例如前端看到 airPower，设备端真正想收的是 { "kong": "50" }。
const toOnOff = (value) => {
  return String(value).toLowerCase() === "on" ? "on" : "off"
}

const toAirMode = (value) => {
  const text = String(value || "").trim().toLowerCase()
  if (text === "heat" || text === "制热") return "heat"
  if (text === "cold" || text === "制冷") return "cold"
  if (text === "off" || text === "关闭") return "off"
  return "off"
}

const toAirSwitchMode = (value) => {
  return toOnOff(value) === "on" ? "heat" : "off"
}

/**
 * 将输入值转换为电机控制指令
 * @param {any} value - 输入值，可以是任意类型
 * @returns {string} 返回电机控制指令，"z"、"f"或"off"
 */
const toMotor = (value) => {
  const text = String(value || "").toLowerCase() // 将输入值转换为小写字符串，如果输入为null或undefined则转为空字符串
  if (text === "z" || text === "f" || text === "off") return text // 如果输入值为"z"、"f"或"off"，则直接返回
  return "off" // 其他情况默认返回"off"
}

/**
 * 将值转换为命令字符串格式
 * @param {any} value - 需要转换的值
 * @returns {string} 转换后的字符串，如果值为null或undefined则返回空字符串
 */
const toCommandString = (value) => {
  if (value == null) return "" // 检查值是否为null或undefined，如果是则返回空字符串
  return String(value) // 将值转换为字符串类型并返回
}

// 优先按 topic 做映射。
// 这是现在最常见的路径，因为数据库里通常会把 topic 配好。
const mapByTopic = (topic, value) => {
  const normalizedTopic = String(topic || "").trim().toLowerCase()
  switch (normalizedTopic) {
    case "master":
    case "mode":
      return { value: toOnOff(value) }
    case "airswitch":
      return { "air mode": toAirSwitchMode(value) }
    case "airmode":
      return { "air mode": toAirMode(value) }
    case "airpower":
      return { kong: toCommandString(value) }
    case "fanpower":
      return { fan: toCommandString(value) }
    case "lightpower":
      return { led: toCommandString(value) }
    case "light":
      return { light_thresh: toCommandString(value) }
    case "motor":
      return { motor: toMotor(value) }
    case "temperature":
      return { TG: toCommandString(value) }
    case "temperaturelower":
      return { temp_low: toCommandString(value) }
    case "directupper":
      return { temp_high: toCommandString(value) }
    case "lightthresh":
      return { light_thresh: toCommandString(value) }
    case "tg":
      return { TG: toCommandString(value) }
    case "tbegin":
    case "begintime":
      return { begintime: toCommandString(value) }
    case "tend":
    case "endtime":
      return { endtime: toCommandString(value) }
    default:
      return null
  }
}

// 某些老数据或特殊场景下，config_id 也可以作为兜底映射依据。
const mapByConfigId = (configId, value) => {
  const id = Number(configId)
  switch (id) {
    case 0:
    case 13:
      return { value: toOnOff(value) }
    case 1:
      return { "air mode": toAirSwitchMode(value) }
    case 4:
      return { fan: toCommandString(value) }
    case 5:
      return { "air mode": toAirMode(value) }
    case 6:
      return { kong: toCommandString(value) }
    case 11:
      return { led: toCommandString(value) }
    case 9:
      return { temp_low: toCommandString(value) }
    case 10:
      return { temp_high: toCommandString(value) }
    default:
      return null
  }
}

const buildDeviceCommandPayload = ({ d_no, config_id, topic, value }) => {
  // 优先级：
  // 1. topic 命中
  // 2. config_id 命中
  // 3. 都没命中时退回成 { value }
  const payload = mapByTopic(topic, value) || mapByConfigId(config_id, value) || { value }
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
