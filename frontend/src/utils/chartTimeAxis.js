/**
 * 将分钟级的时间值格式化为用于图表刻度显示的字符串。
 * - 如果与 `now` 是同一天：只显示小时和分钟 `HH:mm`；
 * - 如果不是同一天：显示 月-日 时:分 `MM-DD HH:mm`，便于区分日期。
 *
 * 参数说明：
 * - `value`：时间值，支持能被 `new Date(value)` 解析的格式（例如 ISO 字符串或时间戳）。
 * - `now`：可选的参考时间，默认使用当前时间，用于判断是否为同一天。
 */
export function formatMinuteAxisLabel(value, now = new Date()) {
  const d = new Date(value)
  const pad = (n) => String(n).padStart(2, '0')

  // 判断 value 与 now 是否为同一天（年/月/日 都相等）
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()

  if (sameDay) {
    // 同一天只显示 HH:mm，避免 x 轴标签冗余
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  // 不同日显示 MM-DD HH:mm，帮助用户识别跨天数据
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 为分钟分辨率的类目轴创建 ECharts 的 xAxis 配置对象。
 * 说明：使用 `xAxisData` 作为类目数据（category），这样每个数据点都会有对应的刻度位置。
 *
 * 返回的配置包含：
 * - `type: 'category'`：按类目轴显示（非时间轴），保证数据点逐个映射到刻度；
 * - `data: xAxisData`：刻度数据来源；
 * - `axisLabel.formatter`：使用 `formatMinuteAxisLabel` 对每个刻度进行友好格式化；
 * - `axisLabel.hideOverlap`：开启重叠隐藏，减少标签拥挤时的展示问题。
 */
export function createMinuteTimeAxis(xAxisData = []) {
  return {
    type: 'category',
    data: xAxisData,
    axisLabel: {
      hideOverlap: true,
      formatter: (value) => formatMinuteAxisLabel(value),
    },
  }
}
