import { ref } from 'vue'
import { getDeviceStatus } from '@/api/sensor'
import { onRealtimeMessage } from '@/utils/wsRealtime'

// 设备状态做成共享 ref，多个页面和布局栏可以复用同一份数据。
const deviceStatusMap = ref({})

// 只保留一份 WebSocket 监听，避免重复订阅。
let stopWsListen = null

/**
 * 设备控制状态管理。当前项目不启用心跳，在线状态统一为 unmonitored。
 */
export function useDeviceStatus() {
  // 兼容后端返回字符串版和对象版两种状态结构。
  const normalizeStatusInfo = (raw) => {
    if (!raw || typeof raw === 'string') {
      return {
        status: 'unmonitored',
        vstatus: null,
        level: 'unknown',
        text: '未启用心跳',
        updated_at: null,
      }
    }

    return {
      status: raw.status || 'unmonitored',
      vstatus: raw.status === 'online' ? raw.vstatus ?? 0 : null,
      level: raw.level || (raw.status === 'online' ? 'normal' : 'unknown'),
      text: raw.text || (raw.status === 'online' ? '正常' : '未启用心跳'),
      updated_at: raw.updated_at || null,
      control: raw.control || null,
    }
  }

  // 首次通过 HTTP 拉全量状态，后续再用 WebSocket 增量更新。
  const fetchDeviceStatus = async () => {
    try {
      const res = await getDeviceStatus()
      if (res.status === 0 && res.data) {
        const normalized = {}
        Object.entries(res.data).forEach(([dNo, info]) => {
          normalized[dNo] = normalizeStatusInfo(info)
        })
        deviceStatusMap.value = normalized
      }
    } catch (error) {
      console.error('获取设备状态失败:', error)
    }
  }

  // 实时消息覆盖发生变化的那台设备
  const startListening = () => {
    if (stopWsListen) return

    stopWsListen = onRealtimeMessage('device_status', (payload) => {
      if (payload && payload.d_no) {
        deviceStatusMap.value = {
          ...deviceStatusMap.value,
          [payload.d_no]: normalizeStatusInfo(payload),
        }
      }
    })
  }

  // 页面销毁时释放监听。
  const stopListening = () => {
    if (stopWsListen) {
      stopWsListen()
      stopWsListen = null
    }
  }

  return {
    deviceStatusMap,
    fetchDeviceStatus,
    startListening,
    stopListening,
  }
}
