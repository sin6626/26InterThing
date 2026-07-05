// PID 在行为表中被视作一个特殊的“行为字段”，这里集中维护它的定义。
const PID_BEHAVIOR_MAPPING = {
  id: 1,
  f_name: "PID",
  db_name: "field5",
  unit: "",
  visible: "1",
  type: "2",
  p_name: "pid",
}

// 启动时确保行为字段映射表里存在 PID 这一项，避免后续落库找不到列语义。
const buildEnsureBehaviorPidMappingSql = () => ({
  sql: `INSERT INTO t_behavior_field_mapper (id, f_name, db_name, unit, visible, type, p_name)
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM t_behavior_field_mapper WHERE p_name = ? OR f_name = ? OR db_name = ?
    )`,
  params: [
    PID_BEHAVIOR_MAPPING.id,
    PID_BEHAVIOR_MAPPING.f_name,
    PID_BEHAVIOR_MAPPING.db_name,
    PID_BEHAVIOR_MAPPING.unit,
    PID_BEHAVIOR_MAPPING.visible,
    PID_BEHAVIOR_MAPPING.type,
    PID_BEHAVIOR_MAPPING.p_name,
    PID_BEHAVIOR_MAPPING.p_name,
    PID_BEHAVIOR_MAPPING.f_name,
    PID_BEHAVIOR_MAPPING.db_name,
  ],
})

// 真正执行“若不存在则补齐”的初始化逻辑。
const ensureBehaviorPidMapping = () => {
  const db = require("../db")
  const { sql, params } = buildEnsureBehaviorPidMappingSql()

  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, result) => {
      if (err) {
        reject(err)
        return
      }
      resolve(result)
    })
  })
}

// 统一构造 PID 行为数据的标准载荷，避免不同调用方各自拼字段。
const buildBehaviorPidPayload = ({ d_no, pidList, c_time, online = "实时数据" }) => {
  return {
    d_no,
    PID: pidList,
    pid: pidList.join(","),
    c_time,
    online,
  }
}

module.exports = {
  PID_BEHAVIOR_MAPPING,
  buildBehaviorPidPayload,
  buildEnsureBehaviorPidMappingSql,
  ensureBehaviorPidMapping,
}
