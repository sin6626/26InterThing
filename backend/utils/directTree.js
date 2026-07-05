// 把数据库里的原始配置值转换成前端控件更容易消费的类型。
const castForView = (item) => {
  const result = { ...item }

  if (result.f_type === "1") {
    // 开关控件在页面上使用布尔值，而数据库里存的是 on/off。
    result.value = result.value === "on"
  }

  if (result.f_type === "3") {
    // 数字输入框需要 number 类型，顺便把范围一起转换掉。
    result.value = Number(result.value)
    result.min = result.min == null ? null : Number(result.min)
    result.max = result.max == null ? null : Number(result.max)
  }

  if (result.f_type === "4") {
    // 时间控件里 off 表示“未启用”，前端用 null 来表示未选择。
    if (result.value === "off" || !result.value) {
      result.value = null
    }
  }

  if (result.f_type === "5" || result.f_type === "6") {
    // 单选/多选的 options 可能已经是数组，也可能仍是 JSON 字符串。
    if (Array.isArray(result.options)) {
      result.options = result.options
    } else if (typeof result.options === "string") {
      try {
        result.options = result.options ? JSON.parse(result.options) : []
      } catch {
        result.options = []
      }
    } else {
      result.options = []
    }

    if (
      result.f_type === "6" &&
      typeof result.value === "string" &&
      result.value
    ) {
      // 多选值在数据库里是逗号分隔字符串，页面上额外补一份数组形态。
      result.valueArr = result.value.split(",")
    } else {
      result.valueArr = []
    }
  }

  return result
}

// 根据 ref_id/config_id 递归构建树形指令结构，并按联动条件过滤子节点。
const buildTree = (list, rootId = null) => {
  return list
    .filter((item) => item.ref_id === rootId)
    .map(castForView)
    .filter((item) => {
      if (item.ref_value == null) return true
      return String(item.ref_value) === String(item.papa_value)
    })
    .map((item) => ({
      ...item,
      disabled: false,
      children: buildTree(list, item.config_id),
    }))
}

module.exports = {
  buildTree,
  castForView,
}
