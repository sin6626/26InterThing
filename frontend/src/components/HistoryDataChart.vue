<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { createMinuteTimeAxis } from '@/utils/chartTimeAxis'

// 历史趋势图是纯展示组件，外部负责传入时间轴和序列数据。
const props = defineProps({
  title: {
    type: String,
    default: '历史趋势图',
  },
  xAxisData: {
    type: Array,
    default: () => [],
  },
  seriesData: {
    type: Array,
    default: () => [],
  },
  maxPoints: {
    type: Number,
    default: 120,
  },
  chartType: {
    type: String,
    default: 'line',
  },
})

const chartRef = ref(null)
let chartInstance = null

// 最少保留 1 个点，避免出现空 slice 边界问题。
const take = computed(() => Math.max(1, Number(props.maxPoints) || 10))

const slicedXAxisData = computed(() => {
  const x = props.xAxisData || []
  return x.slice(Math.max(0, x.length - take.value))
})

// 只截取最近 N 个点，同时把单位拼到图例名称中。
const chartSeries = computed(() => {
  return (props.seriesData || []).map((item) => {
    const source = item.data || []
    const sliced = source.slice(Math.max(0, source.length - take.value))

    return {
      name: `${item.name}${item.unit ? `/${item.unit}` : ''}`,
      type: props.chartType,
      showSymbol: false,
      connectNulls: true,
      data: sliced.map((val) => val ?? null),
    }
  })
})

const option = computed(() => ({
  title: {
    text: props.title,
    left: 'center',
    top: 8,
    textStyle: {
      fontSize: 20,
      fontWeight: 600,
    },
  },
  tooltip: {
    trigger: 'axis',
  },
  legend: {
    top: 42,
    type: 'scroll',
  },
  grid: {
    top: 96,
    left: '3%',
    right: '4%',
    bottom: 40,
    containLabel: true,
  },
  xAxis: createMinuteTimeAxis(slicedXAxisData.value),
  yAxis: {
    type: 'value',
  },
  series: chartSeries.value,
}))

// 等待 DOM 刷新后再初始化/更新图表，避免容器尺寸还没稳定。
const renderChart = async () => {
  await nextTick()
  if (!chartRef.value) return

  if (!chartInstance) {
    chartInstance = echarts.init(chartRef.value)
  }

  chartInstance.setOption(option.value, true)
}

onMounted(() => {
  renderChart()
  window.addEventListener('resize', handleResize)
})

const handleResize = () => {
  chartInstance?.resize()
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
})

// 外部数据变化时直接整图重绘，逻辑最直观。
watch(option, () => {
  renderChart()
})
</script>

<template>
  <div class="history-chart-wrap">
    <div ref="chartRef" class="chart"></div>
    <div v-if="!chartSeries.length" class="empty-mask">
      <el-empty description="暂无图表数据" />
    </div>
  </div>
</template>

<style scoped>
.history-chart-wrap {
  margin-top: 20px;
  padding: 16px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
  position: relative;
}

.chart {
  width: 100%;
  height: 360px;
}

.empty-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.82);
}
</style>
