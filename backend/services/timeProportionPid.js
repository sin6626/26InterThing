const { performance } = require('node:perf_hooks')

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

// 时间均为单调时钟毫秒；样本标识由引擎在收到有效 temp_out 时递增。
const createTimeProportionPid = ({ clock = () => performance.now() } = {}) => {
  let integral = 0
  let derivative = 0
  let lastMeasurement = null
  let lastSample = null
  let lastCalculation = null
  let windowStart = null
  let onMilliseconds = 0
  let output = 0
  let measurement = null
  let error = null
  let reason = null
  let windowReason = null
  let lastOff = clock()
  let windowMissed = false
  let calculationError = null
  let suppressed = false

  const reset = () => {
    integral = derivative = output = onMilliseconds = 0
    lastMeasurement = lastSample = lastCalculation = windowStart = measurement = error = null
    reason = null
    windowReason = null
    lastOff = clock()
    windowMissed = false
    calculationError = null
    suppressed = false
  }

  const markOff = () => { lastOff = clock() }
  const update = ({ value, sample, params }) => {
    const now = clock()
    // 超调检查不受一秒计算节流限制；立即废弃剩余脉冲。
    if (Number.isFinite(value)) {
      if (value >= params.target_temperature) {
        suppressed = true
        integral = output = onMilliseconds = 0
      } else if (suppressed && value <= params.target_temperature - (params.pid_resume_hysteresis ?? 0.3)) {
        suppressed = false
        // 保留窗口边界，本窗口不重开；下一窗口使用新的 PID 输出。
        lastCalculation = lastMeasurement = null
        derivative = 0
      }
      if (suppressed) {
        measurement = lastMeasurement = value
        error = params.target_temperature - value
        lastSample = sample
        lastCalculation = now
        derivative = 0
        return
      }
    }
    if (!Number.isFinite(value) || sample === lastSample
      || (lastCalculation !== null && now - lastCalculation < 1000)) return
    const dt = lastCalculation === null ? 0 : (now - lastCalculation) / 1000
    measurement = value
    error = params.target_temperature - value
    const p = params.pid_kp * error
    if (dt > 0) {
      const rawDerivative = -(value - lastMeasurement) / dt
      derivative += dt / (2 + dt) * (rawDerivative - derivative)
      const candidate = integral + params.pid_ki * error * dt
      const candidateOutput = p + candidate + params.pid_kd * derivative
      if ((candidateOutput >= 0 && candidateOutput <= 100)
        || (candidateOutput > 100 && error < 0)
        || (candidateOutput < 0 && error > 0)) integral = candidate
    }
    const rawOutput = p + integral + params.pid_kd * derivative
    calculationError = Number.isFinite(rawOutput) ? null : 'PID计算超出数值范围，请减小系数'
    output = calculationError ? 0 : clamp(rawOutput, 0, 100)
    lastMeasurement = value
    lastSample = sample
    lastCalculation = now
  }

  const schedule = (params, isOn = false) => {
    const now = clock()
    const period = params.pid_cycle_time * 1000
    const minOn = params.pid_min_on_time * 1000
    const minOff = params.pid_min_off_time * 1000
    if (windowStart === null || now >= windowStart + period) {
      windowStart = windowStart === null ? now : windowStart + Math.floor((now - windowStart) / period) * period
      onMilliseconds = period * output / 100
      reason = null
      windowMissed = false
      if (onMilliseconds > 0 && onMilliseconds < minOn) {
        onMilliseconds = 0
        reason = '开启脉冲短于最短开启时间，已舍弃'
      } else if (onMilliseconds < period && period - onMilliseconds < minOff) {
        onMilliseconds = period - minOff
        reason = '已缩短开启时间以保留最短关闭时间'
      }
      windowReason = reason
    }
    reason = windowReason
    const remainingOn = windowStart + onMilliseconds - now
    let desired = onMilliseconds > 0 && remainingOn > 0
    if (desired && !isOn && now - lastOff < minOff) {
      desired = false
      reason = '等待最短关闭时间'
    }
    if (desired && !isOn && remainingOn < minOn) {
      windowMissed = true
      reason = '剩余开启时间不足，跳过本窗口脉冲'
    }
    if (windowMissed) {
      desired = false
      reason = '剩余开启时间不足，跳过本窗口脉冲'
    }
    if (suppressed) {
      desired = false
      reason = '超调抑制：已关热，等待降至恢复温度'
    }
    return {
      target: params.target_temperature, measurement, error,
      output, plannedDuty: onMilliseconds / period * 100,
      windowRemaining: Math.max(0, (windowStart + period - now) / 1000),
      windowIndex: Math.floor(windowStart / period),
      desired: desired ? 'on' : 'off', limitationReason: reason,
      calculationError,
      suppressed, cutoffTemperature: params.target_temperature,
      resumeTemperature: params.target_temperature - (params.pid_resume_hysteresis ?? 0.3),
    }
  }
  return { update, schedule, reset, markOff }
}

module.exports = { createTimeProportionPid }
