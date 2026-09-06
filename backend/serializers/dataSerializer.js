const dayjs = require("dayjs")
const { getVstatusLevel, VSTATUS_TEXT } = require("../constants/vstatus")

// 所有对外返回的时间统一整理成前端可直接显示的字符串格式。
const formatDateTime = (value) => {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : null
}

// metadata 描述“页面该怎么展示字段”，和具体数值分开返回。
const buildRealtimeMetadata = (metadataRows) => {
  return metadataRows.map((field) => ({
    f_name: field.f_name,
    unit: field.unit || "",
    db_name: field.db_name,
    p_name: field.p_name,
    visible: field.visible === "1",
  }))
}

// 实时值对象使用中文字段名，便于页面直接按名称渲染卡片。
const buildRealtimeValues = (metadataRows, latestData) => {
  if (!latestData) return {}

  const values = {
    编号: latestData.d_no || "暂无编号",
  }

  metadataRows.forEach((field) => {
    values[field.f_name] = latestData[field.db_name]
  })

  values["是否在线"] = latestData.online
  values["更新时间"] = formatDateTime(latestData.c_time) || "暂无更新时间"

  return values
}

// vstatus 是采集层状态码，这里补齐人类可读的等级和文字描述。
const buildVstatusPayload = (latestData) => {
  const latestVstatus = latestData ? (latestData.vstatus ?? 0) : null
  if (latestVstatus === null) {
    return { code: null, level: "unknown", text: "暂无状态" }
  }

  return {
    code: latestVstatus,
    level: getVstatusLevel(latestVstatus),
    text: VSTATUS_TEXT[latestVstatus] || `异常(${latestVstatus})`,
  }
}

// 实时页接口由字段描述、字段值、媒体资源、设备状态四部分组成。
const buildRealtimeResponse = ({
  latestData,
  media,
  metadataRows,
}) => {
  return {
    metadata: buildRealtimeMetadata(metadataRows),
    values: buildRealtimeValues(metadataRows, latestData),
    media: media || null,
    vstatus: buildVstatusPayload(latestData),
  }
}

// 图表查询通常按时间倒序取数，这里反转成前端绘图更自然的正序。
const buildChartResponse = (fieldMapper, sensorDataDesc, deviceNo) => {
  const sensorDataAsc = [...sensorDataDesc].reverse()
  const xAxisData = sensorDataAsc.map((row) =>
    dayjs(row.minute_time).format("YYYY-MM-DD HH:mm"),
  )

  const seriesData = fieldMapper.map((mapper) => ({
    name: mapper.f_name,
    unit: mapper.unit || "",
    db_name: mapper.db_name,
    data: sensorDataAsc.map((row) => row[mapper.db_name] ?? null),
  }))

  return {
    baseInfo: {
      编号: deviceNo,
      是否在线数据: "全部数据",
    },
    xAxisData,
    seriesData,
  }
}

// 没有数据时仍返回完整结构，避免前端做额外判空分支。
const buildEmptyChartResponse = (deviceNo) => {
  return {
    baseInfo: {
      编号: deviceNo,
      是否在线数据: "全部数据",
    },
    xAxisData: [],
    seriesData: [],
  }
}

// 历史数据表头由字段映射驱动，这样数据库改配置后页面能自动同步。
const buildPastColumns = (fieldMapper) => {
  return [
    {
      prop: "编号",
      label: "编号",
      visible: true,
      type: "string",
    },
    ...fieldMapper.map((item) => ({
      prop: item.f_name,
      label: item.f_name,
      unit: item.unit,
      p_name: item.p_name,
      type: item.type === 1 ? "number" : "string",
      visible: item.visible === 1,
      id: item.id,
    })),
    {
      prop: "数据状态",
      label: "状态",
      visible: true,
      type: "string",
      width: 100,
    },
    {
      prop: "是否在线",
      label: "是否在线",
      visible: true,
      type: "string",
    },
    {
      prop: "更新时间",
      label: "更新时间",
      visible: true,
      type: "datetime",
      width: 180,
    },
  ]
}

// 历史列表把数据库字段名转换成页面使用的中文列名。
const buildPastRows = (rows, fieldMapper) => {
  return rows.map((item) => {
    const row = {
      编号: item.d_no,
    }

    fieldMapper.forEach((field) => {
      row[field.f_name] = item[field.db_name]
    })

    const vstatusNum = Number(item.vstatus ?? 0)
    row["vstatus"] = vstatusNum
    row["数据状态"] = vstatusNum === 0 ? "正常" : "告警"
    row["是否在线"] = item.online
    row["更新时间"] = dayjs(item.c_time).format("YYYY-MM-DD HH:mm:ss")
    return row
  })
}

// 错误记录目前只需要补时间格式，不改动原始错误内容。
const buildErrorRows = (rows) => {
  return rows.map((item) => ({
    ...item,
    c_time: dayjs(item.c_time).format("YYYY-MM-DD HH:mm:ss"),
  }))
}

module.exports = {
  buildChartResponse,
  buildEmptyChartResponse,
  buildErrorRows,
  buildPastColumns,
  buildPastRows,
  buildRealtimeResponse,
  formatDateTime,
}
