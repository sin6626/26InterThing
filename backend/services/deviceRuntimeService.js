const fs = require("node:fs")
const path = require("node:path")

const DEFAULT_DATA_TIMEOUT_SECONDS = 3
const SAVE_INTERVAL_MS = 5000

let broadcastDep = null
let configLoaderDep = null
let historyLoggerDep = null
let customDataFilePath = null

const deviceRuntimeMap = new Map()

const getDataFilePath = () => {
  if (customDataFilePath) return customDataFilePath
  return path.join(__dirname, "../data/runtime_stats.json")
}

const ensureDataDir = (filePath) => {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 格式化累计秒数为友好的中文字符串
 * 例如: 3665s -> "1小时1分5秒", 125s -> "2分5秒", 45s -> "45秒", 0s -> "0秒"
 */
const formatSeconds = (totalSeconds) => {
  const s = Math.max(0, Math.floor(totalSeconds || 0))
  if (s === 0) return "0秒"

  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60

  const parts = []
  if (hours > 0) parts.push(`${hours}小时`)
  if (minutes > 0) parts.push(`${minutes}分`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`)

  return parts.join("")
}

const getOrCreateState = (dNo) => {
  if (!deviceRuntimeMap.has(dNo)) {
    deviceRuntimeMap.set(dNo, {
      dNo,
      pumpRuntimeSeconds: 0.0,
      heaterRuntimeSeconds: 0.0,
      lastCalcTime: 0,
      lastSaveTime: 0,
      lastPumpState: false,
      lastHeaterState: false,
    })
  }
  return deviceRuntimeMap.get(dNo)
}

/**
 * 本地文件读取持久化数据
 */
const loadAllFromLocalFile = () => {
  const filePath = getDataFilePath()
  try {
    if (!fs.existsSync(filePath)) return
    const content = fs.readFileSync(filePath, "utf-8")
    if (!content.trim()) return
    const data = JSON.parse(content)
    if (data && typeof data === "object") {
      for (const [dNo, stats] of Object.entries(data)) {
        if (!dNo || typeof stats !== "object") continue
        const state = getOrCreateState(dNo)
        state.pumpRuntimeSeconds = Number.isFinite(Number(stats.pumpRuntimeSeconds))
          ? Number(stats.pumpRuntimeSeconds)
          : 0.0
        state.heaterRuntimeSeconds = Number.isFinite(Number(stats.heaterRuntimeSeconds))
          ? Number(stats.heaterRuntimeSeconds)
          : 0.0
      }
    }
  } catch (err) {
    console.error("[DeviceRuntime] 从本地文件载入累计时长失败:", err.message)
  }
}

/**
 * 本地文件保存持久化数据
 */
const persistAllToLocalFile = (force = false) => {
  const filePath = getDataFilePath()
  try {
    ensureDataDir(filePath)
    const exportObj = {}
    for (const [dNo, state] of deviceRuntimeMap.entries()) {
      exportObj[dNo] = {
        pumpRuntimeSeconds: Number(state.pumpRuntimeSeconds.toFixed(1)),
        heaterRuntimeSeconds: Number(state.heaterRuntimeSeconds.toFixed(1)),
        lastSaveTime: Date.now(),
      }
    }
    fs.writeFileSync(filePath, JSON.stringify(exportObj, null, 2), "utf-8")
  } catch (err) {
    console.error("[DeviceRuntime] 持久化累计时长到本地文件失败:", err.message)
  }
}

/**
 * 获取设备超时配置（秒）
 */
const getDataTimeoutSeconds = async (dNo) => {
  if (typeof configLoaderDep === "function") {
    const rows = await configLoaderDep(dNo)
    const row = rows?.find((item) => item.topic === "data_timeout")
    const val = Number.parseFloat(row?.value)
    return Number.isFinite(val) && val > 0 ? val : DEFAULT_DATA_TIMEOUT_SECONDS
  }
  try {
    const directRepository = require("../repositories/directRepository")
    const configRows = await directRepository.getDeviceConfigRows(dNo)
    const row = configRows.find((item) => item.topic === "data_timeout")
    const val = Number.parseFloat(row?.value)
    return Number.isFinite(val) && val > 0 ? val : DEFAULT_DATA_TIMEOUT_SECONDS
  } catch {
    return DEFAULT_DATA_TIMEOUT_SECONDS
  }
}

const getBroadcast = () => {
  if (broadcastDep) return broadcastDep
  try {
    const { broadcastToClients } = require("../websocket")
    return broadcastToClients
  } catch {
    return null
  }
}

/**
 * 核心方法：处理入站传感器数据并执行运行时长累加
 * 严格按照用户明确指示：只认报文中的 water_Y2 和 heat_Y1，未带或为0严格按未开启处理
 */
const onSensorRuntimeData = async (dNo, rawData, now = Date.now()) => {
  if (!dNo || !rawData) return null

  const state = getOrCreateState(dNo)

  // 1. 严格判断执行器状态：报文中明确带了 1/"1"/"on" 才算开，其余均算未开启
  const isPumpOn =
    rawData.water_Y2 !== undefined &&
    rawData.water_Y2 !== null &&
    (String(rawData.water_Y2) === "1" || String(rawData.water_Y2).toLowerCase() === "on")

  const isHeaterOn =
    rawData.heat_Y1 !== undefined &&
    rawData.heat_Y1 !== null &&
    (String(rawData.heat_Y1) === "1" || String(rawData.heat_Y1).toLowerCase() === "on")

  // 2. 防离线/断网虚增与采样间隔计算
  const timeoutSec = await getDataTimeoutSeconds(dNo)
  if (state.lastCalcTime > 0) {
    const dtSec = (now - state.lastCalcTime) / 1000
    // 时间差在有效范围内才进行时间累加，若超过 data_timeout 则视为断网重连，跳过累加
    if (dtSec > 0 && dtSec <= timeoutSec) {
      if (isPumpOn) {
        state.pumpRuntimeSeconds += dtSec
      }
      if (isHeaterOn) {
        state.heaterRuntimeSeconds += dtSec
      }
    }
  }

  state.lastCalcTime = now
  state.lastPumpState = isPumpOn
  state.lastHeaterState = isHeaterOn

  // 3. 定时节流持久化到本地文件
  if (now - state.lastSaveTime >= SAVE_INTERVAL_MS) {
    state.lastSaveTime = now
    persistAllToLocalFile(false)
  }

  const payload = getRuntimeStatus(dNo)

  // 4. WebSocket 广播实时推送
  const broadcast = getBroadcast()
  if (typeof broadcast === "function") {
    broadcast("runtime_realtime", payload)
  }

  return payload
}

/**
 * 查询指定设备的运行时长状态
 */
const getRuntimeStatus = (dNo) => {
  const state = getOrCreateState(dNo)
  const pumpSec = Number(state.pumpRuntimeSeconds.toFixed(1))
  const heaterSec = Number(state.heaterRuntimeSeconds.toFixed(1))

  return {
    d_no: dNo,
    pump_runtime_seconds: pumpSec,
    pump_runtime_formatted: formatSeconds(pumpSec),
    pump_state: state.lastPumpState ? 1 : 0,
    heater_runtime_seconds: heaterSec,
    heater_runtime_formatted: formatSeconds(heaterSec),
    heater_state: state.lastHeaterState ? 1 : 0,
    last_calc_time: state.lastCalcTime,
  }
}

/**
 * 清零累计运行时长
 * @param {string} dNo 设备号
 * @param {'pump'|'heater'|'all'} type 清零类型
 * @param {string} remark 备注
 */
const resetRuntime = async (dNo, type = "all", remark = "用户操作清零") => {
  const state = getOrCreateState(dNo)
  const oldPump = Number(state.pumpRuntimeSeconds.toFixed(1))
  const oldHeater = Number(state.heaterRuntimeSeconds.toFixed(1))

  let directName = "清零累计运行时长"
  let remarkDetail = remark

  if (type === "pump") {
    state.pumpRuntimeSeconds = 0.0
    directName = "清零水泵累计运行时长"
    remarkDetail = `${remark}（原水泵时长: ${formatSeconds(oldPump)} / ${oldPump}秒）`
  } else if (type === "heater") {
    state.heaterRuntimeSeconds = 0.0
    directName = "清零加热累计运行时长"
    remarkDetail = `${remark}（原加热时长: ${formatSeconds(oldHeater)} / ${oldHeater}秒）`
  } else {
    state.pumpRuntimeSeconds = 0.0
    state.heaterRuntimeSeconds = 0.0
    directName = "清零水泵与加热累计运行时长"
    remarkDetail = `${remark}（原水泵: ${formatSeconds(oldPump)}，原加热: ${formatSeconds(oldHeater)}）`
  }

  // 立即保存到本地文件
  persistAllToLocalFile(true)

  // 记录审计操作历史
  try {
    if (typeof historyLoggerDep === "function") {
      await historyLoggerDep({
        d_no: dNo,
        direct_name: directName,
        direct_type: "reset_runtime",
        old_value: JSON.stringify({ pump: oldPump, heater: oldHeater }),
        new_value: "0",
        result: "success",
        remark: remarkDetail,
      })
    } else {
      const directHistoryRepository = require("../repositories/directHistoryRepository")
      await directHistoryRepository.insertDirectHistory({
        d_no: dNo,
        direct_name: directName,
        direct_type: "reset_runtime",
        old_value: JSON.stringify({ pump: oldPump, heater: oldHeater }),
        new_value: "0",
        result: "success",
        remark: remarkDetail,
      })
    }
  } catch (err) {
    console.error("[DeviceRuntime] 记录清零操作历史失败:", err.message)
  }

  const payload = getRuntimeStatus(dNo)

  const broadcast = getBroadcast()
  if (typeof broadcast === "function") {
    broadcast("runtime_realtime", payload)
  }

  return payload
}

const initDeviceRuntime = () => {
  loadAllFromLocalFile()
}

// 测试辅助方法
const __resetForTests = () => {
  deviceRuntimeMap.clear()
  broadcastDep = null
  configLoaderDep = null
  historyLoggerDep = null
  customDataFilePath = null
}

const __setBroadcastForTests = (b) => { broadcastDep = b }
const __setConfigLoaderForTests = (c) => { configLoaderDep = c }
const __setHistoryLoggerForTests = (h) => { historyLoggerDep = h }
const __setDataFilePathForTests = (p) => { customDataFilePath = p }

module.exports = {
  formatSeconds,
  getOrCreateState,
  getRuntimeStatus,
  initDeviceRuntime,
  loadAllFromLocalFile,
  onSensorRuntimeData,
  persistAllToLocalFile,
  resetRuntime,
  __resetForTests,
  __setBroadcastForTests,
  __setConfigLoaderForTests,
  __setDataFilePathForTests,
  __setHistoryLoggerForTests,
}
