<script setup>
import { onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import { getEchartsSensorByQuery, getSensorDataPast } from '@/api/sensor'
import { useDeviceNumbers } from '@/composables/useDeviceNumbers'
import HistoryDataChart from '@/components/HistoryDataChart.vue'
import { useSwitchStore } from '@/stores/switch'

const tablePrefix = 't_sensor'

const sensorData = ref([])
const columns = ref([])
const startTime = ref(null)
const endTime = ref(null)
const selectedDeviceNo = ref('')
const chartData = ref({ xAxisData: [], seriesData: [] })
const chartPointLimit = ref(10)
const chartType = ref('line')

const params = ref({
  pagenum: 1,
  pagesize: 20,
})
const total = ref(0)

const curquery = ref({
  startTime: null,
  endTime: null,
  d_no: null,
})

const { numbers: deviceNumbers, fetchDeviceNumbers } = useDeviceNumbers()
const switchStore = useSwitchStore()

const formatDateTime = (time) => dayjs(time).format('YYYY-MM-DD HH:mm:ss')

const getList = async () => {
  const queryParams = {
    ...params.value,
    ...curquery.value,
  }

  const res = await getSensorDataPast(queryParams, tablePrefix)
  sensorData.value = res.data || []
  columns.value = (res.columns || []).filter((col) => col.prop !== '编号')
  total.value = res.total || 0
}

const getChart = async () => {
  const res = await getEchartsSensorByQuery(tablePrefix, {
    d_no: curquery.value.d_no,
    startTime: curquery.value.startTime,
    endTime: curquery.value.endTime,
    limit: chartPointLimit.value,
  })
  chartData.value = res.data || { xAxisData: [], seriesData: [] }
}

const query = async () => {
  params.value.pagenum = 1
  curquery.value = {
    startTime: startTime.value ? formatDateTime(startTime.value) : null,
    endTime: endTime.value ? formatDateTime(endTime.value) : null,
    d_no: switchStore.value ? selectedDeviceNo.value || null : null,
  }

  await Promise.all([getList(), getChart()])
}

const handleSizeChange = async (val) => {
  params.value.pagesize = val
  params.value.pagenum = 1
  await getList()
}

const handleCurrentChange = async (val) => {
  params.value.pagenum = val
  await getList()
}

onMounted(async () => {
  await fetchDeviceNumbers()
  sensorData.value = []
  chartData.value = { xAxisData: [], seriesData: [] }
  total.value = 0

  await query()
})
</script>

<template>
  <page-container title="历史数据">
    <template #extra>
      <div class="toolbar">
        <el-select
          v-if="switchStore.value"
          v-model="selectedDeviceNo"
          placeholder="请选择编号"
          style="width: 130px"
          clearable
        >
          <el-option
            v-for="item in deviceNumbers"
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
        <el-select v-model="chartType" style="width: 140px">
          <el-option label="折线图" value="line" />
          <el-option label="柱状图" value="bar" />
          <el-option label="散点图" value="scatter" />
        </el-select>
      </div>
    </template>

    <el-table :data="sensorData">
      <el-table-column label="序号" type="index" width="60px" />
      <el-table-column v-if="switchStore.value" prop="编号" label="编号" width="100" />

      <el-table-column
        v-for="col in columns"
        :key="col.prop"
        :prop="col.prop"
        :label="col.label + (col.unit ? `${col.unit}` : '')"
        :sortable="col.type === 'number'"
        :width="col.width"
      >
        <template #default="scope">
          {{ scope.row[col.prop] ?? '--' }}
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-model:current-page="params.pagenum"
      v-model:page-size="params.pagesize"
      :page-sizes="[10, 20, 50]"
      background
      layout="jumper, total, sizes, prev, pager, next"
      :total="total"
      @size-change="handleSizeChange"
      @current-change="handleCurrentChange"
      style="margin-top: 20px; justify-content: flex-end"
    />

    <el-empty v-if="!sensorData.length" description="暂无数据" />

    <HistoryDataChart
      title="传感器历史趋势图"
      :x-axis-data="chartData.xAxisData || []"
      :series-data="chartData.seriesData || []"
      :max-points="chartPointLimit"
      :chart-type="chartType"
    />
  </page-container>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
}
</style>
