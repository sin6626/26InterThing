const { getVstatusLevel, VSTATUS_TEXT } = require("../constants/vstatus")

// 设备上报的 type 可能是数字、字符串代码或中文；
// 这里统一归一成应用层内部使用的状态码。
const normalizeErrorCode = (rawType, messageText = "") => {
  const raw = String(rawType ?? "").trim()
  const num = Number.parseInt(raw, 10)
  if (!Number.isNaN(num)) return num

  // 通用常见错误类型归一化
  if (raw.includes("通信") || messageText.includes("通信") || messageText.includes("断开")) return 2
  if (raw.includes("传感器") || messageText.includes("传感器")) return 3
  if (raw.includes("保护") || messageText.includes("保护") || messageText.includes("超限") || messageText.includes("超时")) return 6
  return 1
}

module.exports = {
  VSTATUS_TEXT,
  getAlarmLevel: getVstatusLevel,
  normalizeErrorCode,
}

