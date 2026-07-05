const { buildSensorChartSql } = require("../utils/sensorChartSql")
const { buildTimeSql } = require("../utils/timeQuery")
const dataRepository = require("../repositories/dataRepository")
const dataSerializer = require("../serializers/dataSerializer")

// 实时页接口：
// 组装“最新一条记录 + 字段映射 + 可选媒体信息”。
const getRealtimeData = async (tableprefix, dNo) => {
  const [metadataRows, realtimeRows] = await Promise.all([
    dataRepository.getVisibleFieldMapper(tableprefix),
    dataRepository.getLatestRealtimeRecord(tableprefix, dNo),
  ])

  // 某些设备可能带媒体表，但不是所有部署环境都有这张表，所以这里做容错。
  let media = null
  try {
    const mediaRows = await dataRepository.getLatestMedia(dNo)
    media = mediaRows && mediaRows.length > 0 ? mediaRows[0] : null
  } catch (error) {
    if (error.code !== "ER_NO_SUCH_TABLE") {
      throw error
    }
  }

  const latestData = realtimeRows[0] || null

  return {
    status: 0,
    message: latestData ? "查询成功" : "暂无实时数据",
    data: dataSerializer.buildRealtimeResponse({
      latestData,
      media,
      metadataRows,
    }),
  }
}

const getSensorChartData = async (tableprefix, {
  dNo,
  endTime,
  limit,
  startTime,
}) => {
  // 图表页的核心思路：
  // 先拿“哪些字段可以画图”，再按分钟聚合出趋势数据。
  const fieldMapper = await dataRepository.getChartFieldMapper(tableprefix)
  if (fieldMapper.length === 0) {
    return {
      status: 0,
      message: "查询成功",
      data: dataSerializer.buildEmptyChartResponse(dNo),
    }
  }

  // 根据字段映射动态拼 avg(fieldX) SQL，避免写死字段。
  const fieldAggSql = fieldMapper
    .map((item) => `round(avg(${item.db_name}), 2) as ${item.db_name}`)
    .join(", ")

  const { params: timeParams, timeSql } = buildTimeSql(startTime, endTime)
  const sql = buildSensorChartSql({
    tableprefix,
    fieldAggSql,
    timeSql,
  })

  const rows = await dataRepository.getChartRows(sql, [dNo, ...timeParams, limit])

  return {
    status: 0,
    message: "查询成功",
    data: dataSerializer.buildChartResponse(fieldMapper, rows, dNo),
  }
}

const getPastData = async (tableprefix, {
  d_no,
  endTime,
  pagenum,
  pagesize,
  startTime,
}) => {
  // 历史页的核心思路：
  // 先 count 再分页查 rows，最后统一走 serializer 转成前端表格格式。
  const fieldMapper = await dataRepository.getAllFieldMapper(tableprefix)
  if (fieldMapper.length === 0) {
    throw new Error("查询成功，但是没有数据")
  }

  const queryParams = []
  if (d_no) queryParams.push(d_no)

  const { params: timeParams, timeSql } = buildTimeSql(startTime, endTime)
  queryParams.push(...timeParams)

  const countResult = await dataRepository.countPastRows(
    tableprefix,
    d_no,
    timeSql,
    queryParams,
  )
  const total = countResult[0].total

  const offset = (parseInt(pagenum) - 1) * parseInt(pagesize)
  const rowParams = [...queryParams, parseInt(pagesize), offset]
  const rows = await dataRepository.getPastRows(
    tableprefix,
    d_no,
    timeSql,
    rowParams,
  )

  return {
    status: 0,
    message: "查询成功",
    data: rows.length ? dataSerializer.buildPastRows(rows, fieldMapper) : [],
    columns: dataSerializer.buildPastColumns(fieldMapper),
    total,
  }
}

const getErrorData = async ({
  d_no,
  endTime,
  pagenum,
  pagesize,
  startTime,
}) => {
  // 错误列表页和历史页模式一样：count + 分页 rows + serializer。
  const queryParams = []
  if (d_no) queryParams.push(d_no)

  const { params: timeParams, timeSql } = buildTimeSql(startTime, endTime)
  queryParams.push(...timeParams)

  const countResult = await dataRepository.countErrorRows(d_no, timeSql, queryParams)
  const total = countResult[0].total

  const offset = (parseInt(pagenum) - 1) * parseInt(pagesize)
  const rows = await dataRepository.getErrorRows(
    d_no,
    timeSql,
    [...queryParams, parseInt(pagesize), offset],
  )

  return {
    status: 0,
    message: "查询成功",
    data: rows.length ? dataSerializer.buildErrorRows(rows) : [],
    total,
  }
}

module.exports = {
  getErrorData,
  getPastData,
  getRealtimeData,
  getSensorChartData,
}
