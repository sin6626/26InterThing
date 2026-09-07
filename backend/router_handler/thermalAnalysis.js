const thermalAnalysisService = require("../services/thermalAnalysisService")

exports.getThermalStatus = async (req, res) => {
  try {
    const dNo = String(req.params.d_no || "").trim()
    if (!dNo) return res.cc("设备编号不能为空")
    const data = await thermalAnalysisService.getThermalStatus(dNo)
    res.send({
      status: 0,
      message: "查询成功",
      data,
    })
  } catch (error) {
    res.cc(error)
  }
}
