// 短时内存缓存，避免高频上报时每次都全量查库，同时保证页面修改后2秒内生效
const configCache = new Map()
const CACHE_TTL_MS = 2000
let configLoaderDep = null

const getCachedDeviceConfigs = async (dNo) => {
  if (typeof configLoaderDep === "function") {
    return configLoaderDep(dNo)
  }

  const now = Date.now()
  const cached = configCache.get(dNo)
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.params
  }

  try {
    const directRepository = require("../repositories/directRepository")
    const rows = await directRepository.getDeviceConfigRows(dNo)
    const params = {
      max_safe_temperature: 45,
      max_safe_pressure: 150,
      min_safe_flow: 0.5,
    }

    for (const row of rows) {
      if (!row.topic) continue
      const val = Number.parseFloat(row.value)
      if (Number.isFinite(val)) {
        params[row.topic] = val
      }
    }

    configCache.set(dNo, { timestamp: now, params })
    return params
  } catch (error) {
    console.error(`[SensorValidation] 读取设备 ${dNo} 控制配置异常:`, error.message)
    return {
      max_safe_temperature: 45,
      max_safe_pressure: 150,
      min_safe_flow: 0.5,
    }
  }
}

/**
 * 根据设备当前页面配置的真实阈值，动态计算传感器数据的合法性与 vstatus 状态码。
 * 正常为 0，超出用户设置的上限判定为告警，赋予 1。
 */
const evaluateSensorVstatus = async (data) => {
  if (!data) return 0

  // 若设备端已自带明确的非零状态码，优先采纳
  const rawVstatus = data.VStatus ?? data.vstatus
  if (rawVstatus !== undefined && rawVstatus !== null && rawVstatus !== "") {
    const num = Number.parseInt(rawVstatus, 10)
    if (!Number.isNaN(num) && num !== 0) {
      return num
    }
  }

  const dNo = data.d_no
  if (!dNo) return 0

  const params = await getCachedDeviceConfigs(dNo)

  // 提取温度数值（兼容各种字段名：temp_out、temp_in、field2、field3、Tout、Tin）
  const tempCandidates = [
    data.temp_out,
    data.temp_in,
    data.field2,
    data.field3,
    data.Tout,
    data.Tin,
  ]
  for (const candidate of tempCandidates) {
    if (candidate !== undefined && candidate !== null && candidate !== "") {
      const val = Number(candidate)
      if (Number.isFinite(val) && val >= params.max_safe_temperature) {
        return 1
      }
    }
  }

  // 提取压力数值（兼容 pressure、field4、Pin）
  const pressureCandidates = [
    data.pressure,
    data.field4,
    data.Pin,
  ]
  for (const candidate of pressureCandidates) {
    if (candidate !== undefined && candidate !== null && candidate !== "") {
      const val = Number(candidate)
      if (Number.isFinite(val) && val >= params.max_safe_pressure) {
        return 1
      }
    }
  }

  // 提取流量数值（兼容 flow_rate、field5、Fin、flow）
  const flowCandidates = [
    data.flow_rate,
    data.field5,
    data.Fin,
    data.flow,
  ]
  let currentFlow = null
  for (const candidate of flowCandidates) {
    if (candidate !== undefined && candidate !== null && candidate !== "") {
      const val = Number(candidate)
      if (Number.isFinite(val)) {
        currentFlow = val
        break
      }
    }
  }

  // 判断水泵是否开启运行
  let isPumpActive = false
  if (data.water_Y2 !== undefined && data.water_Y2 !== null && data.water_Y2 !== "") {
    isPumpActive = Number(data.water_Y2) === 1
  } else {
    try {
      const { getOrCreateDeviceState } = require("./waterControlEngine")
      const devState = getOrCreateDeviceState(dNo)
      isPumpActive = devState.pumpState === "on" || devState.desiredPumpState === "on"
    } catch {
      isPumpActive = false
    }
  }

  // 判断设备当前是否处于水力异常状态（过程一~四）
  let isHydraulicFault = false
  try {
    const { getDeviceDiagnosis, DIAGNOSIS_CODES } = require("./hydraulicDiagnosisService")
    const diag = getDeviceDiagnosis(dNo)
    if (diag && [
      DIAGNOSIS_CODES.HYDRAULIC_BLOCKAGE,
      DIAGNOSIS_CODES.HYDRAULIC_PUMP_ABNORMAL,
      DIAGNOSIS_CODES.HYDRAULIC_SENSOR_ANOMALY,
      DIAGNOSIS_CODES.HYDRAULIC_LEAK_OR_BURST,
    ].includes(diag.code)) {
      isHydraulicFault = true
    }
  } catch {
    isHydraulicFault = false
  }

  // 判定过程 1~4 与低流量异常：
  // 1. 若当前确诊为水力异常（过程一~四），该数据必然为异常告警数据
  if (isHydraulicFault) {
    return 1
  }

  // 2. 若水泵处于开机运行状态，且流量低于最低安全流量（过程二泵送异常、过程三传感器异常、常规失流干烧）
  if (isPumpActive && currentFlow !== null && currentFlow < params.min_safe_flow) {
    return 1
  }

  return 0
}

const clearConfigCache = () => {
  configCache.clear()
}

const __setConfigLoaderForTests = (loader) => {
  configLoaderDep = loader
}

module.exports = {
  __setConfigLoaderForTests,
  clearConfigCache,
  evaluateSensorVstatus,
  getCachedDeviceConfigs,
}
