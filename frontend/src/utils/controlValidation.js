export const numericControlTopics = new Set([
  'target_temperature',
  'temperature_hysteresis',
  'min_safe_flow',
  'max_safe_pressure',
  'max_safe_temperature',
  'build_flow_timeout',
  'low_flow_confirm_time',
  'cooling_delay',
  'data_timeout',
  'command_timeout',
])

const flattenTree = (nodes) => nodes.flatMap((node) => [node, ...flattenTree(node.children || [])])

export const validateControlValue = (data, tree) => {
  if (!numericControlTopics.has(data.topic)) return
  const numericValue = Number(data.value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error(`${data.t_name || '控制参数'}必须是大于0的数字`)
  }
  const min = Number(data.min)
  const max = Number(data.max)
  if (data.min !== null && data.min !== '' && Number.isFinite(min) && numericValue < min) {
    throw new Error(`${data.t_name}不能小于${min}`)
  }
  if (data.max !== null && data.max !== '' && Number.isFinite(max) && numericValue > max) {
    throw new Error(`${data.t_name}不能大于${max}`)
  }

  const values = Object.fromEntries(
    flattenTree(tree)
      .filter((node) => numericControlTopics.has(node.topic))
      .map((node) => [node.topic, Number(node.value)]),
  )
  values[data.topic] = numericValue
  if (
    Number.isFinite(values.max_safe_temperature)
    && Number.isFinite(values.target_temperature)
    && values.max_safe_temperature <= values.target_temperature
  ) {
    throw new Error('最高安全温度必须大于目标温度')
  }
  if (
    Number.isFinite(values.temperature_hysteresis)
    && Number.isFinite(values.target_temperature)
    && values.temperature_hysteresis >= values.target_temperature
  ) {
    throw new Error('温度回差必须小于目标温度')
  }
}
