<script setup>
import { ref } from 'vue'
import { getDeviceInfo } from '@/api/sensor'
import { Edit, Delete } from '@element-plus/icons-vue'

// 设备管理页负责设备的查询、编辑、新增和删除。
const sensorData = ref([])

// 顶部两个输入框分别按编号和名称筛选。
const value1 = ref('')
const value2 = ref('')


// 列表分页参数。
const params = ref({
  pagenum: 1,
  pagesize: 500
})
const total = ref(0)

// 当前已生效的查询条件，翻页时继续沿用。
const curquery = ref({
  number: null,
  device_name: ''
})

// 拉取设备列表。
const getList = async () => {
  const queryParams = {
    ...params.value,
    ...curquery.value
  }

  const res = await getDeviceInfo(queryParams)
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

// 进入页面先加载全部设备。
getList()

// 点击查询时先固化条件，再从第一页重新拉取。
const query = () => {
  params.value.pagenum = 1

  curquery.value = {
    number: value1.value || null,
    device_name: value2.value || ''
  }

  getList()
}


import DialogForm from '@/views/device/componets/DialogForm.vue'

const dialogFormRef = ref(null)

// 编辑成功留在当前页刷新；新增成功回第一页，方便看到刚创建的数据。
const handleSuccess = (type) => {
  if (type === 'edit') {
    getList()
  } else {
    params.value.pagenum = 1
    getList()
  }
}

// 新增设备时传空对象给弹窗组件。
const add = () => {
  dialogFormRef.value.open({})
}

// 编辑时把当前行回填到弹窗表单。
const onEditArticle = (row) => {
  dialogFormRef.value.open(row)
}

import { deleteDevice } from '@/api/sensor'
import { ElMessageBox, ElMessage } from 'element-plus'

// 删除前弹二次确认，删除成功后刷新当前列表。
const onDeleteArticle = async (row) => {
  ElMessageBox.confirm(
    '你确定要删除吗?',
    '警告',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    }
  )
    .then(async () => {
      const res = await deleteDevice(row.id)
      console.log(res)
      ElMessage({
        type: 'success',
        message: res.message,
      })
      getList()
    })
}


</script>



<template>
  <page-container title="设备管理">
    <template #extra>
      <div class="flex">
        <el-input v-model="value1" style="width: 100px" placeholder="查询编号" />
        <el-input v-model="value2" style="width: 200px" placeholder="查询名称" />

        <el-button color="#626aef" @click="query">查询</el-button>
        <el-button type="primary" @click="add">新增</el-button>
      </div>
    </template>

    <el-table :data="sensorData">
      <!-- <el-table-column label="序号" type="index" width="60px"></el-table-column> -->
      <el-table-column width="150" label="设备编号">
        <template #default="scope">
          {{ scope.row.number || '暂无' }}
        </template>
      </el-table-column>
      <el-table-column width="250" label="设备名称">
        <template #default="scope">
          {{ scope.row.device_name || '暂无' }}
        </template>
      </el-table-column>
      <el-table-column label="备注">
        <template #default="scope">
          {{ scope.row.remarks || '暂无' }}
        </template>
      </el-table-column>
      <el-table-column label="创建时间">
        <template #default="scope">
          {{ scope.row.ctime || '暂无' }}
        </template>
      </el-table-column>
      <el-table-column label="操作">
        <template #default="{ row }">
          <el-button :icon="Edit" circle plain type="primary" @click="onEditArticle(row)"></el-button>
          <el-button :icon="Delete" circle plain type="danger" @click="onDeleteArticle(row)"></el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <el-pagination v-model:current-page="params.pagenum" v-model:page-size="params.pagesize" :page-sizes="[200, 300, 500, 1000]"
      background layout="jumper, total, sizes, prev, pager, next" :total="total" @size-change="handleSizeChange"
      @current-change="handleCurrentChange" style="margin-top: 20px; justify-content: flex-end" />


    <el-empty v-if="!sensorData.length" description="暂无数据" />

    <DialogForm ref="dialogFormRef" @success="handleSuccess" />

  </page-container>

</template>

<style lang="scss" scoped>
:deep(.flex) {
  display: flex;
  gap: 10px; // 添加间距，使布局更美观
}
</style>
