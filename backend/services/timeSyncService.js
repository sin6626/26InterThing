const dayjs = require("dayjs")

// 时间同步服务分成两类场景：
// 1. 手动更新时间：允许页面带一个明确时间过来
// 2. 被动补时（上电 / 重连）：直接使用应用层本机当前时间

const TIME_ONLY_PATTERN = /^\d{2}:\d{2}:\d{2}$/
const DATE_ONLY_PATTERN = /^\d{2}\.\d{2}\.\d{2}$/
const FULL_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/

const formatNowPayload = (date) => ({
  nowTime: date.format("HH:mm:ss"),
  nowdate: date.format("YY.MM.DD"),
})

const normalizeProviderPayload = (nowProvider) => {
  // nowProvider 默认返回当前系统时间；
  // 测试里也可以注入一个固定时间，方便断言。
  const provided = nowProvider()

  if (provided && typeof provided === "object") {
    return {
      nowTime: String(provided.nowTime || ""),
      nowdate: String(provided.nowdate || ""),
    }
  }

  const parsed = dayjs(provided)
  if (parsed.isValid()) {
    return formatNowPayload(parsed)
  }

  return {
    nowTime: String(provided || ""),
    nowdate: "",
  }
}

const normalizeManualTimePayload = (input, nowProvider) => {
  // 手动更新时间允许页面传多种形式：
  // - 完整 datetime
  // - 只传时间
  // - 已经拆好的 { nowTime, nowdate }
  const fallback = normalizeProviderPayload(nowProvider)

  if (!input) {
    return fallback
  }

  if (typeof input === "object") {
    return {
      nowTime: String(input.nowTime || fallback.nowTime),
      nowdate: String(input.nowdate || fallback.nowdate),
    }
  }

  const raw = String(input).trim()
  if (!raw) {
    return fallback
  }

  if (TIME_ONLY_PATTERN.test(raw)) {
    return {
      nowTime: raw,
      nowdate: fallback.nowdate,
    }
  }

  const fullMatch = raw.match(FULL_TIME_PATTERN)
  if (fullMatch) {
    return {
      nowTime: `${fullMatch[4]}:${fullMatch[5]}:${fullMatch[6]}`,
      nowdate: `${fullMatch[1].slice(-2)}.${fullMatch[2]}.${fullMatch[3]}`,
    }
  }

  const parsed = dayjs(raw)
  if (parsed.isValid()) {
    return formatNowPayload(parsed)
  }

  const parts = raw.split(",").map((item) => item.trim()).filter(Boolean)
  if (parts.length === 2) {
    const timePart = parts.find((part) => TIME_ONLY_PATTERN.test(part))
    const datePart = parts.find((part) => DATE_ONLY_PATTERN.test(part))
    if (timePart && datePart) {
      return {
        nowTime: timePart,
        nowdate: datePart,
      }
    }
  }

  return {
    nowTime: raw,
    nowdate: fallback.nowdate,
  }
}

const createTimeSyncService = ({
  mqttClient,
  nowProvider = () => formatNowPayload(dayjs()),
}) => {
  const updateTime = async (time) => {
    // 手动时间同步：优先使用页面明确传来的时间。
    const payload = normalizeManualTimePayload(time, nowProvider)
    await mqttClient.updateTime(payload)
    return payload
  }

  const handleTimeRequest = async (deviceId, _data) => {
    // 被动补时：不相信设备传来的时间，统一用应用层本机系统时间。
    const payload = normalizeProviderPayload(nowProvider)
    await mqttClient.updateDeviceTime(deviceId, payload)
    return payload
  }

  return {
    handleTimeRequest,
    updateTime,
  }
}

module.exports = {
  createTimeSyncService,
}
