<script setup>
import { onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import { getDirectHistory, getDirectTypes } from '@/api/sensor'

const historyRows = ref([])
const directTypes = ref([])
const directType = ref('')
const startTime = ref(null)
const endTime = ref(null)
const total = ref(0)

const params = ref({
  pagenum: 1,
  pagesize: 10,
})

const formatDateTime = (time) => dayjs(time).format('YYYY-MM-DD HH:mm:ss')
const formatOperateTime = (time) => (time ? dayjs(time).format('YYYY-MM-DD HH:mm:ss') : '暂无')

const buildQueryParams = () => ({
  ...params.value,
  direct_type: directType.value || null,
  startTime: startTime.value ? formatDateTime(startTime.value) : null,
  endTime: endTime.value ? formatDateTime(endTime.value) : null,
})

const getList = async () => {
  const res = await getDirectHistory(buildQueryParams())
  historyRows.value = res.data || []
  total.value = res.total || 0
}

const query = async () => {
  params.value.pagenum = 1
  await getList()
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
  const res = await getDirectTypes()
  directTypes.value = res.data || []
  await getList()
})
</script>

<template>
  <page-container title="操作历史">
    <template #extra>
      <div class="toolbar">
        <el-select v-model="directType" placeholder="指令类型" style="width: 180px" clearable>
          <el-option
            v-for="item in directTypes"
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

    <el-table :data="historyRows">
      <el-table-column label="序号" type="index" width="60" />
      <el-table-column prop="operate_time" label="操作时间" min-width="170">
        <template #default="scope">
          {{ formatOperateTime(scope.row.operate_time) }}
        </template>
      </el-table-column>
      <el-table-column prop="direct_name" label="指令名称" min-width="150" />
      <el-table-column prop="direct_type" label="指令类型" min-width="130" />
      <el-table-column prop="d_no" label="设备编号" width="110">
        <template #default="scope">
          {{ scope.row.d_no || '全局' }}
        </template>
      </el-table-column>
      <el-table-column prop="old_value" label="原值" min-width="110" />
      <el-table-column prop="new_value" label="新值" min-width="110" />
      <el-table-column prop="remark" label="方向" min-width="140" />
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

    <el-empty v-if="!historyRows.length" description="暂无数据" />
  </page-container>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
}
</style>
