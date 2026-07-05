<script setup>
import {
  Promotion,
  Bell,
  Warning,
  StarFilled,
  ChatLineRound
} from '@element-plus/icons-vue'

import { ref, onMounted, onBeforeUnmount } from 'vue'
import { ElNotification } from 'element-plus'
import { useSwitchStore } from '@/stores/switch'
import { useDeviceStatus } from '@/composables/useDeviceStatus'
import { onRealtimeMessage } from '@/utils/wsRealtime'

const switchStore = useSwitchStore()
const { deviceStatusMap, fetchDeviceStatus, startListening, stopListening } = useDeviceStatus()
// 告警声音只影响前端提示，不影响后端告警消息本身。
const alarmMuted = ref(false)

let stopAlarmWsListen = null
let audioContext = null
let currentOscillator = null
let stopAlarmTimer = null

// 播放新告警前先停止旧声音，避免叠加。
const stopAlarmSound = () => {
  if (stopAlarmTimer) {
    clearTimeout(stopAlarmTimer)
    stopAlarmTimer = null
  }
  if (currentOscillator) {
    try {
      currentOscillator.stop()
    } catch {
      // ignore
    }
    currentOscillator = null
  }
}

// 这里直接用浏览器 AudioContext 生成简短提示音，不依赖静态音频文件。
const playAlarmSound = () => {
  if (alarmMuted.value) return
  if (typeof window === 'undefined' || !window.AudioContext) return

  try {
    if (!audioContext) {
      audioContext = new window.AudioContext()
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume()
    }

    stopAlarmSound()

    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    oscillator.type = 'square'
    oscillator.frequency.value = 900
    gainNode.gain.value = 0.07
    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start()
    currentOscillator = oscillator

    stopAlarmTimer = setTimeout(() => {
      stopAlarmSound()
    }, 1200)
  } catch {
    // ignore playback issues
  }
}

// 顶部状态点只区分离线、在线正常、在线异常三种视觉状态。
const statusClass = (statusInfo) => {
  if (!statusInfo || statusInfo.status !== 'online') return 'offline'
  return Number(statusInfo.vstatus ?? 0) === 0 ? 'online' : 'error'
}

onMounted(async () => {
  // 先拉一份全量状态，再接入实时推送。
  await fetchDeviceStatus()
  startListening()

  // 告警通知和声音使用独立消息通道。
  stopAlarmWsListen = onRealtimeMessage('alarm_realtime', (payload) => {
    ElNotification({
      title: '设备报警',
      message: `设备 ${payload?.d_no || '未知'}: ${payload?.text || '发生报警'} (VStatus=${payload?.code ?? '-'})`,
      type: payload?.level === 'warning' ? 'warning' : 'error',
      duration: 5000,
    })
    playAlarmSound()
  })
})

onBeforeUnmount(() => {
  // 布局销毁时一并释放订阅和音频资源。
  stopListening()
  if (stopAlarmWsListen) {
    stopAlarmWsListen()
    stopAlarmWsListen = null
  }
  stopAlarmSound()
  if (audioContext) {
    audioContext.close()
    audioContext = null
  }
})
</script>

<template>
  <el-container class="layout-container">
    <el-aside>
      <el-menu class="menu" active-text-color="#ffd04b" background-color="#232323" text-color="#fff"
        :default-active=$route.path router>
        <el-sub-menu index="/sensorData">
          <template #title>
            <el-icon>
              <Promotion />
            </el-icon>
            <span>传感器数据</span>
          </template>
          <el-menu-item index="/sensorData/realtime">
            <el-icon>
              <Promotion />
            </el-icon>
            <span>实时数据</span>
          </el-menu-item>
          <el-menu-item index="/sensorData/past">
            <el-icon>
              <Promotion />
            </el-icon>
            <span>历史数据</span>
          </el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="/behavior">
          <template #title>
            <el-icon>
              <Bell />
            </el-icon>
            <span>行为数据</span>
          </template>
          <el-menu-item index="/behavior/realtime">
            <el-icon>
              <Bell />
            </el-icon>
            <span>实时数据</span>
          </el-menu-item>
          <el-menu-item index="/behavior/past">
            <el-icon>
              <Bell />
            </el-icon>
            <span>历史数据</span>
          </el-menu-item>
        </el-sub-menu>

        <el-menu-item index="/error_data">
          <el-icon>
            <Warning />
          </el-icon>
          <span>错误信息</span>
        </el-menu-item>

        <el-menu-item v-if="switchStore.value" index="/device">
          <el-icon>
            <StarFilled />
          </el-icon>
          <span>设备管理</span>
        </el-menu-item>

        <el-menu-item index="/direct">
          <el-icon>
            <ChatLineRound />
          </el-icon>
          <span>指令信息</span>
        </el-menu-item>

      </el-menu>
    </el-aside>

    <el-container>
      <el-header>
        <div class="device-status-bar">
          <span class="status-label">设备状态:</span>
          <div class="status-list" v-if="switchStore.value">
            <!-- 多设备模式：显示所有设备 -->
            <div
              v-for="(status, dNo) in deviceStatusMap"
              :key="dNo"
              class="status-item"
            >
              <span
                class="status-dot"
                :class="statusClass(status)"
              ></span>
              <span class="device-no">{{ dNo }}</span>
            </div>
            <span v-if="Object.keys(deviceStatusMap).length === 0" class="no-devices">
              暂无设备
            </span>
          </div>
          <div class="status-list" v-else>
            <!-- 单设备模式：只显示设备1 -->
            <div class="status-item">
              <span
                class="status-dot"
                :class="statusClass(deviceStatusMap['202111'])"
              ></span>
              <span class="device-no">202111</span>
            </div>
          </div>
        </div>
        <div v-if="false" class="switch_b">
          <span>是否显示设备相关</span>
          <el-switch v-model="switchStore.value" />
        </div>
        <div class="alarm-toggle">
          <span class="alarm-label">告警声音</span>
          <el-switch v-model="alarmMuted" active-text="静音" inactive-text="开启" />
        </div>
      </el-header>

      <el-main>
        <router-view></router-view>
      </el-main>

      <el-footer>
        万物互联 ---- 传感器
      </el-footer>

    </el-container>


  </el-container>

</template>

<style lang="scss" scoped>
.layout-container {
  height: 100vh;

  .el-aside {
    width: 200px;
    background-color: #232323;

    .menu {
      border-right: none;

      .el-menu-item {
        display: flex;
        align-items: center;

        .el-icon {
          margin-right: 10px;
        }

        &:hover {
          background-color: #2a2a2a !important;
        }
      }
    }
  }
  .el-header {
    background-color: #fff;
    border-bottom: 1px solid #e6e6e6;
    display: flex;
    align-items: center;
    padding: 0 20px;

    .device-status-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;

      .status-label {
        color: #606266;
        font-size: 14px;
        white-space: nowrap;
      }

      .status-list {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;

        .status-item {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          background-color: #f5f7fa;
          border-radius: 4px;

          .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;

            &.online {
              background-color: #67c23a;
              box-shadow: 0 0 4px #67c23a;
            }

            &.offline {
              background-color: #909399;
            }

            &.error {
              background-color: #f56c6c;
              box-shadow: 0 0 4px #f56c6c;
            }
          }

          .device-no {
            font-size: 12px;
            color: #606266;
          }
        }

        .no-devices {
          font-size: 12px;
          color: #909399;
        }
      }
    }

    .switch_b {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 10px;

      span {
        color: #606266;
        font-size: 14px;
      }
    }

    .alarm-toggle {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 8px;

      .alarm-label {
        color: #606266;
        font-size: 13px;
      }
    }
  }

  .el-main {
    background-color: #f5f7fa;
    padding: 20px;
  }

  .el-footer {
    background-color: #fff;
    border-top: 1px solid #e6e6e6;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
  }
}
</style>
