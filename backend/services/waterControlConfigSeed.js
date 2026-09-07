const WATER_CONTROL_CONFIGS = [
  [0, null, null, "控制模式", "1", "1", "master", "device/direct", "off"],
  [10, 0, "on", "目标温度", "2", "1", "target_temperature", null, "35"],
  [11, 0, "on", "温度回差", "2", "1", "temperature_hysteresis", null, "0.5"],
  [12, 0, "on", "允许加热的最低流量", "2", "1", "min_safe_flow", null, "0.5"],
  [13, 0, "on", "最大安全压力", "2", "1", "max_safe_pressure", null, "150"],
  [15, 0, "on", "最高安全温度", "2", "1", "max_safe_temperature", null, "45"],
  [16, 0, "on", "水泵启动建流超时时间（秒）", "2", "1", "build_flow_timeout", null, "5"],
  [17, 0, "on", "运行中低流量确认时间（秒）", "2", "1", "low_flow_confirm_time", null, "2"],
  [18, 0, "on", "关闭加热后水泵冷却时间（秒）", "2", "1", "cooling_delay", null, "10"],
  [19, 0, "on", "数据更新超时时间（秒）", "2", "1", "data_timeout", null, "3"],
  [20, 0, "on", "MQTT发布超时时间（秒）", "2", "1", "command_timeout", null, "2"],
  [21, 0, "off", "水泵开关", "1", "1", "pump", "device/direct", "off"],
  [22, 0, "off", "加热开关", "1", "1", "heater", "device/direct", "off"],
  [25, 0, "on", "水管内径（毫米）", "2", "1", "pipe_inner_diameter", null, "15"],
  [28, 0, "on", "参考最低压力", "2", "1", "min_operating_pressure", null, "20"],
  [29, 0, "on", "水流压力联合诊断时间", "2", "1", "pressure_flow_diagnosis_confirm_time", null, "2"],
]

const ensureWaterControlConfigs = async (queryImpl) => {
  const configWithPreferredIdSql = `
    INSERT INTO t_direct_config (
      id, ref_id, ref_value, t_name, f_type, mode, topic, publish_topic
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  const configWithGeneratedIdSql = `
    INSERT INTO t_direct_config (
      ref_id, ref_value, t_name, f_type, mode, topic, publish_topic
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  const defaultSql = `INSERT IGNORE INTO t_direct_global (config_id, value) VALUES (?, ?)`
  const configIdsByTopic = new Map()

  for (const [preferredId, configuredRefId, refValue, name, fieldType, mode, topic, publishTopic, defaultValue] of WATER_CONTROL_CONFIGS) {
    const existingRows = await queryImpl(
      "SELECT id FROM t_direct_config WHERE topic = ? ORDER BY id LIMIT 1",
      [topic],
    )
    let configId = existingRows?.[0]?.id

    if (configId === undefined) {
      const parentId = configuredRefId === null ? null : configIdsByTopic.get("master")
      const occupiedRows = await queryImpl(
        "SELECT id FROM t_direct_config WHERE id = ? LIMIT 1",
        [preferredId],
      )
      if (occupiedRows?.length) {
        const insertResult = await queryImpl(configWithGeneratedIdSql, [
          parentId, refValue, name, fieldType, mode, topic, publishTopic,
        ])
        configId = insertResult.insertId
      } else {
        await queryImpl(configWithPreferredIdSql, [
          preferredId, parentId, refValue, name, fieldType, mode, topic, publishTopic,
        ])
        configId = preferredId
      }
    }

    configIdsByTopic.set(topic, configId)
    await queryImpl(defaultSql, [configId, defaultValue])
  }

  await queryImpl(
    "UPDATE t_direct_config SET t_name = ? WHERE id = ? AND topic = ? AND t_name NOT LIKE ?",
    ["数据更新超时时间（秒）", configIdsByTopic.get("data_timeout"), "data_timeout", "%秒%"],
  )
  await queryImpl(
    "UPDATE t_direct_config SET t_name = ? WHERE id = ? AND topic = ? AND t_name NOT LIKE ?",
    ["MQTT发布超时时间（秒）", configIdsByTopic.get("command_timeout"), "command_timeout", "%秒%"],
  )
}

module.exports = {
  ensureWaterControlConfigs,
  WATER_CONTROL_CONFIGS,
}
