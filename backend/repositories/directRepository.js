const { query } = require("./query")
const { buildDirectTypesSql } = require("./directRepositorySql")
const { ensureControlConfigSchema } = require("../services/controlConfigSchema")

// Repository 层只做一件事：封装和 t_direct / t_direct_config 相关的 SQL。
// 这样 service 层可以专心处理业务流程，不用直接拼数据库细节。

const globalSql = `
  SELECT
    c.id AS config_id,
    c.id,
    c.ref_id,
    c.ref_value,
    c.t_name,
    c.f_type,
    c.min,
    c.max,
    c.topic,
    c.publish_topic,
    c.payload_template,
    c.value_map,
    c.options,
    COALESCE(g.value, 'off') AS value,
    p.value AS papa_value
  FROM t_direct_config c
  LEFT JOIN t_direct_global g ON g.config_id = c.id
  LEFT JOIN t_direct_global p ON p.config_id = c.ref_id
  ORDER BY c.id
`

const deviceSql = `
  SELECT
    c.id AS config_id,
    c.id,
    c.ref_id,
    c.ref_value,
    c.t_name,
    c.f_type,
    c.min,
    c.max,
    c.topic,
    c.publish_topic,
    c.payload_template,
    c.value_map,
    c.options,
    COALESCE(d.value, g.value, 'off') AS value,
    d.value AS device_value,
    COALESCE(pd.value, pg.value) AS papa_value
  FROM t_direct_config c
  LEFT JOIN t_direct d ON d.config_id = c.id AND d.d_no = ?
  LEFT JOIN t_direct pd ON pd.config_id = c.ref_id AND pd.d_no = ?
  LEFT JOIN t_direct_global g ON g.config_id = c.id
  LEFT JOIN t_direct_global pg ON pg.config_id = c.ref_id
  ORDER BY c.id
`

// 查询“全局指令树”的原始行数据。
const getGlobalConfigRows = async () => {
  await ensureControlConfigSchema()
  return query(globalSql)
}

// 查询“某台设备的指令树”原始行数据。
const getDeviceConfigRows = async (dNo) => {
  await ensureControlConfigSchema()
  return query(deviceSql, [dNo, dNo])
}

const upsertGlobalDirect = (configId, value) => {
  // 全局指令值用 UPSERT，避免调用方先查再写。
  const sql = `
    INSERT INTO t_direct_global (config_id, value)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE value = VALUES(value)
  `

  return query(sql, [configId, value])
}

const updateDeviceDirectValue = (configId, value, dNo) => {
  // 单设备指令优先 update，如果 affectedRows=0，上层会再补一条 insert。
  const sql = `update t_direct set value = ? where config_id = ? and d_no = ?`
  return query(sql, [value, configId, dNo])
}

const insertDeviceDirectValue = (configId, value, dNo) => {
  const sql = `insert into t_direct (config_id, value, d_no) values (?, ?, ?)`
  return query(sql, [configId, value, dNo])
}

const getDirectConfigById = async (configId) => {
  await ensureControlConfigSchema()
  const sql = `select id, t_name, topic, publish_topic, payload_template, value_map from t_direct_config where id = ?`
  const rows = await query(sql, [configId])
  return rows[0] || null
}

const getGlobalDirectValue = async (configId) => {
  const sql = `select value from t_direct_global where config_id = ?`
  const rows = await query(sql, [configId])
  return rows[0]?.value ?? null
}

const getDeviceDirectValue = async (configId, dNo) => {
  const sql = `
    select COALESCE(d.value, g.value) as value
    from t_direct_config c
    left join t_direct d on d.config_id = c.id and d.d_no = ?
    left join t_direct_global g on g.config_id = c.id
    where c.id = ?
  `
  const rows = await query(sql, [dNo, configId])
  return rows[0]?.value ?? null
}

const getAllDeviceNumbers = async () => {
  // 全局指令需要知道“当前系统里有哪些设备”。
  const sql = `SELECT DISTINCT number FROM t_device WHERE number IS NOT NULL AND TRIM(number) <> ''`
  const rows = await query(sql)
  return rows.map((row) => row.number)
}

const getDirectTypes = async () => {
  return query(buildDirectTypesSql())
}

module.exports = {
  getAllDeviceNumbers,
  getDeviceDirectValue,
  getDeviceConfigRows,
  getDirectConfigById,
  getDirectTypes,
  getGlobalConfigRows,
  getGlobalDirectValue,
  insertDeviceDirectValue,
  updateDeviceDirectValue,
  upsertGlobalDirect,
}
