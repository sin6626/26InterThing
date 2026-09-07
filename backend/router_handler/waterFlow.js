const waterFlowService = require("../services/waterFlowService")

exports.getWaterFlowStatus = async (req, res) => {
  try {
    const dNo = String(req.params.d_no || "").trim()
    if (!dNo) return res.cc("设备编号不能为空")
    const data = await waterFlowService.getFlowStatus(dNo)
    res.send({
      status: 0,
      message: "查询成功",
      data,
    })
  } catch (error) {
    res.cc(error)
  }
}

exports.resetWaterFlow = async (req, res) => {
  try {
    const dNo = String(req.body?.d_no || "").trim()
    if (!dNo) return res.cc("设备编号不能为空")
    const result = await waterFlowService.resetTotalVolume(dNo, "用户页面操作清零")
    res.send({
      status: 0,
      message: "累计总流量已清零",
      data: result,
    })
  } catch (error) {
    res.cc(error)
  }
}
