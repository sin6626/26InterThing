// 默认错误码映射，包含水力联合诊断（过程一~四）及常规安全保护规则，供数据库未配置或首次初始化时幂等使用。
const DEFAULT_ERROR_MAPPINGS = [
  // 4.2 水力联合诊断规则
  { e_no: "HYDRAULIC_BLOCKAGE", type: "6", e_msg: "管路超压且流量不足，疑似管路堵塞或出口阻力过大" },
  { e_no: "HYDRAULIC_PUMP_ABNORMAL", type: "6", e_msg: "压力与流量偏低，疑似吸水口进气、缺水或水泵空转" },
  { e_no: "HYDRAULIC_SENSOR_ANOMALY", type: "3", e_msg: "管路压力正常但测得流量偏低，疑似流量计叶轮卡阻或异常" },
  { e_no: "HYDRAULIC_LEAK_OR_BURST", type: "6", e_msg: "平稳运行中压流双双骤降，疑似管路脱落或严重泄漏" },

  // 水循环常规安全保护规则
  { e_no: "OVER_PRESSURE", type: "6", e_msg: "管路超压急停保护" },
  { e_no: "OVER_TEMPERATURE", type: "6", e_msg: "水温超限散热保护" },
  { e_no: "LOW_FLOW", type: "6", e_msg: "失流干烧保护" },
  { e_no: "PUMP_IDLING", type: "6", e_msg: "水泵空转保护" },
  { e_no: "BUILD_FLOW_TIMEOUT", type: "6", e_msg: "启动建流超时(流速未达标禁止加热)" },
  { e_no: "SENSOR_FLOW_TIMEOUT", type: "3", e_msg: "流量传感器数据超时" },
  { e_no: "SENSOR_TEMPERATURE_TIMEOUT", type: "3", e_msg: "温度传感器数据超时" },
  { e_no: "SENSOR_PRESSURE_TIMEOUT", type: "3", e_msg: "压力传感器数据超时" },
  { e_no: "COMMAND_PUBLISH_FAILED", type: "2", e_msg: "控制指令发布超时" },
  { e_no: "E001", type: "3", e_msg: "温度传感器连接超时" },
  { e_no: "E002", type: "2", e_msg: "通信连接异常" },
  { e_no: 'CONTROL_CONFIG_INVALID', type: '6', e_msg: '控温配置无效，已停止加热，请修正参数并人工复位' },
  { e_no: "TEMP_SENSOR_REVERSED", type: "3", e_msg: "进出口温度传感器疑似装反" },
  { e_no: "DRY_HEATING_NO_TEMP_RISE", type: "6", e_msg: "加热异常干烧：加热开启后出口水温长时间无上升" },
]

// 短时内存缓存：缓存从数据库读取的完整错误映射列表，TTL 为 2 秒
let cachedMappings = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 2000

const clearErrorMappingCache = () => {
  cachedMappings = null
  cacheTimestamp = 0
}

// 错误码映射表用于把错误规则翻译成后台配置的错误编号、类型与中文语义。
const buildEnsureErrorMessageTableSql = () => `
  CREATE TABLE IF NOT EXISTS t_error_code_mapper (
    id INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    e_no VARCHAR(255) NOT NULL COMMENT '错误编号，例如 E001 或 HYDRAULIC_BLOCKAGE',
    type VARCHAR(16) NOT NULL COMMENT '错误类型码，例如 6 表示急停，3 表示传感器故障',
    e_msg VARCHAR(255) NOT NULL COMMENT '应用层映射出的中文错误信息',
    PRIMARY KEY (id),
    UNIQUE KEY uk_error_code_mapper (e_no, type)
  ) COMMENT='错误编号与错误类型到中文错误信息的映射表'
`

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

const getCachedErrorMappings = async () => {
  const now = Date.now()
  if (cachedMappings && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedMappings
  }
  try {
    const rows = await getAllErrorMappings()
    cachedMappings = rows
    cacheTimestamp = now
    return cachedMappings
  } catch (error) {
    console.error("[ErrorMessageMapping] 查询 t_error_code_mapper 失败:", error.message)
    return cachedMappings || DEFAULT_ERROR_MAPPINGS
  }
}

/**
 * 根据应用层触发的规则代码（如 HYDRAULIC_BLOCKAGE、HYDRAULIC_PUMP_ABNORMAL、OVER_PRESSURE 等）
 * 动态反查用户在后台配置的最新 e_no, type, e_msg。
 * 若用户在后台把 e_no 改成了 E101、修改了 type 或改写了中文错误描述，均以用户后台最新设置为准！
 */
const getRuleErrorMapping = async (ruleKey) => {
  if (!ruleKey) return { e_no: "UNKNOWN", type: "6", e_msg: "未知故障" }
  const cleanKey = String(ruleKey).trim()
  const mappings = await getCachedErrorMappings()

  // 优先按 e_no 精确匹配
  let matched = mappings.find((item) => String(item.e_no).trim() === cleanKey)

  // 若未直接匹配，在默认列表中查找该基准规则
  if (!matched) {
    const defaultItem = DEFAULT_ERROR_MAPPINGS.find((item) => item.e_no === cleanKey)
    if (defaultItem) {
      matched = defaultItem
    }
  }

  if (matched) {
    return {
      e_no: matched.e_no || cleanKey,
      type: String(matched.type || "6"),
      e_msg: matched.e_msg || fallbackErrorMessage({ e_no: cleanKey, type: matched.type }),
    }
  }

  return {
    e_no: cleanKey,
    type: "6",
    e_msg: fallbackErrorMessage({ e_no: cleanKey, type: "6" }),
  }
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

// 服务启动或脚本执行时，确保错误映射表就绪并幂等补齐缺失项（不覆盖用户已在后台改好的自定义配置）。
const ensureErrorMessageMappings = async () => {
  const db = require("../db")

  await new Promise((resolve, reject) => {
    db.query(buildEnsureErrorMessageTableSql(), (err) => {
      if (err) return reject(err)
      resolve()
    })
  })

  // 读取已有的映射记录
  const existingRows = await getAllErrorMappings().catch(() => [])
  const existingKeys = new Set(existingRows.map((r) => String(r.e_no).trim()))

  const missingMappings = DEFAULT_ERROR_MAPPINGS.filter((item) => !existingKeys.has(item.e_no))
  if (missingMappings.length > 0) {
    const valuesSql = missingMappings.map(() => "(?, ?, ?)").join(", ")
    const params = missingMappings.flatMap((item) => [item.e_no, item.type, item.e_msg])
    const sql = `INSERT INTO t_error_code_mapper (e_no, type, e_msg) VALUES ${valuesSql}`
    await new Promise((resolve, reject) => {
      db.query(sql, params, (err, result) => {
        if (err) return reject(err)
        resolve(result)
      })
    })
    console.log(`[ErrorMessageMapping] 已幂等补齐 ${missingMappings.length} 项水循环错误码语义映射`)
  }
  clearErrorMappingCache()
}

module.exports = {
  DEFAULT_ERROR_MAPPINGS,
  buildEnsureErrorMessageTableSql,
  buildSeedErrorMessageMappingsSql,
  clearErrorMappingCache,
  ensureErrorMessageMappings,
  fallbackErrorMessage,
  findErrorMessageMapping,
  getAllErrorMappings,
  getCachedErrorMappings,
  getRuleErrorMapping,
  resolveMappedErrorMessage,
}
