<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getEchartsSensorByQuery,
  getSensorDataRealTime,
  getThermalStatus,
  getWaterFlowStatus,
  resetWaterFlow,
} from '@/api/sensor'
import { useDeviceNumbers } from '@/composables/useDeviceNumbers'
import { useDeviceStatus } from '@/composables/useDeviceStatus'
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
const { deviceStatusMap } = useDeviceStatus()
const switchStore = useSwitchStore()

const currentHydraulicDiagnosis = computed(() => {
  const dNo = selectedDeviceNo.value || Object.keys(deviceStatusMap.value)[0] || ''
  return deviceStatusMap.value[dNo]?.control?.hydraulicDiagnosis || null
})

const getDiagnosisTagType = (level) => {
  if (level === 'error') return 'danger'
  if (level === 'warning') return 'warning'
  if (level === 'success') return 'success'
  return 'info'
}

const chartRef = ref(null)
let chartInstance = null
let stopWsListen = null
let stopLifecycle = null

// 水循环水流与累计总流量状态 (大纲 4.1 节)
const flowStatus = ref({
  flow_rate: 0,
  flow_velocity: null,
  velocity_status: 'unconfigured',
  pipe_inner_diameter: null,
  total_volume: 0,
})
const flowChartRef = ref(null)
let flowChartInstance = null
let stopWsFlowListen = null
const flowChartLimit = 30
const flowChartData = ref({
  times: [],
  flowRates: [],
  velocities: [],
  totalVolumes: [],
})

// 水循环热工效能分析状态 (大纲 4.3 节)
const thermalStatus = ref({
  temperature_difference: 0,
  heat_transfer_difference: 0,
  heating_rate: 0,
  heating_rate_out: 0,
  estimated_thermal_power: 0,
  power_status: 'pump_off',
  power_status_text: '水泵未开启',
})
const thermalChartRef = ref(null)
let thermalChartInstance = null
let stopWsThermalListen = null
const thermalChartLimit = 30
const thermalChartData = ref({
  times: [],
  tempIns: [],
  tempOuts: [],
  tempDiffs: [],
  powers: [],
})

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
    false,
  )
}


// 渲染水流分析 ECharts 图表
const renderFlowChart = () => {
  if (!flowChartRef.value) return
  if (!flowChartInstance) {
    flowChartInstance = echarts.init(flowChartRef.value)
  }

  const subtext = flowStatus.value.pipe_inner_diameter
    ? `水管内径: ${flowStatus.value.pipe_inner_diameter} mm`
    : '提示：未配置水管内径时暂不计算流速'

  flowChartInstance.setOption(
    {
      title: {
        text: '水流动态与累计流量分析',
        subtext,
        textStyle: { fontSize: 16, fontWeight: 600 },
        subtextStyle: { fontSize: 12, color: '#909399' },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
      },
      legend: {
        top: 56,
        data: ['瞬时流量 (L/min)', '管内流速 (m/s)', '累计总流量 (L)'],
      },
      grid: {
        top: 105,
        left: '3%',
        right: '4%',
        bottom: 30,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: flowChartData.value.times,
      },
      yAxis: [
        {
          type: 'value',
          name: '流量 / 流速',
          position: 'left',
          splitLine: { lineStyle: { type: 'dashed' } },
        },
        {
          type: 'value',
          name: '累计量 (L)',
          position: 'right',
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '瞬时流量 (L/min)',
          type: 'line',
          smooth: true,
          showSymbol: false,
          itemStyle: { color: '#0284c7' },
          lineStyle: { width: 2 },
          data: flowChartData.value.flowRates,
        },
        {
          name: '管内流速 (m/s)',
          type: 'line',
          smooth: true,
          showSymbol: false,
          connectNulls: false,
          itemStyle: { color: '#10b981' },
          lineStyle: { width: 2 },
          data: flowChartData.value.velocities,
        },
        {
          name: '累计总流量 (L)',
          type: 'line',
          smooth: true,
          showSymbol: false,
          yAxisIndex: 1,
          itemStyle: { color: '#f97316' },
          lineStyle: { width: 2.5 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(249, 115, 22, 0.25)' },
              { offset: 1, color: 'rgba(249, 115, 22, 0.02)' },
            ]),
          },
          data: flowChartData.value.totalVolumes,
        },
      ],
    },
    false,
  )
}

// 获取当前设备水流与累计流量状态
const fetchFlowStatus = async () => {
  const dNo = selectedDeviceNo.value || undefined
  if (!dNo) return
  try {
    const res = await getWaterFlowStatus(dNo)
    if (res.data) {
      flowStatus.value = res.data
    }
  } catch {
    // 忽略获取失败
  }
}

// 累计总流量清零二次确认与调用
const handleResetFlow = async () => {
  const dNo = selectedDeviceNo.value || sensorData.value.values['编号']
  if (!dNo) {
    ElMessage.warning('请先选择设备编号')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定要将设备【${dNo}】的累计总流量清零吗？此操作将记录到操作历史中，不可撤销。`,
      '累计流量清零二次确认',
      {
        confirmButtonText: '确定清零',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    const res = await resetWaterFlow(dNo)
    if (res.data) {
      flowStatus.value = res.data
      if (flowChartData.value.totalVolumes.length) {
        flowChartData.value.totalVolumes[flowChartData.value.totalVolumes.length - 1] = 0
        renderFlowChart()
      }
    }
    ElMessage.success('累计总流量已成功清零')
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error(err.response?.data?.message || err.message || '清零操作失败')
    }
  }
}

// 推入水流与累计数据点
const pushFlowPoint = (payload) => {
  const timeStr = payload.updated_at
    ? new Date(payload.updated_at).toLocaleTimeString('zh-CN', { hour12: false })
    : new Date().toLocaleTimeString('zh-CN', { hour12: false })

  const d = flowChartData.value
  d.times.push(timeStr)
  d.flowRates.push(payload.flow_rate ?? 0)
  d.velocities.push(payload.flow_velocity ?? null)
  d.totalVolumes.push(payload.total_volume ?? 0)

  if (d.times.length > flowChartLimit) {
    d.times.shift()
    d.flowRates.shift()
    d.velocities.shift()
    d.totalVolumes.shift()
  }

  renderFlowChart()
}

// 渲染热工效能与热传递分析 ECharts 图表 (大纲 4.3 节)
const renderThermalChart = () => {
  if (!thermalChartRef.value) return
  if (!thermalChartInstance) {
    thermalChartInstance = echarts.init(thermalChartRef.value)
  }

  const subtext = `水箱A升温速: ${thermalStatus.value.heating_rate ?? 0} ℃/min | 工况: ${thermalStatus.value.power_status_text || '正常'}`

  thermalChartInstance.setOption(
    {
      title: {
        text: '热工效能与热传递分析',
        subtext,
        textStyle: { fontSize: 16, fontWeight: 600 },
        subtextStyle: { fontSize: 12, color: '#909399' },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
      },
      legend: {
        top: 56,
        data: ['水箱A温度 (℃)', '水箱B温度 (℃)', '两水箱温差 (℃)', '估算热传递功率 (W)'],
      },
      grid: {
        top: 105,
        left: '3%',
        right: '4%',
        bottom: 30,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: thermalChartData.value.times,
      },
      yAxis: [
        {
          type: 'value',
          name: '温度 / 温差 (℃)',
          position: 'left',
          splitLine: { lineStyle: { type: 'dashed' } },
        },
        {
          type: 'value',
          name: '热传递功率 (W)',
          position: 'right',
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '水箱A温度 (℃)',
          type: 'line',
          smooth: true,
          showSymbol: false,
          itemStyle: { color: '#f97316' },
          lineStyle: { width: 2 },
          data: thermalChartData.value.tempIns,
        },
        {
          name: '水箱B温度 (℃)',
          type: 'line',
          smooth: true,
          showSymbol: false,
          itemStyle: { color: '#0284c7' },
          lineStyle: { width: 2 },
          data: thermalChartData.value.tempOuts,
        },
        {
          name: '两水箱温差 (℃)',
          type: 'line',
          smooth: true,
          showSymbol: false,
          itemStyle: { color: '#8b5cf6' },
          lineStyle: { width: 1.5, type: 'dashed' },
          data: thermalChartData.value.tempDiffs,
        },
        {
          name: '估算热传递功率 (W)',
          type: 'line',
          smooth: true,
          showSymbol: false,
          yAxisIndex: 1,
          itemStyle: { color: '#e11d48' },
          lineStyle: { width: 2.5 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(225, 29, 72, 0.25)' },
              { offset: 1, color: 'rgba(225, 29, 72, 0.02)' },
            ]),
          },
          data: thermalChartData.value.powers,
        },
      ],
    },
    false,
  )
}

// 获取当前设备热工效能状态
const fetchThermalStatus = async () => {
  const dNo = selectedDeviceNo.value || undefined
  if (!dNo) return
  try {
    const res = await getThermalStatus(dNo)
    if (res.data) {
      thermalStatus.value = res.data
    }
  } catch {
    // 忽略获取失败
  }
}

// 推入热工数据点
const pushThermalPoint = (payload) => {
  const timeStr = payload.c_time
    ? payload.c_time.slice(11, 19)
    : new Date().toLocaleTimeString('zh-CN', { hour12: false })

  const d = thermalChartData.value
  d.times.push(timeStr)
  d.tempIns.push(payload.temp_in ?? null)
  d.tempOuts.push(payload.temp_out ?? null)
  d.tempDiffs.push(payload.temperature_difference ?? 0)
  d.powers.push(payload.estimated_thermal_power ?? 0)

  if (d.times.length > thermalChartLimit) {
    d.times.shift()
    d.tempIns.shift()
    d.tempOuts.shift()
    d.tempDiffs.shift()
    d.powers.shift()
  }

  renderThermalChart()
}

// 页面初始化或切换设备时，同时刷新卡片、图表、流量状态与热工状态。
const loadAll = async () => {
  flowChartData.value = {
    times: [],
    flowRates: [],
    velocities: [],
    totalVolumes: [],
  }
  thermalChartData.value = {
    times: [],
    tempIns: [],
    tempOuts: [],
    tempDiffs: [],
    powers: [],
  }
  await Promise.all([fetchRealtime(), fetchChartData(), fetchFlowStatus(), fetchThermalStatus()])
  renderChart()
  if (flowStatus.value && selectedDeviceNo.value) {
    pushFlowPoint({
      updated_at: new Date().toISOString(),
      flow_rate: flowStatus.value.flow_rate,
      flow_velocity: flowStatus.value.flow_velocity,
      total_volume: flowStatus.value.total_volume,
    })
  } else {
    renderFlowChart()
  }

  if (thermalStatus.value && selectedDeviceNo.value) {
    pushThermalPoint({
      c_time: new Date().toISOString(),
      temp_in: thermalStatus.value.temp_in,
      temp_out: thermalStatus.value.temp_out,
      temperature_difference: thermalStatus.value.temperature_difference,
      estimated_thermal_power: thermalStatus.value.estimated_thermal_power,
    })
  } else {
    renderThermalChart()
  }
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

  // 消费当前选中设备的水流与累计流量广播
  stopWsFlowListen = onRealtimeMessage('water_flow_realtime', (payload) => {
    if (
      selectedDeviceNo.value &&
      String(payload?.d_no) !== String(selectedDeviceNo.value)
    ) {
      return
    }
    flowStatus.value = {
      flow_rate: payload.flow_rate ?? 0,
      flow_velocity: payload.flow_velocity ?? null,
      velocity_status: payload.velocity_status ?? 'unconfigured',
      pipe_inner_diameter: payload.pipe_inner_diameter ?? null,
      total_volume: payload.total_volume ?? 0,
    }
    pushFlowPoint(payload)
  })

  // 消费当前选中设备的热工效能广播 (大纲 4.3 节)
  stopWsThermalListen = onRealtimeMessage('thermal_realtime', (payload) => {
    if (
      selectedDeviceNo.value &&
      String(payload?.d_no) !== String(selectedDeviceNo.value)
    ) {
      return
    }
    thermalStatus.value = {
      temperature_difference: payload.temperature_difference ?? 0,
      heat_transfer_difference: payload.heat_transfer_difference ?? 0,
      heating_rate: payload.heating_rate ?? 0,
      heating_rate_out: payload.heating_rate_out ?? 0,
      estimated_thermal_power: payload.estimated_thermal_power ?? 0,
      power_status: payload.power_status ?? 'pump_off',
      power_status_text: payload.power_status_text ?? '水泵未开启',
      temp_in: payload.temp_in,
      temp_out: payload.temp_out,
      flow_rate: payload.flow_rate,
    }
    pushThermalPoint(payload)
  })

  // 重连后主动补拉一次图表，弥补断线期间可能漏掉的数据点。
  stopLifecycle = onWsLifecycle((type) => {
    if (type === 'reconnected') {
      fetchChartData().then(() => renderChart())
      fetchFlowStatus().then(() => renderFlowChart())
      fetchThermalStatus().then(() => renderThermalChart())
    }
  })
})


const handleResize = () => {
  chartInstance?.resize()
  flowChartInstance?.resize()
  thermalChartInstance?.resize()
}


onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
  if (flowChartInstance) {
    flowChartInstance.dispose()
    flowChartInstance = null
  }
  if (thermalChartInstance) {
    thermalChartInstance.dispose()
    thermalChartInstance = null
  }
  if (stopWsListen) {
    stopWsListen()
    stopWsListen = null
  }
  if (stopWsFlowListen) {
    stopWsFlowListen()
    stopWsFlowListen = null
  }
  if (stopWsThermalListen) {
    stopWsThermalListen()
    stopWsThermalListen = null
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

      <el-descriptions-item label="管内流速">
        <template v-if="flowStatus.velocity_status === 'ok' && flowStatus.flow_velocity !== null">
          <el-tag type="success">
            {{ flowStatus.flow_velocity }} m/s
            <span v-if="flowStatus.pipe_inner_diameter" class="pipe-sub">
              (内径 {{ flowStatus.pipe_inner_diameter }}mm)
            </span>
          </el-tag>
        </template>
        <template v-else>
          <el-tag type="warning">待配置水管内径</el-tag>
        </template>
      </el-descriptions-item>

      <el-descriptions-item label="累计总流量">
        <div class="flow-total-cell">
          <el-tag type="info" class="flow-volume-tag">{{ flowStatus.total_volume }} L</el-tag>
          <el-button
            size="small"
            type="danger"
            plain
            class="reset-btn"
            @click="handleResetFlow"
          >
            清零
          </el-button>
        </div>
      </el-descriptions-item>

      <el-descriptions-item label="是否在线">
        <el-tag>{{ sensorData.values['是否在线'] || '未启用心跳' }}</el-tag>
      </el-descriptions-item>

      <el-descriptions-item label="水力运行诊断">
        <template v-if="currentHydraulicDiagnosis">
          <el-tooltip :content="currentHydraulicDiagnosis.detail" placement="top">
            <el-tag :type="getDiagnosisTagType(currentHydraulicDiagnosis.level)">
              {{ currentHydraulicDiagnosis.name }}
            </el-tag>
          </el-tooltip>
        </template>
        <template v-else>
          <el-tag type="info">未诊断</el-tag>
        </template>
      </el-descriptions-item>

      <el-descriptions-item label="两水箱温差">
        <el-tag type="info">
          {{ thermalStatus.temperature_difference }} ℃
        </el-tag>
      </el-descriptions-item>

      <el-descriptions-item label="水箱A升温速度">
        <el-tag :type="thermalStatus.heating_rate > 0 ? 'success' : (thermalStatus.heating_rate < 0 ? 'primary' : 'info')">
          {{ thermalStatus.heating_rate > 0 ? `+${thermalStatus.heating_rate}` : thermalStatus.heating_rate }} ℃/min
        </el-tag>
      </el-descriptions-item>

      <el-descriptions-item label="循环水估算热功率">
        <el-tooltip :content="thermalStatus.power_status_text" placement="top">
          <el-tag :type="thermalStatus.power_status === 'ok' ? 'danger' : 'info'">
            {{ thermalStatus.estimated_thermal_power }} W
            <span class="pipe-sub">({{ thermalStatus.power_status_text }})</span>
          </el-tag>
        </el-tooltip>
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

    <!-- 方案一：水流分析与热工效能左右 1:1 双栏并排 -->
    <el-row :gutter="20" class="analysis-charts-row">
      <el-col :xs="24" :sm="24" :md="12">
        <el-card class="analysis-chart-card" shadow="never">
          <div class="analysis-chart-container">
            <div ref="flowChartRef" class="chart"></div>
            <el-empty
              v-if="!flowChartData.times.length"
              description="等待水流与累计流量数据..."
            />
          </div>
        </el-card>
      </el-col>

      <el-col :xs="24" :sm="24" :md="12">
        <el-card class="analysis-chart-card" shadow="never">
          <div class="analysis-chart-container">
            <div ref="thermalChartRef" class="chart"></div>
            <el-empty
              v-if="!thermalChartData.times.length"
              description="等待热工效能与热传递分析数据..."
            />
          </div>
        </el-card>
      </el-col>
    </el-row>

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
  width: 64px;
  height: 64px;
  border-radius: 4px;
  cursor: pointer;
  object-fit: cover;
}

.preview-trigger {
  cursor: pointer;
}

:deep(.el-descriptions__cell) {
  min-width: 0;
  height: 72px;
  box-sizing: border-box;
}

:deep(.el-descriptions__content) {
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

.analysis-charts-row {
  margin-top: 24px;
}

.analysis-chart-card {
  border-radius: 8px;
}

.analysis-chart-container {
  position: relative;
  width: 100%;
  height: 440px;
}

.flow-total-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.flow-volume-tag {
  font-weight: 600;
}

.pipe-sub {
  margin-left: 4px;
  font-size: 11px;
  opacity: 0.85;
}

.reset-btn {
  margin-left: 4px;
}
</style>
