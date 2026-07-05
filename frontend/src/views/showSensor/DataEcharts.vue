<script setup>
import { onMounted } from 'vue'
import HistoryDataChart from '@/components/HistoryDataChart.vue'
import { ref } from 'vue'
import { getEchartsSensorByQuery } from '@/api/sensor'

const chartData = ref({ xAxisData: [], seriesData: [] })

const getList = async () => {
  const res = await getEchartsSensorByQuery('t_sensor', { d_no: '1', limit: 120 })
  chartData.value = res.data || { xAxisData: [], seriesData: [] }
}

onMounted(() => {
  getList()
})
</script>


<template>
  <page-container title="数据可视化">
    <HistoryDataChart
      title="传感器可视化数据"
      :x-axis-data="chartData.xAxisData || []"
      :series-data="chartData.seriesData || []"
      :max-points="120"
    />
  </page-container>
</template>
