const deviceRuntimeService = require("../services/deviceRuntimeService")

exports.getRuntimeStatus = async (req, res) => {
  try {
    const dNo = String(req.params.d_no || "").trim()
    if (!dNo) return res.cc("设备编号不能为空")
    const data = deviceRuntimeService.getRuntimeStatus(dNo)
    res.send({
      status: 0,
      message: "查询成功",
      data,
    })
  } catch (error) {
    res.cc(error)
  }
}

exports.resetRuntime = async (req, res) => {
  try {
    const dNo = String(req.body?.d_no || "").trim()
    const type = String(req.body?.type || "all").trim()
    if (!dNo) return res.cc("设备编号不能为空")
    const result = await deviceRuntimeService.resetRuntime(dNo, type, "用户页面操作清零")
    res.send({
      status: 0,
      message: "累计运行时长已清零",
      data: result,
    })
  } catch (error) {
    res.cc(error)
  }
}
