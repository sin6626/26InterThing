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
  'min_operating_pressure',
  'pressure_flow_diagnosis_confirm_time',
  'pid_min_open_time',
  'pid_min_close_time',
  'pid_kp', 'pid_ki', 'pid_kd', 'pid_cycle_time', 'pid_min_on_time', 'pid_min_off_time',
  'pid_resume_hysteresis',
  'pid_overshoot_allowance',
  'pipe_inner_diameter',
  'device_offline_timeout',
])

const flattenTree = (nodes) => nodes.flatMap((node) => [node, ...flattenTree(node.children || [])])

export const validateControlValue = (data, tree) => {
  if (data.topic === 'temperature_control_strategy') {
    if (!['hysteresis', 'pid'].includes(data.value)) throw new Error('请选择有效的控温策略')
    return
  }
  if (!numericControlTopics.has(data.topic)) return
  const numericValue = Number(data.value)
  const gain = ['pid_kp', 'pid_ki', 'pid_kd', 'pid_overshoot_allowance'].includes(data.topic)
  if (data.value === null || data.value === '' || typeof data.value === 'boolean' || !Number.isFinite(numericValue) || (gain ? numericValue < 0 : numericValue <= 0)) {
    throw new Error(`${data.t_name || '控制参数'}必须是${gain ? '大于或等于0' : '大于0'}的数字`)
  }
  if (['pid_cycle_time', 'pid_min_on_time', 'pid_min_off_time', 'pid_min_open_time', 'pid_min_close_time'].includes(data.topic) && !Number.isSafeInteger(numericValue)) throw new Error('PID 时间必须是正整数秒')
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
  if ((values.pid_resume_hysteresis ?? 0.3) >= values.target_temperature) throw new Error('PID 恢复回差必须小于目标温度')
  const cycle = values.pid_cycle_time ?? 20
  const minOn = values.pid_min_on_time ?? values.pid_min_open_time ?? 3
  const minOff = values.pid_min_off_time ?? values.pid_min_close_time ?? 3
  if (cycle < minOn + minOff) throw new Error('PID 窗口必须至少为最短开启和关闭时间之和')
  if (
    Number.isFinite(values.max_safe_temperature)
    && Number.isFinite(values.target_temperature)
    && values.max_safe_temperature <= values.target_temperature
  ) {
    throw new Error('最高安全温度必须大于目标温度')
  }
  if (values.target_temperature + (values.pid_overshoot_allowance ?? 0.1) >= values.max_safe_temperature) throw new Error('PID 强制关热温度必须低于最高安全温度')
  if (
    Number.isFinite(values.temperature_hysteresis)
    && Number.isFinite(values.target_temperature)
    && values.temperature_hysteresis >= values.target_temperature
  ) {
    throw new Error('温度回差必须小于目标温度')
  }
  if (
    Number.isFinite(values.min_operating_pressure)
    && Number.isFinite(values.max_safe_pressure)
    && values.min_operating_pressure >= values.max_safe_pressure
  ) {
    throw new Error('参考最低压力必须小于最大安全压力')
  }
}

// 使用完整原始树做提交校验，只过滤渲染树，避免隐藏参数丢失。
export const filterControlTree = (tree) => {
  const rows = flattenTree(tree)
  const strategy = rows.find(row => row.topic === 'temperature_control_strategy')?.value || 'hysteresis'
  const canonical = new Set(rows.map(row => row.topic))
  const visible = row => {
    if (row.topic === 'temperature_hysteresis') return strategy !== 'pid'
    if (row.topic?.startsWith('pid_')) {
      if (row.topic === 'pid_min_open_time' && canonical.has('pid_min_on_time')) return false
      if (row.topic === 'pid_min_close_time' && canonical.has('pid_min_off_time')) return false
      return strategy === 'pid'
    }
    return true
  }
  const filter = nodes => nodes.filter(visible).map(node => ({ ...node, children: filter(node.children || []) }))
  return filter(tree)
}
