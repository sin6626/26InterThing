const { query } = require("./query")
const {
  buildCountPastRowsSql,
  buildLatestRealtimeRecordSql,
  buildPastRowsSql,
} = require("./dataRepositorySql")

// 读取页面可见字段定义，决定实时卡片和历史表格展示哪些字段。
const getVisibleFieldMapper = (tableprefix) => {
  const sql = `
    SELECT *
    FROM ${tableprefix}_field_mapper
    WHERE visible = '1'
    ORDER BY id
  `
  return query(sql)
}

// 图表只展示数值型字段，因此这里额外筛选 type = 1。
const getChartFieldMapper = (tableprefix) => {
  const sql = `
    select *
    from ${tableprefix}_field_mapper where visible = 1 and type = 1
  `
  return query(sql)
}

// 某些场景需要完整字段定义，例如历史数据表头和导出。
const getAllFieldMapper = (tableprefix) => {
  const sql = `select * from ${tableprefix}_field_mapper`
  return query(sql)
}

// 实时页只关心某台设备最近的一条采集记录。
const getLatestRealtimeRecord = (tableprefix, dNo) => {
  const sql = buildLatestRealtimeRecordSql(tableprefix)
  return query(sql, [dNo])
}

// 媒体资源单独存放在设备媒体表，优先取最新启用的一条。
const getLatestMedia = (deviceNo) => {
  const sql = `
    SELECT media_type, media_url, thumb_url
    FROM t_device_media
    WHERE device_no = ? AND is_active = 1
    ORDER BY id DESC
    LIMIT 1
  `
  return query(sql, [deviceNo])
}

// 图表 SQL 在 service 层按时间粒度动态生成，这里只负责执行。
const getChartRows = (sql, params) => query(sql, params)

// 历史列表分页前先统计总数，便于前端展示总页数。
const countPastRows = (tableprefix, dNo, timeSql, queryParams) => {
  const sql = buildCountPastRowsSql(tableprefix, Boolean(dNo), timeSql)

  return query(sql, queryParams)
}

// 历史数据查询与 count 共用同一套过滤条件，避免分页前后口径不一致。
const getPastRows = (tableprefix, dNo, timeSql, queryParams) => {
  const sql = buildPastRowsSql(tableprefix, Boolean(dNo), timeSql)

  return query(sql, queryParams)
}

// 错误记录来自独立表，所以这里直接拼接错误表查询条件。
const countErrorRows = (dNo, timeSql, queryParams) => {
  const sql = `select count(*) as total from t_error_msg where
    ${dNo ? "d_no = ?" : "1=1"}
    ${timeSql}`

  return query(sql, queryParams)
}

// 错误列表按设备编号和错误时间倒序展示，方便先看到最新异常。
const getErrorRows = (dNo, timeSql, queryParams) => {
  const sql = `select * from t_error_msg where
    ${dNo ? "d_no = ?" : "1=1"}
    ${timeSql}
    order by d_no, c_time desc
    limit ? offset ?`

  return query(sql, queryParams)
}

module.exports = {
  getAllFieldMapper,
  getChartFieldMapper,
  getChartRows,
  getErrorRows,
  getLatestMedia,
  getLatestRealtimeRecord,
  getPastRows,
  getVisibleFieldMapper,
  countErrorRows,
  countPastRows,
  buildCountPastRowsSql,
  buildLatestRealtimeRecordSql,
  buildPastRowsSql,
}
