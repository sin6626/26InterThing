// 图表按分钟聚合，fieldAggSql 由上层按字段动态拼接 avg/max/min 等表达式。
function buildSensorChartSql({ tableprefix, fieldAggSql, timeSql, hasDeviceFilter = true }) {
  return `
      select
        date_format(c_time, '%Y-%m-%d %H:%i:00') AS minute_time,
        ${fieldAggSql}
      from ${tableprefix}_data
      where ${hasDeviceFilter ? "d_no = ?" : "1=1"}
        ${timeSql}
      group by minute_time
      order by minute_time desc
      limit ?;
    `
}

module.exports = {
  buildSensorChartSql,
}
