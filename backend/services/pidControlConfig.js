const PID_DEFAULTS = {
  temperature_control_strategy: 'hysteresis',
  pid_kp: 0, pid_ki: 0, pid_kd: 0,
  pid_cycle_time: 20, pid_min_on_time: 3, pid_min_off_time: 3,
  pid_resume_hysteresis: 0.3,
}
const PID_ALIASES = { pid_min_open_time: 'pid_min_on_time', pid_min_close_time: 'pid_min_off_time' }
const canonicalTopic = (topic) => PID_ALIASES[topic] || topic
const isPidConfig = (topic) => Object.hasOwn(PID_DEFAULTS, canonicalTopic(topic))
const numberValue = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
  ? Number(value) : NaN

const readControlParams = (rows, defaults) => {
  const params = { ...defaults, ...PID_DEFAULTS }
  const values = new Map(rows.map(row => [row.topic, row.value]))
  for (const [alias, canonical] of Object.entries(PID_ALIASES)) {
    if (!values.has(canonical) && values.has(alias)) values.set(canonical, values.get(alias))
  }
  for (const key of Object.keys(params)) {
    if (values.has(key)) params[key] = key === 'temperature_control_strategy' ? values.get(key) : numberValue(values.get(key))
  }
  return params
}

const validateControlParams = (params, { starting = false } = {}) => {
  if (!['hysteresis', 'pid'].includes(params.temperature_control_strategy)) return '控温策略必须为 hysteresis 或 pid'
  for (const [key, value] of Object.entries(params)) {
    if (key === 'temperature_control_strategy') continue
    const isGain = ['pid_kp', 'pid_ki', 'pid_kd'].includes(key)
    if (!Number.isFinite(value) || (isGain ? value < 0 : value <= 0)) return `${key} 必须是${isGain ? '非负' : '正'}有限数字`
  }
  for (const key of ['pid_cycle_time', 'pid_min_on_time', 'pid_min_off_time']) {
    if (!Number.isSafeInteger(params[key])) return `${key} 必须是正整数秒`
  }
  if (params.pid_cycle_time < params.pid_min_on_time + params.pid_min_off_time) return 'PID 窗口必须至少为最短开启和关闭时间之和'
  if (params.target_temperature >= params.max_safe_temperature) return '目标温度必须低于最高安全温度'
  if (params.pid_resume_hysteresis >= params.target_temperature) return 'PID 恢复回差必须小于目标温度'
  if (params.temperature_hysteresis >= params.target_temperature) return '温度回差必须小于目标温度'
  if (params.min_operating_pressure >= params.max_safe_pressure) return '参考最低压力必须小于最大安全压力'
  if (starting && params.temperature_control_strategy === 'pid' && params.pid_kp <= 0) return 'PID 尚未整定：启动前必须设置 Kp > 0'
  return null
}

const controlFingerprint = params => JSON.stringify([
  params.target_temperature, ...Object.keys(PID_DEFAULTS).map(key => params[key]),
])

module.exports = { PID_DEFAULTS, PID_ALIASES, canonicalTopic, isPidConfig, readControlParams, validateControlParams, controlFingerprint }
