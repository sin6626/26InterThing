<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { getEchartsSensorByQuery, getSensorDataRealTime } from '@/api/sensor'
import { useDeviceNumbers } from '@/composables/useDeviceNumbers'
import { useSwitchStore } from '@/stores/switch'
import {
  applyMinuteRealtimeUpdate,
  resolveRealtimeValues,
} from '@/composables/useMinuteSeries'
import { createMinuteTimeAxis } from '@/utils/chartTimeAxis'
import { onRealtimeMessage, onWsLifecycle } from '@/utils/wsRealtime'


// 传感器实时页与行为实时页结构保持一致，只是字段映射不同。
const tablePrefix = 't_sensor'
const chartType = ref('line')
const selectedDeviceNo = ref('')
const chartPointLimit = ref(10)
const sensorData = ref({ values: {}, metadata: [], media: null })
const echartsData = ref({ xAxisData: [], seriesData: [], minuteStats: {} })
const previewVisible = ref(false)

const { numbers: deviceNumbers, fetchDeviceNumbers } = useDeviceNumbers()
const switchStore = useSwitchStore()

const chartRef = ref(null)
let chartInstance = null
let stopWsListen = null
let stopLifecycle = null

const mediaInfo = computed(() => sensorData.value.media || null)
const mediaIsVideo = computed(() => mediaInfo.value?.media_type === 'video')


// 设备推送时间字段名称可能不一致，这里统一压成分钟粒度。
const toMinuteLabel = (date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}


const resolveMinuteLabelFromPayload = (rawData) => {
  const candidates = [
    rawData?.c_time,
    rawData?.更新时间,
    rawData?.time,
    rawData?.timestamp,
    rawData?.ts,
  ]

  for (const value of candidates) {
    if (value === null || value === undefined || value === '') continue
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      date.setSeconds(0, 0)
      return toMinuteLabel(date)
    }

    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) {
      return value.slice(0, 16)
    }
  }

  const nowMinute = new Date()
  nowMinute.setSeconds(0, 0)
  return toMinuteLabel(nowMinute)
}


// 实时卡片按当前设备读取最新一条数据。
const fetchRealtime = async () => {
  const dNo = selectedDeviceNo.value || undefined
  const res = await getSensorDataRealTime(tablePrefix, dNo)
  sensorData.value = res.data || { values: {}, metadata: [], media: null }
}


// WebSocket 到来后只覆盖当前展示字段，不重拉整页数据。
const updateSensorData = (rawData) => {
  if (!rawData) return

  const { displayValues } = resolveRealtimeValues(rawData, sensorData.value.metadata)
  const currentValues = { ...sensorData.value.values, ...displayValues }

  // 更新在线状态和时间
  if (rawData.online !== undefined) currentValues['是否在线'] = rawData.online
  const updateTimeVal = rawData.c_time ?? rawData.time
  if (updateTimeVal !== undefined) currentValues['更新时间'] = updateTimeVal

  sensorData.value = {
    ...sensorData.value,
    values: currentValues,
  }
}

// 图表完整窗口先通过 HTTP 获取。
const fetchChartData = async () => {
  const dNo = selectedDeviceNo.value || undefined
  const res = await getEchartsSensorByQuery(tablePrefix, {
    d_no: dNo,
    limit: chartPointLimit.value,
  })
  echartsData.value = res.data || { xAxisData: [], seriesData: [], minuteStats: {} }
  if (!echartsData.value.minuteStats) echartsData.value.minuteStats = {}
}


// 把后端序列配置转换成 ECharts 需要的结构。
const getSeries = () => {
  return (echartsData.value.seriesData || []).map((item) => ({
    name: `${item.name}${item.unit ? `/${item.unit}` : ''}`,
    type: chartType.value,
    showSymbol: false,
    connectNulls: true,
    data: (item.data || []).map((val) => val ?? null),
  }))
}


// 新到一条实时数据后，把它推进当前分钟窗口。
const shiftSeriesWindow = (rawData) => {
  const minuteKey = resolveMinuteLabelFromPayload(rawData)
  const { databaseValues } = resolveRealtimeValues(rawData, sensorData.value.metadata)
  const valuesBySeriesName = {}
  for (const series of echartsData.value.seriesData) {
    const value = Number(databaseValues[series.db_name])
    if (databaseValues[series.db_name] !== null && Number.isFinite(value)) {
      valuesBySeriesName[series.name] = Number(value.toFixed(2))
    }
  }

  applyMinuteRealtimeUpdate(echartsData.value, { minuteKey, valuesBySeriesName, limit: 10 })
  renderChart()
}


// 图表实例只初始化一次，后续覆盖 option 即可。
const renderChart = () => {
  if (!chartRef.value) return
  if (!chartInstance) {
    chartInstance = echarts.init(chartRef.value)
  }

  chartInstance.setOption(
    {
      title: { text: '传感器实时趋势' },
      tooltip: { trigger: 'axis' },
      legend: { top: 44, type: 'scroll' },
      grid: { top: 108, left: '3%', right: '4%', bottom: 30, containLabel: true },
      xAxis: createMinuteTimeAxis(echartsData.value.xAxisData || []),
      yAxis: { type: 'value' },
      series: getSeries(),
    },
    true,
  )
}


// 页面初始化或切换设备时，同时刷新卡片和图表。
const loadAll = async () => {
  await Promise.all([fetchRealtime(), fetchChartData()])
  renderChart()
}


watch([chartType, chartPointLimit], async () => {
  await fetchChartData()
  renderChart()
})


watch(selectedDeviceNo, async () => {
  await loadAll()
})


watch(
  () => switchStore.value,
  async () => {
    await loadAll()
  },
)


onMounted(async () => {
  await fetchDeviceNumbers()
  if (deviceNumbers.value.length) {
    selectedDeviceNo.value = deviceNumbers.value[0].value
  }
  await loadAll()
  window.addEventListener('resize', handleResize)

  // 只消费当前选中设备的实时消息，避免多设备数据串图。
  stopWsListen = onRealtimeMessage('sensor_realtime', (payload) => {
    if (
      selectedDeviceNo.value &&
      String(payload?.d_no ?? payload?.编号) !== String(selectedDeviceNo.value)
    ) {
      return
    }
    shiftSeriesWindow(payload)
    updateSensorData(payload)
  })

  // 重连后主动补拉一次图表，弥补断线期间可能漏掉的数据点。
  stopLifecycle = onWsLifecycle((type) => {
    if (type === 'reconnected') {
      fetchChartData().then(() => renderChart())
    }
  })
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
  if (stopWsListen) {
    stopWsListen()
    stopWsListen = null
  }
  if (stopLifecycle) {
    stopLifecycle()
    stopLifecycle = null
  }
})
</script>

<template>
  <page-container title="实时数据">
    <template #extra>
      <div class="toolbar">
        <el-select
          v-if="switchStore.value"
          v-model="selectedDeviceNo"
          placeholder="请选择编号"
          clearable
          style="width: 150px"
        >
          <el-option
            v-for="item in deviceNumbers"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-select v-model="chartType" style="width: 140px">
          <el-option label="折线图" value="line" />
          <el-option label="柱状图" value="bar" />
          <el-option label="散点图" value="scatter" />
        </el-select>
      </div>
    </template>

    <el-descriptions :column="3" border>
      <el-descriptions-item label="储运厢编号">
        <el-tag>{{ sensorData.values['编号'] || selectedDeviceNo || '暂无' }}</el-tag>
      </el-descriptions-item>

      <el-descriptions-item
        v-for="item in sensorData.metadata"
        :key="item.f_name"
        :label="`${item.f_name}${item.unit ? `/${item.unit}` : ''}`"
      >
        <el-tag>{{ sensorData.values[item.f_name] ?? '暂无' }}</el-tag>
      </el-descriptions-item>

      <el-descriptions-item label="是否在线">
        <el-tag>{{ sensorData.values['是否在线'] || '未启用心跳' }}</el-tag>
      </el-descriptions-item>

      <el-descriptions-item label="更新时间">
        <el-tag>{{ sensorData.values['更新时间'] || '暂无' }}</el-tag>
      </el-descriptions-item>

      <el-descriptions-item v-if="false" label="视频或图片">
        <div v-if="mediaInfo" class="media-cell">
          <el-image
            v-if="!mediaIsVideo"
            :src="mediaInfo.thumb_url || mediaInfo.media_url"
            :preview-src-list="[mediaInfo.media_url]"
            fit="cover"
            class="media-thumb"
          />
          <video
            v-else
            class="media-thumb"
            :src="mediaInfo.media_url"
            muted
            playsinline
            @click="previewVisible = true"
          />
        </div>
        <span v-else>暂无媒体数据</span>
      </el-descriptions-item>
    </el-descriptions>

    <div class="chart-container">
      <div ref="chartRef" class="chart"></div>
      <el-empty v-if="!(echartsData.xAxisData || []).length" description="暂无图表数据" />
    </div>

    <el-dialog v-model="previewVisible" title="视频预览" width="70%">
      <video
        v-if="mediaIsVideo && mediaInfo"
        :src="mediaInfo.media_url"
        controls
        autoplay
        style="width: 100%"
      />
    </el-dialog>
  </page-container>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chart-container {
  margin-top: 20px;
  width: 100%;
  height: 500px;
}

.chart {
  width: 100%;
  height: 100%;
}

.media-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 64px;
}

.media-thumb {
  width: 84px;
  height: 52px;
  border-radius: 6px;
  object-fit: cover;
  cursor: pointer;
}

:deep(.el-descriptions__cell) {
  min-width: 0;
  height: 72px;
  box-sizing: border-box;
}

:deep(.el-descriptions__content) {
  width: 100%;
  height: 72px;
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
}

:deep(.el-descriptions__label) {
  height: 72px;
  vertical-align: middle;
}
</style>
