/**
 * 设备在线/离线活跃度管理服务 (devicePresenceService)
 *
 * 核心逻辑：
 * 1. 只要收到设备端往 device/sensor 发送的数据，即判定该设备在线 (online)，记录最新活跃时间。
 * 2. 若超过配置的超时时间（通过指令页面配置的 device_offline_timeout，默认 5 秒）未收到新数据，
 *    则判定该设备离线 (offline)。
 * 3. 状态变化时通过 WebSocket 广播 device_status，驱动前端顶部状态栏与各页面实时同步。
 */

let broadcastDep = null
let configLoaderDep = null
let nowProvider = () => Date.now()

// 设备活跃记录：Map<dNo, { lastSeen: number, status: 'online' | 'offline', updatedAt: string }>
const presenceMap = new Map()

// 超时时间缓存：Map<dNo, { timeout: number, cachedAt: number }>
const timeoutCache = new Map()

const DEFAULT_OFFLINE_TIMEOUT = 5 // 默认 5 秒

const nowTimeString = (ts = nowProvider()) => {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const getBroadcast = () => {
  if (broadcastDep) return broadcastDep
  try {
    return require("../websocket").broadcastToClients
  } catch {
    return null
  }
}

let waterControlEngineDep = null

const getWaterControlEngine = () => {
  if (waterControlEngineDep) return waterControlEngineDep
  try {
    const enginePath = require.resolve("./waterControlEngine")
    if (require.cache && require.cache[enginePath]) {
      return require("./waterControlEngine")
    }
  } catch {}
  return null
}

/**
 * 动态获取指定设备的离线超时配置（秒），默认 5 秒
 * 优先使用 2 秒短时内存缓存兼顾高频判断吞吐与页面修改即时生效
 */
const getOfflineTimeoutSeconds = async (dNo) => {
  const now = nowProvider()
  const cached = timeoutCache.get(dNo)
  if (cached && now - cached.cachedAt < 2000) {
    return cached.timeout
  }

  let timeout = DEFAULT_OFFLINE_TIMEOUT
  if (process.env.NODE_ENV === "test" && typeof configLoaderDep !== "function") {
    timeoutCache.set(dNo, { timeout, cachedAt: now })
    return timeout
  }

  try {
    let rows = []
    if (typeof configLoaderDep === "function") {
      rows = await configLoaderDep(dNo)
    } else {
      const directRepository = require("../repositories/directRepository")
      rows = await directRepository.getDeviceConfigRows(dNo)
    }
    const row = rows?.find((r) => r.topic === "device_offline_timeout")
    if (row && row.value !== null && row.value !== undefined && String(row.value).trim() !== "") {
      const parsed = parseFloat(row.value)
      if (Number.isFinite(parsed) && parsed > 0) {
        timeout = parsed
      }
    }
  } catch {
    // 数据库查询异常时回退默认值
  }

  timeoutCache.set(dNo, { timeout, cachedAt: now })
  return timeout
}

/**
 * 同步获取缓存中的离线超时时间，若无缓存返回默认 5 秒
 */
const getOfflineTimeoutSecondsSync = (dNo) => {
  const cached = timeoutCache.get(dNo)
  return cached ? cached.timeout : DEFAULT_OFFLINE_TIMEOUT
}

/**
 * 构建并广播设备在线状态
 */
const broadcastDeviceStatus = (dNo, status, updatedAt) => {
  const broadcast = getBroadcast()
  if (typeof broadcast !== "function") return

  const waterControlEngine = getWaterControlEngine()
  let control = null
  let level = status === "online" ? "normal" : "unknown"
  let text = status === "online" ? "在线" : "离线"

  if (waterControlEngine) {
    control = waterControlEngine.getDeviceControlStatus(dNo)
    if (control?.fsmState === "FAULT") {
      level = "error"
      text = control.faultReason || "设备故障"
    }
  }

  broadcast("device_status", {
    d_no: dNo,
    status,
    vstatus: null,
    level,
    text,
    updated_at: updatedAt,
    control,
  })
}

/**
 * 当收到 device/sensor 主题数据时调用，记录活跃并标记在线
 */
const recordDeviceActivity = async (dNo) => {
  if (!dNo) return
  const now = nowProvider()
  const timeStr = nowTimeString(now)
  const previous = presenceMap.get(dNo)
  const wasOffline = !previous || previous.status !== "online"

  presenceMap.set(dNo, {
    lastSeen: now,
    status: "online",
    updatedAt: timeStr,
  })

  // 若此前未记录或为离线状态，立即切换为在线并广播
  if (wasOffline) {
    broadcastDeviceStatus(dNo, "online", timeStr)
  }
}

/**
 * 获取设备当前在线状态（异步，带超时配置最新检查）
 */
const getDevicePresence = async (dNo) => {
  if (!dNo) return { status: "offline", text: "离线", updated_at: null }
  const record = presenceMap.get(dNo)
  if (!record || !record.lastSeen) {
    return { status: "offline", text: "离线", updated_at: null }
  }

  const timeoutSeconds = await getOfflineTimeoutSeconds(dNo)
  const timeoutMs = timeoutSeconds * 1000
  const now = nowProvider()

  if (now - record.lastSeen > timeoutMs) {
    record.status = "offline"
    return { status: "offline", text: "离线", updated_at: record.updatedAt }
  }

  return { status: "online", text: "在线", updated_at: record.updatedAt }
}

/**
 * 同步快速获取当前在线状态
 */
const getDevicePresenceSync = (dNo) => {
  if (!dNo) return { status: "offline", text: "离线", updated_at: null }
  const record = presenceMap.get(dNo)
  if (!record || !record.lastSeen) {
    return { status: "offline", text: "离线", updated_at: null }
  }

  const timeoutMs = getOfflineTimeoutSecondsSync(dNo) * 1000
  const now = nowProvider()

  if (now - record.lastSeen > timeoutMs) {
    record.status = "offline"
    return { status: "offline", text: "离线", updated_at: record.updatedAt }
  }

  return { status: "online", text: "在线", updated_at: record.updatedAt }
}

/**
 * 周期性巡检离线设备
 */
const checkOfflineDevices = async () => {
  const now = nowProvider()

  for (const [dNo, record] of presenceMap.entries()) {
    if (record.status === "online") {
      const timeoutSeconds = await getOfflineTimeoutSeconds(dNo)
      const timeoutMs = timeoutSeconds * 1000
      if (now - record.lastSeen > timeoutMs) {
        record.status = "offline"
        record.updatedAt = nowTimeString(now)
        broadcastDeviceStatus(dNo, "offline", record.updatedAt)
      }
    }
  }
}

// 巡检定时器
let checkTimer = null

const startPresenceChecker = (intervalMs = 1000) => {
  if (checkTimer) return
  checkTimer = setInterval(() => {
    checkOfflineDevices().catch((err) => {
      console.error("[DevicePresence] 巡检异常:", err.message)
    })
  }, intervalMs)
  if (checkTimer.unref) checkTimer.unref()
}

const stopPresenceChecker = () => {
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = null
  }
}

// 非测试环境默认启动巡检器
if (process.env.NODE_ENV !== "test") {
  startPresenceChecker(1000)
}

/**
 * 测试辅助注入
 */
const __resetForTests = () => {
  presenceMap.clear()
  timeoutCache.clear()
  broadcastDep = null
  configLoaderDep = null
  waterControlEngineDep = null
  nowProvider = () => Date.now()
  stopPresenceChecker()
}

const __setNowProviderForTests = (fn) => {
  nowProvider = fn
}

const __setBroadcastForTests = (fn) => {
  broadcastDep = fn
}

const __setConfigLoaderForTests = (fn) => {
  configLoaderDep = fn
}

const __setWaterControlEngineForTests = (engine) => {
  waterControlEngineDep = engine
}

module.exports = {
  recordDeviceActivity,
  getDevicePresence,
  getDevicePresenceSync,
  checkOfflineDevices,
  startPresenceChecker,
  stopPresenceChecker,
  getOfflineTimeoutSeconds,
  DEFAULT_OFFLINE_TIMEOUT,
  __resetForTests,
  __setNowProviderForTests,
  __setBroadcastForTests,
  __setConfigLoaderForTests,
  __setWaterControlEngineForTests,
}
