const assert = require("assert")
const {
  DIAGNOSIS_CODES,
  evaluateHydraulicStatus,
  resetDeviceDiagnosis,
} = require("../services/hydraulicDiagnosisService")

const dNo = "TEST_DEV_01"
const defaultParams = {
  min_safe_flow: 0.5,
  max_safe_pressure: 150.0,
  min_operating_pressure: 20.0,
  pressure_flow_diagnosis_confirm_time: 2.0,
}

console.log("=== 开始测试 4.2 压力与流量联合诊断服务 ===")

// 1. 停机免检测试
resetDeviceDiagnosis(dNo)
let res = evaluateHydraulicStatus(dNo, { pumpState: "off", flowRate: 0, pressure: 0, isBuildingFlow: false }, defaultParams, 1000)
assert.strictEqual(res.code, DIAGNOSIS_CODES.STOPPED, "停机时应判定为 STOPPED")
console.log("✓ 测试通过：水泵停机免检")

// 2. 建流期免检测试
resetDeviceDiagnosis(dNo)
res = evaluateHydraulicStatus(dNo, { pumpState: "on", flowRate: 0.1, pressure: 5, isBuildingFlow: true }, defaultParams, 1000)
assert.strictEqual(res.code, DIAGNOSIS_CODES.BUILDING_FLOW, "建流期应判定为 BUILDING_FLOW")
console.log("✓ 测试通过：建流等待期免检")

// 3. 正常运行工况
resetDeviceDiagnosis(dNo)
res = evaluateHydraulicStatus(dNo, { pumpState: "on", flowRate: 1.5, pressure: 60, isBuildingFlow: false }, defaultParams, 1000)
assert.strictEqual(res.code, DIAGNOSIS_CODES.HYDRAULIC_NORMAL, "正常水力应判定为 HYDRAULIC_NORMAL")
console.log("✓ 测试通过：正常工况识别")

// 4. 过程 1：疑似管路堵塞（高压低流），超压安全保护，立即确诊（免防抖）
resetDeviceDiagnosis(dNo)
res = evaluateHydraulicStatus(dNo, { pumpState: "on", flowRate: 0.2, pressure: 160, isBuildingFlow: false }, defaultParams, 1000)
assert.strictEqual(res.code, DIAGNOSIS_CODES.HYDRAULIC_BLOCKAGE, "过程1超压属于最高紧急度保护，应立即确诊无需防抖")
console.log("✓ 测试通过：过程 1 疑似管路堵塞立即确诊（免防抖）")

// 5. 过程 2：疑似泵送异常（低压低流），验证 2 秒防抖确认
resetDeviceDiagnosis(dNo)
// t = 1000ms: 第一次出现低压低流
res = evaluateHydraulicStatus(dNo, { pumpState: "on", flowRate: 0.1, pressure: 5, isBuildingFlow: false }, defaultParams, 1000)
assert.strictEqual(res.code, DIAGNOSIS_CODES.STOPPED, "防抖期间未满 2s 不应立即确诊")

// t = 2000ms: 经过 1s
res = evaluateHydraulicStatus(dNo, { pumpState: "on", flowRate: 0.1, pressure: 5, isBuildingFlow: false }, defaultParams, 2000)
assert.strictEqual(res.code, DIAGNOSIS_CODES.STOPPED, "未满 2s 确认时间前不确诊")

// t = 3200ms: 经过 2.2s >= 2s
res = evaluateHydraulicStatus(dNo, { pumpState: "on", flowRate: 0.1, pressure: 5, isBuildingFlow: false }, defaultParams, 3200)
assert.strictEqual(res.code, DIAGNOSIS_CODES.HYDRAULIC_PUMP_ABNORMAL, "满 2s 后应确诊为 HYDRAULIC_PUMP_ABNORMAL")
console.log("✓ 测试通过：过程 2 疑似泵送异常及 2 秒防抖确认")

// 6. 过程 3：疑似流量传感器异常（常压低流）
resetDeviceDiagnosis(dNo)
evaluateHydraulicStatus(dNo, { pumpState: "on", flowRate: 0.1, pressure: 65, isBuildingFlow: false }, defaultParams, 1000)
res = evaluateHydraulicStatus(dNo, { pumpState: "on", flowRate: 0.1, pressure: 65, isBuildingFlow: false }, defaultParams, 3200)
assert.strictEqual(res.code, DIAGNOSIS_CODES.HYDRAULIC_SENSOR_ANOMALY, "满 2s 后应确诊为 HYDRAULIC_SENSOR_ANOMALY")
console.log("✓ 测试通过：过程 3 疑似流量传感器异常确认")

// 7. 过程 4：疑似管路脱落/严重泄漏（压流同步骤降）
resetDeviceDiagnosis(dNo)
// 积累平稳运行历史样本
evaluateHydraulicStatus(dNo, { pumpState: "on", flowRate: 1.5, pressure: 70, isBuildingFlow: false }, defaultParams, 1000)
evaluateHydraulicStatus(dNo, { pumpState: "on", flowRate: 1.5, pressure: 70, isBuildingFlow: false }, defaultParams, 2000)
evaluateHydraulicStatus(dNo, { pumpState: "on", flowRate: 1.5, pressure: 70, isBuildingFlow: false }, defaultParams, 3000)
// 突然在下一时刻断崖式下跌：pressure 70 -> 25, flow 1.5 -> 0.4
evaluateHydraulicStatus(dNo, { pumpState: "on", flowRate: 0.4, pressure: 25, isBuildingFlow: false }, defaultParams, 4000)
res = evaluateHydraulicStatus(dNo, { pumpState: "on", flowRate: 0.4, pressure: 25, isBuildingFlow: false }, defaultParams, 6200)
assert.strictEqual(res.code, DIAGNOSIS_CODES.HYDRAULIC_LEAK_OR_BURST, "压流断崖式跌降应确诊为 HYDRAULIC_LEAK_OR_BURST")
console.log("✓ 测试通过：过程 4 疑似管路脱落/严重泄漏骤降确认")

console.log("=== 所有水力联合诊断测试全部通过！===")
process.exit(0)
