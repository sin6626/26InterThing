const { query } = require("./query")
const {
  buildCountDirectHistorySql,
  buildDirectHistoryRowsSql,
  buildEnsureDirectHistoryTableSql,
} = require("./directHistorySql")

const ensureDirectHistoryTable = () => query(buildEnsureDirectHistoryTableSql())

const insertDirectHistory = ({
  config_id,
  d_no,
  direct_name,
  direct_type,
  new_value,
  old_value,
  remark,
  result = "success",
}) => {
  const sql = `
    insert into t_direct_history (
      direct_type, d_no, config_id, direct_name, old_value, new_value, result, remark
    ) values (?, ?, ?, ?, ?, ?, ?, ?)
  `

  return query(sql, [
    direct_type,
    d_no || null,
    config_id || null,
    direct_name || null,
    old_value ?? null,
    new_value ?? null,
    result,
    remark || null,
  ])
}

const buildHistoryTimeFilter = (startTime, endTime) => {
  const params = []
  let timeSql = ""

  if (startTime) {
    timeSql += " and operate_time >= ?"
    params.push(startTime)
  }

  if (endTime) {
    timeSql += " and operate_time <= ?"
    params.push(endTime)
  }

  return { params, timeSql }
}

const getDirectHistory = async ({
  direct_type,
  endTime,
  pagenum = 1,
  pagesize = 10,
  startTime,
}) => {
  const params = []
  if (direct_type) params.push(direct_type)

  const { params: timeParams, timeSql } = buildHistoryTimeFilter(startTime, endTime)
  params.push(...timeParams)

  const hasTypeFilter = Boolean(direct_type)
  const countRows = await query(
    buildCountDirectHistorySql({ hasTypeFilter, timeSql }),
    params,
  )

  const limit = Math.max(1, parseInt(pagesize, 10) || 10)
  const page = Math.max(1, parseInt(pagenum, 10) || 1)
  const rows = await query(
    buildDirectHistoryRowsSql({ hasTypeFilter, timeSql }),
    [...params, limit, (page - 1) * limit],
  )

  return {
    rows,
    total: countRows[0]?.total || 0,
  }
}

module.exports = {
  ensureDirectHistoryTable,
  getDirectHistory,
  insertDirectHistory,
}
