<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getDirectInfo,
  resetWaterControlFault,
  startWaterControl,
  stopWaterControl,
  updateDirect,
  updateDirectGlobal,
  updateTime,
} from '@/api/sensor.js'
import { useDeviceNumbers } from '@/composables/useDeviceNumbers'
import { useSwitchStore } from '@/stores/switch'

// 当前正在查看或下发指令的设备编号。
const d_noValue = ref('')
const queryNo = ref('')
const { numbers: options, fetchDeviceNumbers } = useDeviceNumbers()
const switchStore = useSwitchStore()
// 顶部手动更新时间允许页面传入指定时间，再由后端转换成 MQTT 协议格式。
const selectedUpdateTime = ref('')

const defaultProps = {
  children: 'children',
  label: 't_name',
}

const globalTreeData = ref([])
const deviceTreeData = ref([])
const actionLoading = ref(false)

// 以某台设备为参照，同时拿到全局默认树和单设备覆盖树。
const getList = async (no) => {
  const selectedNo = no || options.value[0]?.value || ''
  if (!selectedNo) {
    globalTreeData.value = []
    deviceTreeData.value = []
    return
  }
  const res = await getDirectInfo(selectedNo)
  globalTreeData.value = res.data?.globalTree || []
  deviceTreeData.value = res.data?.deviceTree || []
}

// 切换设备后刷新页面上的树形指令。
const query = async () => {
  d_noValue.value = queryNo.value
  await getList(d_noValue.value)
}

// 下发时只保留后端真正需要的字段，避免把页面临时属性一起传过去。
const normalizeUpdatePayload = (data) => ({
  config_id: data.config_id,
  value: data.value,
  f_type: data.f_type,
})

// 全局指令更新后重新拉取列表，保证页面展示的是数据库最新值。
const changeGlobalHandle = async (data) => {
  try {
    await updateDirectGlobal(normalizeUpdatePayload(data))
    ElMessage.success('全局指令更新成功')
  } catch (error) {
    ElMessage.error(error.message || '更新失败')
  } finally {
    await getList(d_noValue.value)
  }
}

// 单设备指令要求先选设备，再按相同协议下发。
const changeDeviceHandle = async (data) => {
  if (!d_noValue.value) {
    ElMessage.warning('请先选择设备编号')
    return
  }
  try {
    await updateDirect(normalizeUpdatePayload(data), d_noValue.value)
    ElMessage.success('设备单独指令更新成功')
  } catch (error) {
    ElMessage.error(error.message || '更新失败')
  } finally {
    await getList(d_noValue.value)
  }
}

// 水循环自动运行启停与复位
const handleStartWaterControl = async () => {
  const dNo = d_noValue.value || options.value[0]?.value || '202111'
  actionLoading.value = true
  try {
    const res = await startWaterControl(dNo)
    ElMessage.success(res.message || '水循环自动运行已启动')
  } catch (error) {
    ElMessage.error(error.message || '启动失败')
  } finally {
    actionLoading.value = false
    await getList(d_noValue.value)
  }
}

const handleStopWaterControl = async () => {
  const dNo = d_noValue.value || options.value[0]?.value || '202111'
  actionLoading.value = true
  try {
    const res = await stopWaterControl(dNo)
    ElMessage.success(res.message || '已发出停止指令，进入冷却流程')
  } catch (error) {
    ElMessage.error(error.message || '停止失败')
  } finally {
    actionLoading.value = false
    await getList(d_noValue.value)
  }
}

const handleResetWaterControl = async () => {
  const dNo = d_noValue.value || options.value[0]?.value || '202111'
  actionLoading.value = true
  try {
    const res = await resetWaterControlFault(dNo)
    ElMessage.success(res.message || '故障已复位')
  } catch (error) {
    ElMessage.error(error.message || '复位失败')
  } finally {
    actionLoading.value = false
    await getList(d_noValue.value)
  }
}

// 手动更新时间走独立接口，最终的 topic 和 payload 由后端统一处理。
const timeUpdate = async () => {
  if (!selectedUpdateTime.value) {
    ElMessage.warning('请先选择时间')
    return
  }
  await updateTime(selectedUpdateTime.value)
  ElMessage.success('时间更新成功')
}

// 输入框先更新本地值，真正提交在 change 事件里触发。
const handleValueInput = (val, data) => {
  data.value = val
}

onMounted(async () => {
  // 默认选第一台设备，避免初次进入时右侧树为空。
  await fetchDeviceNumbers()
  if (options.value.length) {
    queryNo.value = options.value[0].value
    d_noValue.value = queryNo.value
    await getList(d_noValue.value)
  }
})
</script>

<template>
  <page-container title="指令信息">
    <template #extra>
      <div class="toolbar">
        <el-button-group>
          <el-button
            type="success"
            :loading="actionLoading"
            @click="handleStartWaterControl"
          >
            启动自动运行
          </el-button>
          <el-button
            type="danger"
            :loading="actionLoading"
            @click="handleStopWaterControl"
          >
            停止
          </el-button>
          <el-button
            type="warning"
            :loading="actionLoading"
            @click="handleResetWaterControl"
          >
            故障复位
          </el-button>
        </el-button-group>

        <el-date-picker
          v-model="selectedUpdateTime"
          type="datetime"
          placeholder="选择时间"
          format="YYYY-MM-DD HH:mm:ss"
          value-format="YYYY-MM-DD HH:mm:ss"
          style="width: 190px"
        />
        <el-button type="primary" @click="timeUpdate">更新时间</el-button>
      </div>
    </template>

    <h3>全局指令</h3>
    <el-tree
      :data="globalTreeData"
      :props="defaultProps"
      :expand-on-click-node="false"
      class="custom-tree"
      default-expand-all
    >
      <template #default="{ node, data }">
        <div class="tree-row">
          <div class="left">
            <span>{{ node.label }}</span>
          </div>
          <div class="right">
            <template v-if="data.f_type === '1'">
              <el-switch v-model="data.value" @change="changeGlobalHandle(data)" />
            </template>
            <el-input
              v-else-if="data.f_type === '2'"
              :model-value="data.value"
              style="width: 140px"
              @update:model-value="(val) => handleValueInput(val, data)"
              @change="changeGlobalHandle(data)"
            />
            <el-slider
              v-else-if="data.f_type === '3'"
              v-model="data.value"
              style="width: 160px"
              :min="data.min"
              :max="data.max"
              @change="changeGlobalHandle(data)"
            />
            <el-time-picker
              v-else-if="data.f_type === '4'"
              v-model="data.value"
              format="HH:mm:ss"
              value-format="HH:mm:ss"
              @change="changeGlobalHandle(data)"
            />
            <el-radio-group
              v-else-if="data.f_type === '5'"
              v-model="data.value"
              @change="changeGlobalHandle(data)"
            >
              <el-radio-button
                v-for="opt in (data.options || [])"
                :key="opt"
                :label="opt"
              >{{ opt }}</el-radio-button>
            </el-radio-group>
            <el-checkbox-group
              v-else-if="data.f_type === '6'"
              v-model="data.valueArr"
              @change="(val) => { data.value = (val || []).join(','); changeGlobalHandle(data) }"
            >
              <el-checkbox
                v-for="opt in (data.options || [])"
                :key="opt"
                :label="opt"
              >{{ opt }}</el-checkbox>
            </el-checkbox-group>
          </div>
        </div>
      </template>
    </el-tree>

    
    <template v-if="switchStore.value">
      <hr class="split" />

      <div class="device-header">
        <h3>设备{{ d_noValue || '未选择' }}的单独指令</h3>
        <div class="device-query-bar">
          <el-select
            v-model="queryNo"
            placeholder="请选择编号"
            style="width: 140px"
            clearable
          >
            <el-option
              v-for="item in options"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
          <el-button type="primary" @click="query">查询</el-button>
        </div>
      </div>
      <el-tree
        :data="deviceTreeData"
        :props="defaultProps"
        :expand-on-click-node="false"
        class="custom-tree"
        default-expand-all
      >
        <template #default="{ node, data }">
          <div class="tree-row">
            <div class="left">
              <span>{{ node.label }}</span>
            </div>
            <div class="right">
              <template v-if="data.f_type === '1'">
                <el-switch v-model="data.value" @change="changeDeviceHandle(data)" />
              </template>
              <el-input
                v-else-if="data.f_type === '2'"
                :model-value="data.value"
                style="width: 140px"
                @update:model-value="(val) => handleValueInput(val, data)"
                @change="changeDeviceHandle(data)"
              />
              <el-slider
                v-else-if="data.f_type === '3'"
                v-model="data.value"
                style="width: 160px"
                :min="data.min"
                :max="data.max"
                @change="changeDeviceHandle(data)"
              />
              <el-time-picker
                v-else-if="data.f_type === '4'"
                v-model="data.value"
                format="HH:mm:ss"
                value-format="HH:mm:ss"
                @change="changeDeviceHandle(data)"
              />
              <el-radio-group
                v-else-if="data.f_type === '5'"
                v-model="data.value"
                @change="changeDeviceHandle(data)"
              >
                <el-radio-button
                  v-for="opt in (data.options || [])"
                  :key="opt"
                  :label="opt"
                >{{ opt }}</el-radio-button>
              </el-radio-group>
              <el-checkbox-group
                v-else-if="data.f_type === '6'"
                v-model="data.valueArr"
                @change="(val) => { data.value = (val || []).join(','); changeDeviceHandle(data) }"
              >
                <el-checkbox
                  v-for="opt in (data.options || [])"
                  :key="opt"
                  :label="opt"
                >{{ opt }}</el-checkbox>
              </el-checkbox-group>
            </div>
          </div>
        </template>
      </el-tree>
    </template>
  </page-container>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.split {
  margin: 24px 0;
  border: 0;
  border-top: 1px solid #ebeef5;
}

.device-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.device-header h3 {
  margin: 0;
}

.device-query-bar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tree-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-right: 16px;
}

.left {
  color: #303133;
}

.right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.custom-tree :deep(.el-tree-node__content) {
  min-height: 46px;
}
</style>
