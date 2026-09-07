let queryImpl = null
const getQuery = () => {
  if (queryImpl) return queryImpl
  return require("../repositories/query").query
}
let broadcastDep = null
let configLoaderDep = null
let historyLoggerDep = null

const deviceFlowMap = new Map()

const getOrCreateState = (dNo) => {
  if (!deviceFlowMap.has(dNo)) {
    deviceFlowMap.set(dNo, {
      dNo,
      totalVolume: 0.0,
      lastFlowRate: 0.0,
      lastTime: 0,
      lastVelocity: null,
      velocityStatus: "unconfigured",
      pipeInnerDiameter: null,
      lastSaveTime: 0,
      flowSamples: [],
      averageFlow1min: 0.0,
    })
  }
  return deviceFlowMap.get(dNo)
}

const ensureTable = async () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS t_water_flow_accumulator (
      d_no VARCHAR(64) PRIMARY KEY,
      total_volume DOUBLE NOT NULL DEFAULT 0.0,
      last_flow_rate DOUBLE NOT NULL DEFAULT 0.0,
      last_calc_time BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `
  try {
    await getQuery()(sql)
  } catch (error) {
    console.error("[WaterFlow] 创建/检查累计流量表失败:", error.message)
  }
}

const loadAllFromDatabase = async () => {
  await ensureTable()
  try {
    const rows = await getQuery()(
      "SELECT d_no, total_volume, last_flow_rate, last_calc_time FROM t_water_flow_accumulator",
    )
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row.d_no) continue
        const state = getOrCreateState(row.d_no)
        state.totalVolume = Number(row.total_volume) || 0.0
        state.lastFlowRate = Number(row.last_flow_rate) || 0.0
        state.lastTime = Number(row.last_calc_time) || 0
      }
    }
  } catch (error) {
    console.error("[WaterFlow] 从数据库载入累计流量数据失败:", error.message)
  }
}

const persistState = async (state) => {
  const sql = `
    INSERT INTO t_water_flow_accumulator (d_no, total_volume, last_flow_rate, last_calc_time)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      total_volume = VALUES(total_volume),
      last_flow_rate = VALUES(last_flow_rate),
      last_calc_time = VALUES(last_calc_time)
  `
  try {
    await getQuery()(sql, [state.dNo, state.totalVolume, state.lastFlowRate, state.lastTime])
  } catch (error) {
    console.error(`[WaterFlow] 持久化设备 ${state.dNo} 累计流量失败:`, error.message)
  }
}

const getPipeInnerDiameter = async (dNo) => {
  if (typeof configLoaderDep === "function") {
    const rows = await configLoaderDep(dNo)
    const diameterRow = rows?.find((item) => item.topic === "pipe_inner_diameter")
    const val = Number.parseFloat(diameterRow?.value)
    return Number.isFinite(val) && val > 0 ? val : null
  }
  try {
    const directRepository = require("../repositories/directRepository")
    const configRows = await directRepository.getDeviceConfigRows(dNo)
    const diameterRow = configRows.find((item) => item.topic === "pipe_inner_diameter")
    const val = Number.parseFloat(diameterRow?.value)
    return Number.isFinite(val) && val > 0 ? val : null
  } catch {
    return null
  }
}

// 流速换算：Q 为 L/min, D 为 mm, 返回 m/s
// A = π * (D/1000)^2 / 4 (m^2)
// Q_m3s = flowRate / 60000 (m^3/s)
// v = Q_m3s / A (m/s)
const calculateVelocity = (flowRate, diameterMm) => {
  if (!diameterMm || diameterMm <= 0) return null
  const dMeter = diameterMm / 1000.0
  const area = (Math.PI * dMeter * dMeter) / 4.0
  if (area <= 0) return null
  const qM3PerSec = flowRate / 60000.0
  const velocity = qM3PerSec / area
  return Number(velocity.toFixed(3))
}

const onSensorFlowData = async (dNo, rawData, now = Date.now(), dataTimeoutSeconds = 3) => {
  if (!dNo || !rawData) return null
  const flowRateRaw = rawData.flow_rate ?? rawData.field5
  if (flowRateRaw === null || flowRateRaw === undefined) return null
  const flowRate = Number(flowRateRaw)
  if (!Number.isFinite(flowRate) || flowRate < 0) return null

  let dataTime = now
  const timeCandidate = rawData.c_time || rawData.time
  if (timeCandidate) {
    const parsed = new Date(timeCandidate).getTime()
    if (!Number.isNaN(parsed) && parsed > 0 && Math.abs(now - parsed) < 86400_000) {
      dataTime = parsed
    }
  }

  const state = getOrCreateState(dNo)
  const dtSeconds = state.lastTime > 0 ? (dataTime - state.lastTime) / 1000 : 0

  // 梯形微元累加：
  // 仅在相邻有效数据时间差 dt 在合理范围内（0 < dt <= dataTimeoutSeconds）时计算
  // 若 dt > dataTimeoutSeconds，则视为通讯中断，不把断线期间的时间计入过水体积
  if (dtSeconds > 0 && dtSeconds <= dataTimeoutSeconds) {
    const deltaVolume = ((state.lastFlowRate + flowRate) / 2.0) * (dtSeconds / 60.0)
    if (Number.isFinite(deltaVolume) && deltaVolume >= 0) {
      state.totalVolume += deltaVolume
    }
  }

  state.lastFlowRate = flowRate
  state.lastTime = dataTime

  // 维护最近 60 秒滑动窗口内的流量样本
  state.flowSamples.push({ time: dataTime, flow_rate: flowRate })
  state.flowSamples = state.flowSamples.filter((s) => dataTime - s.time <= 60000)

  // 计算最近 1 分钟平均流量 (L/min)
  let avgFlow1min = flowRate
  if (state.flowSamples.length > 0) {
    const sumFlow = state.flowSamples.reduce((acc, cur) => acc + cur.flow_rate, 0)
    avgFlow1min = sumFlow / state.flowSamples.length
  }
  state.averageFlow1min = Number(avgFlow1min.toFixed(2))

  // 计算管内流速
  const diameterMm = await getPipeInnerDiameter(dNo)
  state.pipeInnerDiameter = diameterMm
  if (diameterMm && diameterMm > 0) {
    state.lastVelocity = calculateVelocity(flowRate, diameterMm)
    state.velocityStatus = "ok"
  } else {
    state.lastVelocity = null
    state.velocityStatus = "unconfigured"
  }

  // 节流落盘保存（每 2 秒或首次保存一次）
  if (now - state.lastSaveTime >= 2000) {
    state.lastSaveTime = now
    persistState(state).catch(() => {})
  }

  const result = {
    d_no: dNo,
    flow_rate: Number(flowRate.toFixed(3)),
    average_flow_1min: state.averageFlow1min,
    flow_velocity: state.lastVelocity,
    velocity_status: state.velocityStatus,
    pipe_inner_diameter: state.pipeInnerDiameter,
    total_volume: Number(state.totalVolume.toFixed(3)),
    updated_at: new Date(now).toISOString(),
  }

  // 广播给客户端
  let broadcast = broadcastDep
  if (!broadcast) {
    try {
      broadcast = require("../websocket").broadcastToClients
    } catch {
      broadcast = null
    }
  }
  if (typeof broadcast === "function") {
    broadcast("water_flow_realtime", result)
  }

  return result
}

const getFlowStatus = async (dNo) => {
  const state = getOrCreateState(dNo)
  const diameterMm = await getPipeInnerDiameter(dNo)
  state.pipeInnerDiameter = diameterMm
  if (diameterMm && diameterMm > 0) {
    state.lastVelocity = calculateVelocity(state.lastFlowRate, diameterMm)
    state.velocityStatus = "ok"
  } else {
    state.lastVelocity = null
    state.velocityStatus = "unconfigured"
  }
  return {
    d_no: dNo,
    flow_rate: Number(state.lastFlowRate.toFixed(3)),
    average_flow_1min: state.averageFlow1min ?? Number(state.lastFlowRate.toFixed(2)),
    flow_velocity: state.lastVelocity,
    velocity_status: state.velocityStatus,
    pipe_inner_diameter: state.pipeInnerDiameter,
    total_volume: Number(state.totalVolume.toFixed(3)),
    last_time: state.lastTime,
  }
}

const resetTotalVolume = async (dNo, remark = "用户操作清零") => {
  const state = getOrCreateState(dNo)
  const oldVolume = Number(state.totalVolume.toFixed(3))
  state.totalVolume = 0.0
  state.lastTime = Date.now()
  await persistState(state)

  try {
    if (typeof historyLoggerDep === "function") {
      await historyLoggerDep({
        d_no: dNo,
        direct_name: "清零累计总流量",
        direct_type: "reset_total_volume",
        old_value: String(oldVolume),
        new_value: "0",
        result: "success",
        remark: `${remark}（原累计量: ${oldVolume} L）`,
      })
    } else {
      const directHistoryRepository = require("../repositories/directHistoryRepository")
      await directHistoryRepository.insertDirectHistory({
        d_no: dNo,
        direct_name: "清零累计总流量",
        direct_type: "reset_total_volume",
        old_value: String(oldVolume),
        new_value: "0",
        result: "success",
        remark: `${remark}（原累计量: ${oldVolume} L）`,
      })
    }
  } catch (err) {
    console.error("[WaterFlow] 记录清零操作历史失败:", err.message)
  }

  const result = {
    d_no: dNo,
    flow_rate: Number(state.lastFlowRate.toFixed(3)),
    flow_velocity: state.lastVelocity,
    velocity_status: state.velocityStatus,
    pipe_inner_diameter: state.pipeInnerDiameter,
    total_volume: 0.0,
    updated_at: new Date().toISOString(),
  }

  let broadcast = broadcastDep
  if (!broadcast) {
    try {
      broadcast = require("../websocket").broadcastToClients
    } catch {
      broadcast = null
    }
  }
  if (typeof broadcast === "function") {
    broadcast("water_flow_realtime", result)
  }

  return result
}

const initWaterFlow = () => {
  loadAllFromDatabase().catch((err) => {
    console.error("[WaterFlow] 初始化加载累计流量失败:", err.message)
  })
}

// 测试辅助
const __resetForTests = () => {
  deviceFlowMap.clear()
  queryImpl = null
  broadcastDep = null
  configLoaderDep = null
  historyLoggerDep = null
}
const __setQueryForTests = (q) => { queryImpl = q }
const __setBroadcastForTests = (b) => { broadcastDep = b }
const __setConfigLoaderForTests = (c) => { configLoaderDep = c }
const __setHistoryLoggerForTests = (h) => { historyLoggerDep = h }

module.exports = {
  calculateVelocity,
  ensureTable,
  getFlowStatus,
  getOrCreateState,
  initWaterFlow,
  loadAllFromDatabase,
  onSensorFlowData,
  persistState,
  resetTotalVolume,
  __resetForTests,
  __setBroadcastForTests,
  __setConfigLoaderForTests,
  __setHistoryLoggerForTests,
  __setQueryForTests,
}
