// 水循环 4.2 压力与流量联合诊断服务
// 本模块依据赛题《水循环系统补充逻辑设计》4.2节规范实现：
// 1. 疑似管路堵塞或出口阻力过大 (HYDRAULIC_BLOCKAGE)
// 2. 疑似泵送异常 (HYDRAULIC_PUMP_ABNORMAL)
// 3. 疑似流量传感器异常或局部阻力增加 (HYDRAULIC_SENSOR_ANOMALY)
// 4. 疑似管路脱落、严重泄漏或水力骤降 (HYDRAULIC_LEAK_OR_BURST)
// （持续波动检测已按要求剔除）

const DIAGNOSIS_CODES = {
  STOPPED: "STOPPED",
  BUILDING_FLOW: "BUILDING_FLOW",
  SENSOR_INVALID: "SENSOR_INVALID",
  HYDRAULIC_NORMAL: "HYDRAULIC_NORMAL",
  HYDRAULIC_BLOCKAGE: "HYDRAULIC_BLOCKAGE",
  HYDRAULIC_PUMP_ABNORMAL: "HYDRAULIC_PUMP_ABNORMAL",
  HYDRAULIC_SENSOR_ANOMALY: "HYDRAULIC_SENSOR_ANOMALY",
  HYDRAULIC_LEAK_OR_BURST: "HYDRAULIC_LEAK_OR_BURST",
}

const DIAGNOSIS_METAS = {
  [DIAGNOSIS_CODES.STOPPED]: {
    name: "系统已停止",
    detail: "水泵未运行，不进行水力状态诊断",
    level: "info",
  },
  [DIAGNOSIS_CODES.BUILDING_FLOW]: {
    name: "正在建流",
    detail: "水泵正在建立循环流量，处于允许建立缓冲期",
    level: "info",
  },
  [DIAGNOSIS_CODES.SENSOR_INVALID]: {
    name: "传感器数据无效",
    detail: "压力或流量传感器数据超时未更新，暂缓原因诊断",
    level: "warning",
  },
  [DIAGNOSIS_CODES.HYDRAULIC_NORMAL]: {
    name: "水力运行正常",
    detail: "压力与流量处于正常安全工作区间",
    level: "success",
  },
  [DIAGNOSIS_CODES.HYDRAULIC_BLOCKAGE]: {
    name: "疑似管路堵塞",
    detail: "管路超压且流量不足，疑似出口阀门未开、管路受压折弯或严重堵塞",
    level: "error",
  },
  [DIAGNOSIS_CODES.HYDRAULIC_PUMP_ABNORMAL]: {
    name: "疑似泵送异常",
    detail: "压力与流量均处于超低水平，疑似水箱缺水、吸水口进气气阻或水泵空转未吸上水",
    level: "error",
  },
  [DIAGNOSIS_CODES.HYDRAULIC_SENSOR_ANOMALY]: {
    name: "疑似流量传感器异常",
    detail: "管路建压正常但测得流量偏低，疑似流量计叶轮卡死、传感器信号异常或局部节流阻力大",
    level: "warning",
  },
  [DIAGNOSIS_CODES.HYDRAULIC_LEAK_OR_BURST]: {
    name: "疑似管路脱落/严重泄漏",
    detail: "在平稳运行中压力与流量发生同步断崖式骤降，疑似管件脱开、严重爆管破损或失水",
    level: "error",
  },
}

// 保存每个设备的时序诊断跟踪状态
const deviceDiagnosisStateMap = new Map()

const getOrCreateDiagnosisState = (dNo) => {
  if (!deviceDiagnosisStateMap.has(dNo)) {
    deviceDiagnosisStateMap.set(dNo, {
      dNo,
      currentCandidateCode: null,
      candidateStartTime: 0,
      lockedFaultDiagnosis: null,
      activeDiagnosis: {
        code: DIAGNOSIS_CODES.STOPPED,
        ...DIAGNOSIS_METAS[DIAGNOSIS_CODES.STOPPED],
      },
      // 滑动窗口：记录最近有效采样点用于骤降检测 [{ time, pressure, flowRate }]
      historySamples: [],
    })
  }
  return deviceDiagnosisStateMap.get(dNo)
}

/**
 * 检测压力与流量是否相对过去的稳定运行水平发生同步剧烈骤降
 */
const detectSuddenDrop = (historySamples, currentPressure, currentFlow) => {
  // 至少需要积累最近 3 个采样点且都在正常工况下
  if (!historySamples || historySamples.length < 3) return false

  // 取过去前序样本的平均参考值（排除最近一个）
  const baselineSamples = historySamples.slice(0, Math.max(1, historySamples.length - 1))
  const avgPressure = baselineSamples.reduce((sum, s) => sum + s.pressure, 0) / baselineSamples.length
  const avgFlow = baselineSamples.reduce((sum, s) => sum + s.flowRate, 0) / baselineSamples.length

  // 基准值本身必须是正常工作水平（有压有流）才谈得上“骤降”
  if (avgPressure < 30 || avgFlow < 0.6) return false

  const deltaPressure = currentPressure - avgPressure
  const deltaFlow = currentFlow - avgFlow
  const dropPressureRatio = (avgPressure - currentPressure) / avgPressure
  const dropFlowRatio = (avgFlow - currentFlow) / avgFlow

  // 判定标准：两者同时跌幅 >= 35%，且绝对压降 >= 20kPa，流量骤降 >= 0.3L/min
  const pressureSuddenDropped = dropPressureRatio >= 0.35 && Math.abs(deltaPressure) >= 20
  const flowSuddenDropped = dropFlowRatio >= 0.35 && Math.abs(deltaFlow) >= 0.3

  return pressureSuddenDropped && flowSuddenDropped
}

/**
 * 评估单次水力状态核心逻辑
 * @param {string} dNo 设备号
 * @param {object} context 当前运行上下文
 * @param {object} params 控制参数
 * @param {number} now 当前时间戳
 */
const evaluateHydraulicStatus = (dNo, context, params, now = Date.now()) => {
  const state = getOrCreateDiagnosisState(dNo)
  const {
    pumpState,
    flowRate,
    pressure,
    isBuildingFlow,
    isFault,
    staleSensors = [],
  } = context

  // 0. 设备处于故障锁定状态：保持触发停机时的诊断结论，直到故障复位
  if (isFault && state.lockedFaultDiagnosis) {
    return state.lockedFaultDiagnosis
  }

  // 1. 水泵未开：正常停机，免检
  if (pumpState !== "on") {
    state.currentCandidateCode = null
    state.candidateStartTime = 0
    state.historySamples = []
    if (state.lockedFaultDiagnosis) {
      return state.lockedFaultDiagnosis
    }
    state.activeDiagnosis = {
      code: DIAGNOSIS_CODES.STOPPED,
      ...DIAGNOSIS_METAS[DIAGNOSIS_CODES.STOPPED],
    }
    return state.activeDiagnosis
  }

  // 2. 传感器超时或无效：无法推断水力，免检
  if (staleSensors.includes("flow_rate") || staleSensors.includes("pressure") || flowRate === null || pressure === null) {
    state.currentCandidateCode = null
    state.candidateStartTime = 0
    if (state.lockedFaultDiagnosis) {
      return state.lockedFaultDiagnosis
    }
    state.activeDiagnosis = {
      code: DIAGNOSIS_CODES.SENSOR_INVALID,
      ...DIAGNOSIS_METAS[DIAGNOSIS_CODES.SENSOR_INVALID],
    }
    return state.activeDiagnosis
  }

  // 3. 正在建流阶段：水力仍在建立，不提前诊断误判
  if (isBuildingFlow) {
    state.currentCandidateCode = null
    state.candidateStartTime = 0
    state.activeDiagnosis = {
      code: DIAGNOSIS_CODES.BUILDING_FLOW,
      ...DIAGNOSIS_METAS[DIAGNOSIS_CODES.BUILDING_FLOW],
    }
    return state.activeDiagnosis
  }

  // 维护滑动历史样本（保留最近 8 秒内的点）
  state.historySamples.push({ time: now, pressure, flowRate })
  state.historySamples = state.historySamples.filter((s) => now - s.time <= 8000)

  const minSafeFlow = params.min_safe_flow ?? 0.5
  const maxSafePressure = params.max_safe_pressure ?? 150.0
  const minOperatingPressure = params.min_operating_pressure ?? 20.0
  const confirmTimeSec = params.pressure_flow_diagnosis_confirm_time ?? 2.0
  const confirmTimeMs = confirmTimeSec * 1000

  // 判定过程 1：疑似管路堵塞或出口阻力过大（高压低流）
  // 注意：超压属于最高紧急度的瞬时硬核急停保护，无需且不能等待 2 秒防抖，当场立即确诊并联动停机！
  if (pressure >= maxSafePressure && flowRate < minSafeFlow) {
    const candidateCode = DIAGNOSIS_CODES.HYDRAULIC_BLOCKAGE
    state.currentCandidateCode = candidateCode
    state.candidateStartTime = now
    state.activeDiagnosis = {
      code: candidateCode,
      ...DIAGNOSIS_METAS[candidateCode],
    }
    return state.activeDiagnosis
  }

  // 判定过程 4：疑似管路脱落/严重泄漏/水力骤降（优先级高，直接确诊）
  if (detectSuddenDrop(state.historySamples, pressure, flowRate)) {
    const candidateCode = DIAGNOSIS_CODES.HYDRAULIC_LEAK_OR_BURST
    state.currentCandidateCode = candidateCode
    state.candidateStartTime = now
    state.activeDiagnosis = {
      code: candidateCode,
      ...DIAGNOSIS_METAS[candidateCode],
    }
    return state.activeDiagnosis
  }

  let candidateCode = DIAGNOSIS_CODES.HYDRAULIC_NORMAL

  // 判定过程 2：疑似泵送异常（低压低流）
  if (pressure < minOperatingPressure && flowRate < minSafeFlow) {
    candidateCode = DIAGNOSIS_CODES.HYDRAULIC_PUMP_ABNORMAL
  }
  // 判定过程 3：疑似流量传感器异常或局部阻力增加（常压低流）
  else if (pressure >= minOperatingPressure && pressure < maxSafePressure && flowRate < minSafeFlow) {
    candidateCode = DIAGNOSIS_CODES.HYDRAULIC_SENSOR_ANOMALY
  }
  // 正常运行
  else {
    candidateCode = DIAGNOSIS_CODES.HYDRAULIC_NORMAL
  }

  // 防抖计时确认（针对过程 2、过程 3 的非紧急工况）
  if (candidateCode === DIAGNOSIS_CODES.HYDRAULIC_NORMAL) {
    state.currentCandidateCode = null
    state.candidateStartTime = 0
    state.activeDiagnosis = {
      code: DIAGNOSIS_CODES.HYDRAULIC_NORMAL,
      ...DIAGNOSIS_METAS[DIAGNOSIS_CODES.HYDRAULIC_NORMAL],
    }
    return state.activeDiagnosis
  }

  // 若异常状态与前一次一致，判断是否满持续确认时间
  if (state.currentCandidateCode === candidateCode) {
    if (now - state.candidateStartTime >= confirmTimeMs) {
      state.activeDiagnosis = {
        code: candidateCode,
        ...DIAGNOSIS_METAS[candidateCode],
      }
    }
  } else {
    // 新异常候选，启动计时
    state.currentCandidateCode = candidateCode
    state.candidateStartTime = now
  }

  return state.activeDiagnosis
}

const lockFaultDiagnosis = (dNo, diagnosis) => {
  const state = getOrCreateDiagnosisState(dNo)
  if (diagnosis && diagnosis.code !== DIAGNOSIS_CODES.STOPPED && diagnosis.code !== DIAGNOSIS_CODES.HYDRAULIC_NORMAL) {
    state.lockedFaultDiagnosis = { ...diagnosis }
    state.activeDiagnosis = { ...diagnosis }
  }
}

const getDeviceDiagnosis = (dNo) => {
  const state = getOrCreateDiagnosisState(dNo)
  return state.lockedFaultDiagnosis || state.activeDiagnosis
}

const resetDeviceDiagnosis = (dNo) => {
  if (deviceDiagnosisStateMap.has(dNo)) {
    const state = deviceDiagnosisStateMap.get(dNo)
    state.currentCandidateCode = null
    state.candidateStartTime = 0
    state.historySamples = []
    state.lockedFaultDiagnosis = null
    state.activeDiagnosis = {
      code: DIAGNOSIS_CODES.STOPPED,
      ...DIAGNOSIS_METAS[DIAGNOSIS_CODES.STOPPED],
    }
  }
}

module.exports = {
  DIAGNOSIS_CODES,
  DIAGNOSIS_METAS,
  evaluateHydraulicStatus,
  getDeviceDiagnosis,
  lockFaultDiagnosis,
  resetDeviceDiagnosis,
}
