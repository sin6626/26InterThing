// 统一拼装时间筛选 SQL，避免多个查询各自手写 start/end 判断。
const buildTimeSql = (startTime, endTime) => {
  const params = []
  let timeSql = ""

  if (startTime && !endTime) {
    timeSql = "and c_time >= ?"
    params.push(startTime)
  } else if (!startTime && endTime) {
    timeSql = "and c_time <= ?"
    params.push(endTime)
  } else if (startTime && endTime) {
    timeSql = "and c_time >= ? and c_time <= ?"
    params.push(startTime, endTime)
  }

  return {
    params,
    timeSql,
  }
}

module.exports = {
  buildTimeSql,
}
