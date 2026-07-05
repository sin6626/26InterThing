const { VSTATUS_TEXT } = require("../constants/vstatus")

// 默认错误码映射，保证在数据库还没手工维护前也能给出基础中文提示。
const DEFAULT_ERROR_MAPPINGS = [
  { e_no: "E001", type: "3", e_msg: "温度传感器连接超时" },
  { e_no: "E002", type: "2", e_msg: "通信连接异常" },
  { e_no: "E003", type: "4", e_msg: "空调运行异常" },
  { e_no: "E004", type: "5", e_msg: "风机运行异常" },
  { e_no: "E005", type: "6", e_msg: "设备断电超时" },
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
  const mappedByType = VSTATUS_TEXT[Number.parseInt(type, 10)]
  if (mappedByType) {
    return mappedByType
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

  const row = await findMapping(String(e_no ?? "").trim(), String(type ?? "").trim())
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
  const sql = `SELECT e_msg FROM t_error_code_mapper WHERE e_no = ? AND type = ? LIMIT 1`
  return new Promise((resolve, reject) => {
    db.query(sql, [e_no, type], (err, rows) => {
      if (err) {
        reject(err)
        return
      }
      resolve(rows?.[0] || null)
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
  resolveMappedErrorMessage,
}
