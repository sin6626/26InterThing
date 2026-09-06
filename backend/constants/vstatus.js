// 收集层基础状态码与应用层展示文案的通用映射。
const VSTATUS_TEXT = {
  0: "正常",
  1: "一般告警",
  2: "通信异常",
  3: "传感器故障",
  6: "安全保护告警",
}

// 页面区分 normal / warning / error 三级，用于控制颜色和强调程度。
const getVstatusLevel = (code) => {
  const numericCode = Number.parseInt(code, 10)
  if (Number.isNaN(numericCode) || numericCode === 0) return "normal"
  if (numericCode === 1) return "warning"
  return "error"
}

module.exports = {
  VSTATUS_TEXT,
  getVstatusLevel,
}

