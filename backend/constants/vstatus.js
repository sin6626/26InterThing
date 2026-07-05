// 收集层上报码与应用层展示文案的统一映射。
const VSTATUS_TEXT = {
  0: "正常",
  1: "一般告警",
  2: "通信异常",
  3: "传感器故障",
  4: "空调故障",
  5: "风机故障",
  6: "断电超时",
  7: "危险气体/湿度超标",
}

// 页面目前只区分正常 / 预警 / 错误三级，用于控制颜色和强调程度。
const getVstatusLevel = (code) => {
  if (code === 0) return "normal"
  if (code === 1) return "warning"
  return "error"
}

module.exports = {
  VSTATUS_TEXT,
  getVstatusLevel,
}
