const assert = require("assert")
const {
  getRuleErrorMapping,
  clearErrorMappingCache,
  DEFAULT_ERROR_MAPPINGS,
} = require("../services/errorMessageMapping")

const runTests = async () => {
  console.log("=== 开始测试后台错误码语义动态映射与联动 ===")

  clearErrorMappingCache()

  // 1. 测试默认未修改时，水力联合诊断过程一~四映射
  const blockageMapping = await getRuleErrorMapping("HYDRAULIC_BLOCKAGE")
  assert.strictEqual(blockageMapping.e_no, "HYDRAULIC_BLOCKAGE")
  assert.strictEqual(blockageMapping.type, "6")
  assert.ok(blockageMapping.e_msg.includes("管路堵塞"))
  console.log("✓ 测试通过：过程一 (HYDRAULIC_BLOCKAGE) 默认映射正确")

  const pumpAbnormalMapping = await getRuleErrorMapping("HYDRAULIC_PUMP_ABNORMAL")
  assert.strictEqual(pumpAbnormalMapping.e_no, "HYDRAULIC_PUMP_ABNORMAL")
  assert.strictEqual(pumpAbnormalMapping.type, "6")
  assert.ok(pumpAbnormalMapping.e_msg.includes("吸水口进气") || pumpAbnormalMapping.e_msg.includes("水泵空转"))
  console.log("✓ 测试通过：过程二 (HYDRAULIC_PUMP_ABNORMAL) 默认映射正确")

  const sensorAnomalyMapping = await getRuleErrorMapping("HYDRAULIC_SENSOR_ANOMALY")
  assert.strictEqual(sensorAnomalyMapping.e_no, "HYDRAULIC_SENSOR_ANOMALY")
  assert.strictEqual(sensorAnomalyMapping.type, "3")
  assert.ok(sensorAnomalyMapping.e_msg.includes("流量计叶轮") || sensorAnomalyMapping.e_msg.includes("流量偏低"))
  console.log("✓ 测试通过：过程三 (HYDRAULIC_SENSOR_ANOMALY) 默认映射正确")

  const leakMapping = await getRuleErrorMapping("HYDRAULIC_LEAK_OR_BURST")
  assert.strictEqual(leakMapping.e_no, "HYDRAULIC_LEAK_OR_BURST")
  assert.strictEqual(leakMapping.type, "6")
  assert.ok(leakMapping.e_msg.includes("管路脱落"))
  console.log("✓ 测试通过：过程四 (HYDRAULIC_LEAK_OR_BURST) 默认映射正确")

  // 2. 模拟用户在后台修改配置：更新 HYDRAULIC_BLOCKAGE 为题目专用代码与类型
  const { query } = require("../repositories/query")
  const origRow = (await query("SELECT * FROM t_error_code_mapper WHERE e_no = 'HYDRAULIC_BLOCKAGE'"))[0]
  if (origRow) {
    try {
      await query("UPDATE t_error_code_mapper SET e_no = 'E999_BLOCK', type = '1', e_msg = '【题目定制】严重堵塞急停' WHERE id = ?", [origRow.id])
      clearErrorMappingCache()

      const customizedMapping = await getRuleErrorMapping("E999_BLOCK")
      assert.strictEqual(customizedMapping.e_no, "E999_BLOCK")
      assert.strictEqual(customizedMapping.type, "1")
      assert.strictEqual(customizedMapping.e_msg, "【题目定制】严重堵塞急停")
      console.log("✓ 测试通过：后台修改 e_no、type 和 e_msg 后，应用层能即时读取生效！")
    } finally {
      // 恢复原配置
      await query("UPDATE t_error_code_mapper SET e_no = ?, type = ?, e_msg = ? WHERE id = ?", [origRow.e_no, origRow.type, origRow.e_msg, origRow.id])
      clearErrorMappingCache()
    }
  }

  console.log("=== 所有后台错误码语义映射测试全部通过！===")
}

runTests().then(() => process.exit(0)).catch((err) => {
  console.error("测试失败:", err)
  process.exit(1)
})
