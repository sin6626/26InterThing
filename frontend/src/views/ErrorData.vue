<script setup>
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue'
import * as echarts from 'echarts'
import { getErrorData } from '@/api/sensor'
import { useDeviceNumbers } from '@/composables/useDeviceNumbers'
import dayjs from 'dayjs'
import { useSwitchStore } from '@/stores/switch'
import { onRealtimeMessage } from '@/utils/wsRealtime'

// 错误页同时展示列表和错误类型分布饼图。
const sensorData = ref([])
const startTime = ref(null)
const endTime = ref(null)
const chartRef = ref(null)
let chartInstance = null
let stopWsListen = null

// 根据当前列表实时统计各类错误占比，用于底部饼图。
const errorTypeData = computed(() => {
  const map = {}
  ;(sensorData.value || []).forEach((row) => {
    const key = row.type || '未知'
    map[key] = (map[key] || 0) + 1
  })
  return Object.entries(map).map(([name, value]) => ({ name, value }))
})
// const loading = ref(false)

// 设备筛选和时间筛选控件状态。
const value2 = ref('')
const { numbers: options, fetchDeviceNumbers } = useDeviceNumbers()
const switchStore = useSwitchStore()

// 分页参数由前端维护，再和筛选条件一起传给后端。
const params = ref({
  pagenum: 1,
  pagesize: 10,
})
const total = ref(0)

// 当前已生效的查询条件单独存一份，翻页时继续沿用。
const curquery = ref({
  startTime: null,
  endTime: null,
  d_no: null,
})

// 格式化日期时间
const formatDateTime = (time) => dayjs(time).format('YYYY-MM-DD HH:mm:ss')

// 每次查询都基于“分页参数 + 当前筛选条件”重新拉取列表。
const getList = async () => {
  // loading.value = true
  const queryParams = {
    ...params.value,
    ...curquery.value,
  }

  const res = await getErrorData(queryParams)
  console.log(res)

  sensorData.value = res.data || []
  total.value = res.total || 0
}

const handleSizeChange = (val) => {
  params.value.pagesize = val
  params.value.pagenum = 1
  getList()
}

const handleCurrentChange = (val) => {
  params.value.pagenum = val
  getList()
}

// 点击查询时先固化筛选条件，再请求第一页数据。
const query = () => {
  params.value.pagenum = 1

  curquery.value = {
    startTime: startTime.value ? formatDateTime(startTime.value) : null,
    endTime: endTime.value ? formatDateTime(endTime.value) : null,
    d_no: switchStore.value ? value2.value || null : null,
  }

  getList()
}

// 饼图随列表数据同步刷新，不单独请求额外统计接口。
const renderChart = () => {
  if (!chartRef.value) return
  if (!chartInstance) {
    chartInstance = echarts.init(chartRef.value)
  }
  const data = errorTypeData.value
  chartInstance.setOption({
    title: { text: '错误类型分布', left: 'center', top: 8, textStyle: { fontSize: 18, fontWeight: 600 } },
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 8, type: 'scroll' },
    series: [{
      type: 'pie',
      radius: '60%',
      data,
      emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } },
    }],
  })
}

const handleResize = () => chartInstance?.resize()

watch(errorTypeData, () => { renderChart() })

onMounted(async () => {
  await fetchDeviceNumbers()
  curquery.value.d_no = null
  await getList()
  renderChart()
  window.addEventListener('resize', handleResize)

  // 新错误到来时直接插入表头，保持列表和图表都能立刻反映变化。
  stopWsListen = onRealtimeMessage('error_realtime', (payload) => {
    if (
      switchStore.value &&
      value2.value &&
      String(payload?.d_no) !== String(value2.value)
    ) {
      return
    }
    if (payload) {
      const newItem = {
        ...payload,
        c_time: payload.c_time ? dayjs(payload.c_time).format('YYYY-MM-DD HH:mm:ss') : dayjs().format('YYYY-MM-DD HH:mm:ss'),
      }
      sensorData.value = [newItem, ...sensorData.value]
      total.value = total.value + 1
    }
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
  chartInstance = null
  if (stopWsListen) {
    stopWsListen()
    stopWsListen = null
  }
})

watch(
  () => switchStore.value,
  () => {
    if (!switchStore.value) {
      value2.value = ''
    }
    query()
  },
)
</script>

<template>
  <page-container title="历史数据">
    <template #extra>
      <div class="flex">
        <el-select
          v-if="switchStore.value"
          v-model="value2"
          placeholder="请选择编号"
          style="width: 130px"
          clearable
        >
          <el-option
            v-for="item in options"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>

        <el-date-picker
          v-model="startTime"
          type="datetime"
          placeholder="开始时间"
          format="YYYY-MM-DD HH:mm:ss"
          style="width: 200px"
        />
        <el-date-picker
          v-model="endTime"
          type="datetime"
          placeholder="结束时间"
          format="YYYY-MM-DD HH:mm:ss"
          style="width: 200px"
          :disabled-date="(time) => startTime && dayjs(time).isBefore(dayjs(startTime), 'second')"
        />

        <el-button type="primary" @click="query">查询</el-button>
      </div>
    </template>

    <el-table :data="sensorData">
      <el-table-column label="序号" type="index" width="60px"></el-table-column>
      <el-table-column v-if="switchStore.value" label="设备编号">
        <template #default="scope">
          {{ scope.row.d_no || '暂无' }}
        </template>
      </el-table-column>
      <el-table-column label="错误编号">
        <template #default="scope">
          {{ scope.row.e_no || '暂无' }}
        </template>
      </el-table-column>
      <el-table-column label="错误类型">
        <template #default="scope">
          {{ scope.row.type || '暂无' }}
        </template>
      </el-table-column>
      <el-table-column label="错误信息">
        <template #default="scope">
          {{ scope.row.e_msg || '暂无' }}
        </template>
      </el-table-column>
      <el-table-column label="时间">
        <template #default="scope">
          {{ scope.row.c_time || '暂无' }}
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <el-pagination
      v-model:current-page="params.pagenum"
      v-model:page-size="params.pagesize"
      :page-sizes="[2, 3, 5, 10]"
      background
      layout="jumper, total, sizes, prev, pager, next"
      :total="total"
      @size-change="handleSizeChange"
      @current-change="handleCurrentChange"
      style="margin-top: 20px; justify-content: flex-end"
    />

    <el-empty v-if="!sensorData.length" description="暂无数据" />

    <div class="chart-container" v-if="errorTypeData.length">
      <div ref="chartRef" class="chart"></div>
    </div>
  </page-container>
</template>

<style lang="scss" scoped>
:deep(.flex) {
  display: flex;
  gap: 30px;
}

.chart-container {
  margin-top: 24px;
  padding: 16px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
}

.chart {
  width: 100%;
  height: 320px;
}
</style>
