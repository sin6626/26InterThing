const dataService = require("../services/dataService")

// 查询“某一类数据的最新一条”，给实时页右侧的信息卡片使用。
exports.realtime = async (req, res) => {
  try {
    const tableprefix = req.params.tableprefix
    const d_no = req.query.d_no || "202111"

    const result = await dataService.getRealtimeData(tableprefix, d_no)
    res.send(result)
  } catch (error) {
    res.cc(error)
  }
}

// 查询图表数据。
// 这里主要做参数整理，真正的 SQL 拼接和数据转换都放到 service 层。
exports.sensorChart = async (req, res) => {
  try {
    const tableprefix = req.params.tableprefix
    const result = await dataService.getSensorChartData(tableprefix, {
      dNo: req.query.d_no || "202111",
      endTime: req.query.endTime,
      limit: Math.max(
        10,
        Math.min(500, parseInt(req.query.limit || "200", 10) || 200),
      ),
      startTime: req.query.startTime,
    })

    res.send(result)
  } catch (error) {
    res.cc(error)
  }
}

// 查询分页历史数据。
exports.past = async (req, res) => {
  try {
    const result = await dataService.getPastData(req.params.tableprefix, req.query)
    res.send(result)
  } catch (error) {
    res.cc(error)
  }
}

// 查询错误记录分页数据。
exports.error = async (req, res) => {
  try {
    const result = await dataService.getErrorData(req.query)
    res.send(result)
  } catch (error) {
    res.cc(error)
  }
}
