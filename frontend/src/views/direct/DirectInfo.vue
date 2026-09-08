<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
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
import { useDeviceStatus } from '@/composables/useDeviceStatus'
import { useSwitchStore } from '@/stores/switch'
import { numericControlTopics, validateControlValue, filterControlTree } from '@/utils/controlValidation'

// 当前正在查看或下发指令的设备编号。
const d_noValue = ref('')
const queryNo = ref('')
const { numbers: options, fetchDeviceNumbers } = useDeviceNumbers()
const { deviceStatusMap, fetchDeviceStatus } = useDeviceStatus()
const switchStore = useSwitchStore()
// 顶部手动更新时间允许页面传入指定时间，再由后端转换成 MQTT 协议格式。
const selectedUpdateTime = ref('')

const defaultProps = {
  children: 'children',
  label: 't_name',
}

const globalTreeData = ref([])
const deviceTreeData = ref([])
const visibleGlobalTree = computed(() => filterControlTree(globalTreeData.value))
const visibleDeviceTree = computed(() => filterControlTree(deviceTreeData.value))
const actionLoading = ref(false)
const treeKey = ref(0)
const sensorLabels = {
  temp_in: '入口温度',
  temp_out: '出口温度',
  flow_rate: '流量',
  pressure: '压力',
}
const currentControl = computed(() => deviceStatusMap.value[d_noValue.value]?.control || null)
const staleSensorText = computed(() => (
  (currentControl.value?.staleSensors || []).map((field) => sensorLabels[field] || field).join('、')
))

const getDiagnosisTagType = (level) => {
  if (level === 'error') return 'danger'
  if (level === 'warning') return 'warning'
  if (level === 'success') return 'success'
  return 'info'
}

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
  treeKey.value++
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
    validateControlValue(data, globalTreeData.value)
    await updateDirectGlobal(normalizeUpdatePayload(data))
    ElMessage.success('全局指令更新成功')
  } catch (error) {
    ElMessage.error(error.message || '更新失败')
  } finally {
    await Promise.all([getList(d_noValue.value), fetchDeviceStatus()])
  }
}

// 单设备指令要求先选设备，再按相同协议下发。
const changeDeviceHandle = async (data) => {
  if (!d_noValue.value) {
    ElMessage.warning('请先选择设备编号')
    return
  }
  try {
    validateControlValue(data, deviceTreeData.value)
    await updateDirect(normalizeUpdatePayload(data), d_noValue.value)
    ElMessage.success('设备单独指令更新成功')
  } catch (error) {
    ElMessage.error(error.message || '更新失败')
  } finally {
    await Promise.all([getList(d_noValue.value), fetchDeviceStatus()])
  }
}

// 水循环自动运行启停与复位
const handleStartWaterControl = async () => {
  const dNo = d_noValue.value || options.value[0]?.value || ''
  if (!dNo) {
    ElMessage.warning('未检测到有效设备编号')
    return
  }
  if (currentControl.value?.fsmState === 'FAULT') {
    ElMessage.warning(`请先确认并复位故障：${currentControl.value.faultReason || '未知故障'}`)
    return
  }
  actionLoading.value = true
  try {
    const res = await startWaterControl(dNo)
    ElMessage.success(res.message || '水循环自动运行已启动')
  } catch (error) {
    ElMessage.error(error.message || '启动失败')
  } finally {
    actionLoading.value = false
    await Promise.all([getList(d_noValue.value), fetchDeviceStatus()])
  }
}

const handleStopWaterControl = async () => {
  const dNo = d_noValue.value || options.value[0]?.value || ''
  if (!dNo) {
    ElMessage.warning('未检测到有效设备编号')
    return
  }
  actionLoading.value = true
  try {
    const res = await stopWaterControl(dNo)
    ElMessage.success(res.message || '已发出停止指令，进入冷却流程')
  } catch (error) {
    ElMessage.error(error.message || '停止失败')
  } finally {
    actionLoading.value = false
    await Promise.all([getList(d_noValue.value), fetchDeviceStatus()])
  }
}

const handleResetWaterControl = async () => {
  const dNo = d_noValue.value || options.value[0]?.value || ''
  if (!dNo) {
    ElMessage.warning('未检测到有效设备编号')
    return
  }
  try {
    await ElMessageBox.confirm(
      `请确认现场危险条件已经解除。当前故障：${currentControl.value?.faultReason || '未提供故障原因'}`,
      '确认故障复位',
      {
        confirmButtonText: '已检查，确认复位',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch {
    return
  }
  actionLoading.value = true
  try {
    const res = await resetWaterControlFault(dNo, true)
    ElMessage.success(res.message || '故障已复位')
  } catch (error) {
    ElMessage.error(error.message || '复位失败')
  } finally {
    actionLoading.value = false
    await Promise.all([getList(d_noValue.value), fetchDeviceStatus()])
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
    await Promise.all([getList(d_noValue.value), fetchDeviceStatus()])
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

    <div v-if="currentControl" class="control-status-panel">
      <el-tag :type="currentControl.fsmState === 'FAULT' ? 'danger' : 'info'">
        {{ currentControl.fsmText || currentControl.fsmState }}
      </el-tag>
      <span>水泵实际/期望：{{ currentControl.pumpState }} / {{ currentControl.desiredPumpState }}</span>
      <span>加热实际/期望：{{ currentControl.heaterState }} / {{ currentControl.desiredHeaterState }}</span>
      <span v-if="currentControl.countdown > 0">剩余 {{ currentControl.countdown }} 秒</span>
      <el-tooltip
        v-if="currentControl.hydraulicDiagnosis && currentControl.hydraulicDiagnosis.code !== 'STOPPED'"
        :content="currentControl.hydraulicDiagnosis.detail"
        placement="top"
      >
        <el-tag
          :type="getDiagnosisTagType(currentControl.hydraulicDiagnosis.level)"
          effect="light"
        >
          水力诊断：{{ currentControl.hydraulicDiagnosis.name }}
        </el-tag>
      </el-tooltip>
      <span v-if="staleSensorText" class="danger-text">数据异常：{{ staleSensorText }}</span>
      <span v-if="currentControl.lastCommandStatus?.status === 'failed'" class="danger-text">
        发布失败：{{ currentControl.lastCommandStatus.error }}
      </span>
      <span v-if="currentControl.faultReason" class="danger-text">{{ currentControl.faultReason }}</span>
    </div>

    <div v-if="currentControl" class="control-status-panel">
      <el-tag>{{ currentControl.controlStrategy === 'pid' ? '时间比例 PID' : '回差控温' }}</el-tag>
      <template v-if="currentControl.pid">
        <span>目标 / 出口温度：{{ currentControl.pid.target }} / {{ currentControl.pid.measurement ?? '—' }} ℃</span>
        <span>PID 输出：{{ currentControl.pid.output.toFixed(1) }}%</span>
        <span>计划占空比：{{ currentControl.pid.plannedDuty.toFixed(1) }}%</span>
        <span>窗口剩余：{{ currentControl.pid.windowRemaining.toFixed(1) }} 秒</span>
        <span v-if="currentControl.pid.resumeTemperature != null">关热 / 恢复：{{ currentControl.pid.cutoffTemperature }} / {{ Number(currentControl.pid.resumeTemperature.toFixed(2)) }} ℃</span>
        <span v-if="currentControl.pid.limitationReason">{{ currentControl.pid.limitationReason }}</span>
      </template>
      <span v-if="currentControl.configError" class="danger-text">{{ currentControl.configError }}</span>
      <span v-if="currentControl.restartReason">{{ currentControl.restartReason }}</span>
      <span v-if="currentControl.controlStrategy === 'pid'">Kp 需整定后启动；20/3/3 秒为调试候选值，请核对继电器规格。占空比为发布计划，实际状态以设备反馈为准。</span>
    </div>

    <h3>全局指令</h3>
    <el-tree
      :key="`global-${treeKey}`"
      node-key="id"
      :data="visibleGlobalTree"
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
            <el-select v-if="data.topic === 'temperature_control_strategy'" v-model="data.value" style="width: 160px" @change="changeGlobalHandle(data)">
              <el-option label="回差控温" value="hysteresis" />
              <el-option label="时间比例 PID" value="pid" />
            </el-select>
            <template v-else-if="data.f_type === '1'">
              <el-switch v-model="data.value" @change="changeGlobalHandle(data)" />
            </template>
            <el-input-number
              v-else-if="data.f_type === '2' && numericControlTopics.has(data.topic)"
              :model-value="Number(data.value)"
              :controls="false"
              style="width: 140px"
              @update:model-value="(val) => handleValueInput(val, data)"
              @change="changeGlobalHandle(data)"
            />
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
        :key="`device-${treeKey}`"
        node-key="id"
        :data="visibleDeviceTree"
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
              <el-select v-if="data.topic === 'temperature_control_strategy'" v-model="data.value" style="width: 160px" @change="changeDeviceHandle(data)">
                <el-option label="回差控温" value="hysteresis" />
                <el-option label="时间比例 PID" value="pid" />
              </el-select>
              <template v-else-if="data.f_type === '1'">
                <el-switch v-model="data.value" @change="changeDeviceHandle(data)" />
              </template>
              <el-input-number
                v-else-if="data.f_type === '2' && numericControlTopics.has(data.topic)"
                :model-value="Number(data.value)"
                :controls="false"
                style="width: 140px"
                @update:model-value="(val) => handleValueInput(val, data)"
                @change="changeDeviceHandle(data)"
              />
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

.control-status-panel {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 18px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fafafa;
  color: #606266;
}

.danger-text {
  color: #f56c6c;
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
