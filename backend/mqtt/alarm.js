const { getVstatusLevel, VSTATUS_TEXT } = require("../constants/vstatus")

// 设备上报的 type 可能是数字、中文描述，或者干脆缺失；
// 这里统一归一成应用层内部使用的状态码。
const normalizeErrorCode = (rawType, messageText = "") => {
  const raw = String(rawType ?? "").trim()
  const num = Number.parseInt(raw, 10)
  if (!Number.isNaN(num)) return num

  if (raw.includes("通信") || messageText.includes("通信") || messageText.includes("断开")) return 2
  if (raw.includes("传感器") || messageText.includes("传感器")) return 3
  if (raw.includes("空调") || messageText.includes("空调") || messageText.includes("压缩机")) return 4
  if (raw.includes("风机") || messageText.includes("风机")) return 5
  if (raw.includes("断电") || messageText.includes("断电")) return 6
  if (raw.includes("气体") || raw.includes("湿度") || messageText.includes("气体") || messageText.includes("湿度")) return 7
  return 1
}

module.exports = {
  VSTATUS_TEXT,
  // 告警等级与 vstatus 等级沿用同一套分级规则。
  getAlarmLevel: getVstatusLevel,
  normalizeErrorCode,
}
