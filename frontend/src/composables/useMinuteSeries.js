/**
 * 分钟桶实时更新算法（minute-bucket realtime update）
 *
 * state 的结构：
 * {
 *   xAxisData: string[],            // 分钟键数组，例："2026-05-18 14:30"，用于图表的 x 轴
 *   seriesData: [{ name, data }],   // 每个序列的名字和对应的数据数组，data 与 xAxisData 平行
 *   minuteStats: {}                 // 每分钟的聚合统计：{ [minuteKey]: { [seriesName]: { sum, count } } }
 * }
 *
 * 该函数的目标：将一批来自某分钟的实时值合并到 state 中，
 * 对每个序列保持按分钟的平均值，并维持一个固定长度的滚动窗口（limit）。
 */

// 在 xAxisData 中查找 minuteKey 的索引，找不到返回 -1
function findIndex(xAxisData, minuteKey) {
  for (let i = 0; i < xAxisData.length; i++) {
    if (xAxisData[i] === minuteKey) return i
  }
  return -1
}

export function applyMinuteRealtimeUpdate(state, { minuteKey, valuesBySeriesName, limit = 60 }) {
  const { xAxisData, seriesData, minuteStats } = state

  // 这里假定 minuteKey 使用 "YYYY-MM-DD HH:mm" 格式，才能直接按字符串比较先后。

  // 确保 minuteStats 有对应的桶对象用于存放本分钟的统计信息
  if (!minuteStats[minuteKey]) {
    minuteStats[minuteKey] = {}
  }

  const idx = findIndex(xAxisData, minuteKey)

  if (idx === -1) {
    // 未见过该 minuteKey：需要确定是否插入或丢弃（如果数据包过期）
    // 如果已有数据且最后一个 key 比当前 key 更大，说明这是一个较旧的数据包，舍弃它
    if (xAxisData.length > 0 && minuteKey < xAxisData[xAxisData.length - 1]) {
      return state
    }

    // 在末尾追加新的分钟键
    xAxisData.push(minuteKey)

    // 对每个传入序列的值，更新 minuteStats 并把当前分钟的平均值推入 series.data
    for (const [name, value] of Object.entries(valuesBySeriesName)) {
      // 找到对应的序列对象，若不存在则新建并加入 seriesData
      let series = seriesData.find((s) => s.name === name)
      if (!series) {
        series = { name, data: [] }
        seriesData.push(series)
      }

      // 初始化该分钟对应序列的统计（sum, count）
      const stats = minuteStats[minuteKey]
      if (!stats[name]) {
        stats[name] = { sum: 0, count: 0 }
      }
      // 累加并计算平均值，存入 series.data 的新位置
      stats[name].sum += value
      stats[name].count += 1
      series.data.push(stats[name].sum / stats[name].count)
    }

    // 对于没有在此次更新中出现的其他序列，需要在新位置填充 null 以保持数组长度对齐
    const newIdx = xAxisData.length - 1
    for (const series of seriesData) {
      if (!(series.name in valuesBySeriesName) && series.data.length <= newIdx) {
        series.data.push(null)
      }
    }
  } else {
    // minuteKey 已存在：在原位置就地更新（以平均值的方式累加）
    for (const [name, value] of Object.entries(valuesBySeriesName)) {
      let series = seriesData.find((s) => s.name === name)
      if (!series) {
        // 若序列之前不存在，则创建并使用 null 回填已有历史位置以对齐长度
        series = { name, data: [] }
        seriesData.push(series)
        for (let i = 0; i < xAxisData.length; i++) {
          series.data.push(null)
        }
      }

      // 更新该分钟的聚合统计并重新计算平均值，写回对应索引
      const stats = minuteStats[minuteKey]
      if (!stats[name]) {
        stats[name] = { sum: 0, count: 0 }
      }
      stats[name].sum += value
      stats[name].count += 1
      series.data[idx] = stats[name].sum / stats[name].count
    }
  }

  // 滚动窗口上限：当 xAxisData 超过 limit 时，从头部删除最老的一项，同时清理 minuteStats 并让每个序列移除对应的数据位
  while (xAxisData.length > limit) {
    const removedKey = xAxisData.shift()
    delete minuteStats[removedKey]
    for (const series of seriesData) {
      series.data.shift()
    }
  }

  return state
}
