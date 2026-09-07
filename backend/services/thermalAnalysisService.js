/**
 * 水循环系统热工效能分析服务 (大纲 4.3 节)
 * 职责：
 * 1. 维护最近滑动时间窗口内的温度采样点（基于配置 temperature_rate_window，默认 60s）；
 * 2. 实时计算两水箱温差（temp_out - temp_in 与有效供热温差 temp_in - temp_out）；
 * 3. 平滑计算各水箱温度变化速度（升温/降温速率，℃/min）；
 * 4. 结合水泵运行状态与循环流量，基于 P = 69.77 * Q * ΔT 计算估算热传递功率（W）；
 * 5. 严格落实安全前置校验：水泵关闭或低流量时不计算热功率并提供状态指示；
 * 6. 通过 WebSocket 广播 thermal_realtime 主题，支持前端仪表盘与双 Y 轴图表联动。
 */

let broadcastDep = null
let configLoaderDep = null

const deviceThermalMap = new Map()

const DEFAULT_RATE_WINDOW_SECONDS = 60
const DEFAULT_MIN_SAFE_FLOW = 0.5
const THERMAL_POWER_FACTOR = 69.77

const getOrCreateState = (dNo) => {
  if (!deviceThermalMap.has(dNo)) {
    deviceThermalMap.set(dNo, {
      dNo,
      historySamples: [], // [{ time, temp_in, temp_out }]
      lastTempIn: null,
      lastTempOut: null,
      lastFlowRate: null,
      lastWaterY2: null,
      lastHeatY1: null,
      tempDiff: 0.0,
      heatTransferTempDiff: 0.0,
      heatingRateIn: 0.0,
      heatingRateOut: 0.0,
      estimatedThermalPower: 0.0,
      powerStatus: "pump_off",
      powerStatusText: "水泵未开启",
      lastCalcTime: 0,
    })
  }
  return deviceThermalMap.get(dNo)
}

const getDeviceConfig = async (dNo) => {
  if (typeof configLoaderDep === "function") {
    return await configLoaderDep(dNo)
  }
  try {
    const directRepository = require("../repositories/directRepository")
    return await directRepository.getDeviceConfigRows(dNo)
  } catch {
    return []
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
 * 格式化数值，保留指定小数位
 */
const roundNumber = (value, decimals = 2) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0.0
  return Number(value.toFixed(decimals))
}

/**
 * 核心方法：处理入站传感器数据并执行热工分析计算
 */
const onSensorThermalData = async (dNo, rawData, now = Date.now()) => {
  if (!dNo || !rawData) return null

  const state = getOrCreateState(dNo)

  // 1. 读取设备配置
  const configs = await getDeviceConfig(dNo)
  const windowRow = configs.find((c) => c.topic === "temperature_rate_window")
  const rateWindowSec = Number.parseFloat(windowRow?.value) || DEFAULT_RATE_WINDOW_SECONDS
  const rateWindowMs = rateWindowSec * 1000

  const minFlowRow = configs.find((c) => c.topic === "min_safe_flow")
  const minSafeFlow = Number.parseFloat(minFlowRow?.value) || DEFAULT_MIN_SAFE_FLOW

  // 2. 提取输入字段
  const rawTempIn = Number.parseFloat(rawData.temp_in)
  const rawTempOut = Number.parseFloat(rawData.temp_out)
  const rawFlowRate = Number.parseFloat(rawData.flow_rate)
  const rawWaterY2 = rawData.water_Y2
  const rawHeatY1 = rawData.heat_Y1

  const hasValidTemp = Number.isFinite(rawTempIn) && Number.isFinite(rawTempOut)
  const hasValidFlow = Number.isFinite(rawFlowRate)

  // 判断水泵开关状态
  let isPumpOn = false
  if (rawWaterY2 !== undefined && rawWaterY2 !== null) {
    isPumpOn = String(rawWaterY2) === "1" || String(rawWaterY2).toLowerCase() === "on"
  } else {
    try {
      const waterControlEngine = require("./waterControlEngine")
      const engineState = waterControlEngine.getOrCreateDeviceState(dNo)
      isPumpOn = engineState.pumpState === "on"
    } catch {
      isPumpOn = false
    }
  }

  // 判断加热器状态
  let isHeaterOn = false
  if (rawHeatY1 !== undefined && rawHeatY1 !== null) {
    isHeaterOn = String(rawHeatY1) === "1" || String(rawHeatY1).toLowerCase() === "on"
  }

  // 3. 若温度无效时的处理
  if (!hasValidTemp) {
    state.lastCalcTime = now
    state.powerStatus = "invalid_temp"
    state.powerStatusText = "温度数据无效"
    state.estimatedThermalPower = 0.0
    return formatStatusPayload(state, now)
  }

  state.lastTempIn = rawTempIn
  state.lastTempOut = rawTempOut
  state.lastFlowRate = hasValidFlow ? Math.max(0, rawFlowRate) : 0.0
  state.lastWaterY2 = isPumpOn ? 1 : 0
  state.lastHeatY1 = isHeaterOn ? 1 : 0

  // 4. 滑动窗口维护与升降温速率计算
  state.historySamples.push({ time: now, temp_in: rawTempIn, temp_out: rawTempOut })
  // 仅保留 (窗口时间 + 15 秒) 内部的历史样本，防止内存无界增长
  state.historySamples = state.historySamples.filter((s) => now - s.time <= rateWindowMs + 15000)

  // 计算温度变化速度（℃/min）：寻找时间差最接近窗口的基准样本
  let rateIn = 0.0
  let rateOut = 0.0
  if (state.historySamples.length >= 2) {
    const oldest = state.historySamples[0]
    const dtSec = (now - oldest.time) / 1000
    // 样本时间跨度达到 5 秒以上才计算斜率，避免除以微小时间放大采样噪声
    if (dtSec >= 5) {
      const dtMin = dtSec / 60
      rateIn = (rawTempIn - oldest.temp_in) / dtMin
      rateOut = (rawTempOut - oldest.temp_out) / dtMin
    }
  }
  state.heatingRateIn = roundNumber(rateIn, 2)
  state.heatingRateOut = roundNumber(rateOut, 2)

  // 5. 温差计算
  // 两水箱温差：temp_out - temp_in (℃)
  state.tempDiff = roundNumber(rawTempOut - rawTempIn, 2)
  // 水箱A到水箱B的有效供热温差：temp_in - temp_out (℃)
  const heatTransferDiff = rawTempIn - rawTempOut
  state.heatTransferTempDiff = roundNumber(heatTransferDiff, 2)

  // 6. 循环水估算热传递功率计算 (P = 69.77 * Q * ΔT)
  // 必须满足前置安全限制：水泵运行且流量有效 >= minSafeFlow
  const flowRate = state.lastFlowRate
  if (!isPumpOn) {
    state.estimatedThermalPower = 0.0
    state.powerStatus = "pump_off"
    state.powerStatusText = "水泵未开启"
  } else if (!hasValidFlow || flowRate < minSafeFlow) {
    state.estimatedThermalPower = 0.0
    state.powerStatus = "low_flow"
    state.powerStatusText = `循环流量过低 (<${minSafeFlow}L/min)`
  } else {
    // 水泵开启且流量正常，计算估算功率
    const calculatedPower = THERMAL_POWER_FACTOR * flowRate * heatTransferDiff
    if (heatTransferDiff <= 0) {
      // 水箱A温度 <= 水箱B温度：说明循环介质未能从水箱A向B放热
      state.estimatedThermalPower = 0.0
      state.powerStatus = "direction_anomaly"
      state.powerStatusText = "供热温差非正，请确认测点与水流方向"
    } else {
      state.estimatedThermalPower = roundNumber(calculatedPower, 2)
      state.powerStatus = "ok"
      state.powerStatusText = "正常热传递"
    }
  }

  state.lastCalcTime = now

  const payload = formatStatusPayload(state, now)

  // 7. WebSocket 实时广播
  const broadcast = getBroadcast()
  if (typeof broadcast === "function") {
    broadcast("thermal_realtime", payload)
  }

  return payload
}

const formatStatusPayload = (state, now) => {
  const d = new Date(now)
  const timeStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`

  return {
    d_no: state.dNo,
    temperature_difference: state.tempDiff,
    heat_transfer_difference: state.heatTransferTempDiff,
    heating_rate: state.heatingRateIn,
    heating_rate_out: state.heatingRateOut,
    estimated_thermal_power: state.estimatedThermalPower,
    power_status: state.powerStatus,
    power_status_text: state.powerStatusText,
    temp_in: state.lastTempIn,
    temp_out: state.lastTempOut,
    flow_rate: state.lastFlowRate,
    water_Y2: state.lastWaterY2,
    heat_Y1: state.lastHeatY1,
    c_time: timeStr,
    timestamp: now,
  }
}

/**
 * 查询指定设备的热工效能状态
 */
const getThermalStatus = async (dNo) => {
  const targetNo = dNo || "DEFAULT"
  const state = getOrCreateState(targetNo)
  return formatStatusPayload(state, state.lastCalcTime || Date.now())
}

// 供单元测试清理与模拟依赖使用
const __resetForTests = () => {
  deviceThermalMap.clear()
  broadcastDep = null
  configLoaderDep = null
}

const __setBroadcastForTests = (fn) => {
  broadcastDep = fn
}

const __setConfigLoaderForTests = (fn) => {
  configLoaderDep = fn
}

module.exports = {
  THERMAL_POWER_FACTOR,
  getThermalStatus,
  onSensorThermalData,
  __resetForTests,
  __setBroadcastForTests,
  __setConfigLoaderForTests,
}
