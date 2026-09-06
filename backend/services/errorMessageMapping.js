// 默认错误码映射，保证在数据库还没手工维护前也能给出基础中文提示。
const DEFAULT_ERROR_MAPPINGS = [
  { e_no: "OVER_PRESSURE", type: "6", e_msg: "管路超压急停保护" },
  { e_no: "OVER_TEMPERATURE", type: "6", e_msg: "水温超限散热保护" },
  { e_no: "LOW_FLOW", type: "6", e_msg: "失流干烧保护" },
  { e_no: "BUILD_FLOW_TIMEOUT", type: "6", e_msg: "水泵启动建流超时" },
  { e_no: "SENSOR_FLOW_TIMEOUT", type: "3", e_msg: "流量传感器数据超时" },
  { e_no: "SENSOR_TEMPERATURE_TIMEOUT", type: "3", e_msg: "温度传感器数据超时" },
  { e_no: "SENSOR_PRESSURE_TIMEOUT", type: "3", e_msg: "压力传感器数据超时" },
  { e_no: "COMMAND_PUBLISH_FAILED", type: "2", e_msg: "控制指令发布超时" },
  { e_no: "E001", type: "3", e_msg: "温度传感器连接超时" },
  { e_no: "E002", type: "2", e_msg: "通信连接异常" },
]

// 错误码映射表用于把设备错误编号翻译成应用层中文语义。
const buildEnsureErrorMessageTableSql = () => `
  CREATE TABLE IF NOT EXISTS t_error_code_mapper (
    id INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    e_no VARCHAR(255) NOT NULL COMMENT '错误编号，例如 E001',
    type VARCHAR(16) NOT NULL COMMENT '错误类型码，例如 3 表示传感器故障',
    e_msg VARCHAR(255) NOT NULL COMMENT '应用层映射出的中文错误信息',
    PRIMARY KEY (id),
    UNIQUE KEY uk_error_code_mapper (e_no, type)
  ) COMMENT='错误编号与错误类型到中文错误信息的映射表'
`

// 默认映射以 UPSERT 方式写入，便于后续反复执行初始化。
const buildSeedErrorMessageMappingsSql = () => {
  const valuesSql = DEFAULT_ERROR_MAPPINGS.map(() => "(?, ?, ?)").join(", ")
  return {
    sql: `INSERT INTO t_error_code_mapper (e_no, type, e_msg)
      VALUES ${valuesSql}
      ON DUPLICATE KEY UPDATE e_msg = VALUES(e_msg)`,
    params: DEFAULT_ERROR_MAPPINGS.flatMap((item) => [item.e_no, item.type, item.e_msg]),
  }
}

// 找不到精确映射时，至少返回一个可读的兜底提示，不把前端暴露成空字符串。
const fallbackErrorMessage = ({ e_no, type }) => {
  const matchedDefault = DEFAULT_ERROR_MAPPINGS.find(
    (item) => (e_no && item.e_no === String(e_no).trim()) || (type && item.type === String(type).trim()),
  )
  if (matchedDefault?.e_msg) {
    return matchedDefault.e_msg
  }

  if (e_no && type) {
    return `错误代码 ${e_no} (type=${type})`
  }

  if (e_no) {
    return `错误代码 ${e_no}`
  }

  if (type) {
    return `错误类型 ${type}`
  }

  return "未知错误"
}

// 优先级：设备原始中文描述 > 数据库映射 > 类型兜底描述。
const resolveMappedErrorMessage = async ({
  e_no,
  type,
  e_msg,
  findMapping,
}) => {
  const rawMessage = String(e_msg ?? "").trim()
  if (rawMessage) return rawMessage

  const finder = typeof findMapping === "function" ? findMapping : findErrorMessageMapping
  const row = await finder(String(e_no ?? "").trim(), String(type ?? "").trim())
  if (row?.e_msg) return row.e_msg

  return fallbackErrorMessage({ e_no, type })
}

// 服务启动或脚本执行时，可调用这里确保错误映射表和默认数据都已就绪。
const ensureErrorMessageMappings = async () => {
  const db = require("../db")

  await new Promise((resolve, reject) => {
    db.query(buildEnsureErrorMessageTableSql(), (err) => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })

  const { sql, params } = buildSeedErrorMessageMappingsSql()
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

// 供消息落库流程按错误编号 + 类型反查中文错误信息。
const findErrorMessageMapping = async (e_no, type) => {
  const db = require("../db")
  const cleanNo = String(e_no ?? "").trim()
  const cleanType = String(type ?? "").trim()

  if (cleanNo && cleanType) {
    const sql = `SELECT e_msg FROM t_error_code_mapper WHERE e_no = ? AND type = ? LIMIT 1`
    const rows = await new Promise((resolve, reject) => {
      db.query(sql, [cleanNo, cleanType], (err, res) => {
        if (err) return reject(err)
        resolve(res || [])
      })
    })
    if (rows.length) return rows[0]
  }

  if (cleanNo) {
    const sql = `SELECT e_msg FROM t_error_code_mapper WHERE e_no = ? ORDER BY id LIMIT 1`
    const rows = await new Promise((resolve, reject) => {
      db.query(sql, [cleanNo], (err, res) => {
        if (err) return reject(err)
        resolve(res || [])
      })
    })
    if (rows.length) return rows[0]
  }

  if (cleanType) {
    const sql = `SELECT e_msg FROM t_error_code_mapper WHERE type = ? ORDER BY id LIMIT 1`
    const rows = await new Promise((resolve, reject) => {
      db.query(sql, [cleanType], (err, res) => {
        if (err) return reject(err)
        resolve(res || [])
      })
    })
    if (rows.length) return rows[0]
  }

  return null
}

const getAllErrorMappings = async () => {
  const db = require("../db")
  const sql = `SELECT * FROM t_error_code_mapper ORDER BY id`
  return new Promise((resolve, reject) => {
    db.query(sql, (err, rows) => {
      if (err) return reject(err)
      resolve(rows || [])
    })
  })
}

module.exports = {
  DEFAULT_ERROR_MAPPINGS,
  buildEnsureErrorMessageTableSql,
  buildSeedErrorMessageMappingsSql,
  ensureErrorMessageMappings,
  fallbackErrorMessage,
  findErrorMessageMapping,
  getAllErrorMappings,
  resolveMappedErrorMessage,
}
