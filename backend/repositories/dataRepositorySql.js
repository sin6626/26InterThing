// 实时页只取最新一条记录，避免把历史数据拉回应用层再筛选。
const buildLatestRealtimeRecordSql = (tableprefix) => {
  return `
    SELECT *
    FROM ${tableprefix}_data
    WHERE d_no = ?
    ORDER BY c_time DESC
    LIMIT 1
  `
}

// 历史分页查询与 count 查询共用同一套 where 条件生成规则。
const buildCountPastRowsSql = (tableprefix, hasDeviceFilter, timeSql) => {
  return `select count(*) as total from ${tableprefix}_data where
    ${hasDeviceFilter ? "d_no = ?" : "d_no = '202111' "}
    ${timeSql}`
}

// 历史列表按设备编号和采集时间倒序，便于优先看到最新数据。
const buildPastRowsSql = (tableprefix, hasDeviceFilter, timeSql) => {
  return `select * from ${tableprefix}_data where
    ${hasDeviceFilter ? "d_no = ?" : "1=1"}
    ${timeSql}
    order by d_no, c_time desc
    limit ? offset ?`
}

module.exports = {
  buildCountPastRowsSql,
  buildLatestRealtimeRecordSql,
  buildPastRowsSql,
}
