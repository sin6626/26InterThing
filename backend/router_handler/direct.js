// 直控页面相关接口处理器，只负责参数兜底和响应格式，
// 具体业务逻辑统一交给 directService。
const directService = require("../services/directService")

exports.direct = async (req, res) => {
  try {
    // 设备编号为空时直接拦截，避免 service 层继续查询无效数据。
    const dNo = String(req.params.d_no || "").trim()
    if (!dNo) return res.cc("设备编号不能为空")

    const data = await directService.getDirectTrees(dNo)
    res.send({
      status: 0,
      message: "查询成功",
      data,
    })
  } catch (error) {
    res.cc(error)
  }
}

exports.updateGlobalDirect = async (req, res) => {
  try {
    // 全局指令会同时更新数据库默认值，并触发 MQTT 广播下发。
    await directService.updateGlobalDirect(req.body)
    res.send({
      status: 0,
      message: "全局指令更新成功",
    })
  } catch (error) {
    res.cc(error)
  }
}

exports.updateDirect = async (req, res) => {
  try {
    // 单设备更新只作用于当前设备，并沿用统一的下发流程。
    await directService.updateDeviceDirect(req.params.d_no, req.body)
    res.send({
      status: 0,
      message: "更新成功",
    })
  } catch (error) {
    res.cc(error)
  }
}

exports.updateTime = async (req, res) => {
  try {
    // 手动更新时间允许页面传入指定时间；真正的格式转换在 service 层完成。
    await directService.updateTime(req.body?.time)
    res.send({
      status: 0,
      message: "更新成功",
    })
  } catch (error) {
    res.cc(error)
  }
}

exports.history = async (req, res) => {
  try {
    const data = await directService.getDirectHistory(req.query)
    res.send(data)
  } catch (error) {
    res.cc(error)
  }
}

exports.types = async (req, res) => {
  try {
    const data = await directService.getDirectTypes()
    res.send(data)
  } catch (error) {
    res.cc(error)
  }
}
