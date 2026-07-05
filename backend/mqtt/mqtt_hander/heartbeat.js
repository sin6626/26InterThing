const deviceStatus = new Map() // 存储设备状态
const offlineMessages = new Map() // 存储离线消息
let timeSyncHandler = null
let nowProvider = () => new Date()

// 心跳模块负责两件事：
// 1. 维护“设备当前是否在线”的内存状态
// 2. 在 offline -> online 时触发补时和离线消息补发

const VSTATUS_TEXT = {
  0: "正常",
  1: "一般告警",
  2: "通信异常",
  3: "传感器故障",
  4: "空调故障",
  5: "风机故障",
  6: "断电超时",
  7: "危险气体/湿度超标",
}

const nowTimeString = () => {
  const d = nowProvider()
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const normalizeVstatus = (raw) => {
  if (raw === null || raw === undefined || raw === "") return 0
  const code = Number.parseInt(raw, 10)
  if (Number.isNaN(code)) return 0
  return code
}

const getLevel = (code) => {
  if (code === 0) return "normal"
  if (code === 1) return "warning"
  return "error"
}

const buildStatusPayload = (deviceId, statusInfo) => ({
  d_no: deviceId,
  status: statusInfo.status,
  vstatus: statusInfo.status === "online" ? statusInfo.vstatus : null,
  level: statusInfo.status === "online" ? statusInfo.level : "unknown",
  text: statusInfo.status === "online" ? statusInfo.text : "离线",
  updated_at: statusInfo.updated_at,
})

exports.handleHeartbeat = (deviceId, message) => {
  // 只要收到心跳，就认为设备当前在线。
  const previousStatus = deviceStatus.get(deviceId)
  const wasOffline = !previousStatus || previousStatus.status === "offline"
  const previousCode = previousStatus?.vstatus ?? 0

  const vstatusCode = normalizeVstatus(message?.VStatus ?? message?.vstatus ?? message?.type)
  // 注意：这里的 updated_at 现在统一取应用层本机时间，
  // 不再沿用设备端可能已经漂移的 c_time。
  const statusInfo = {
    lastHeartbeat: Date.now(),
    status: "online",
    vstatus: vstatusCode,
    level: getLevel(vstatusCode),
    text: VSTATUS_TEXT[vstatusCode] || `异常(${vstatusCode})`,
    updated_at: nowTimeString(),
  }

  deviceStatus.set(deviceId, statusInfo)

  const shouldBroadcastStatus = wasOffline || previousCode !== vstatusCode || previousStatus?.status !== "online"
  if (shouldBroadcastStatus) {
    const { broadcastToClients } = require("../../websocket")
    const statusPayload = buildStatusPayload(deviceId, statusInfo)
    broadcastToClients("device_status", statusPayload)
  }

  if (wasOffline) {
    // 设备刚恢复在线时，先补发时间，再尝试补发离线期间缓存的业务指令。
    if (typeof timeSyncHandler === "function") {
      Promise.resolve(timeSyncHandler(deviceId, { reason: "reconnect" })).catch((error) => {
        console.error("上线补发时间失败:", error)
      })
    }
    exports.handleOfflineMessages(deviceId)
  }
}


// 存储离线消息
exports.storeOfflineMessage = (deviceId, message) => {
  if (!offlineMessages.has(deviceId)) {
    offlineMessages.set(deviceId, []) // 一个设备可能有多个离线消息要存储
  }
  // 这个message是个对象,里面是有topic字段的
  offlineMessages.get(deviceId).push(message)

  // 现在做页面的修改, 先把这打印信息关了
  // console.log(offlineMessages.get(deviceId));
}

// 处理离线消息
exports.handleOfflineMessages = (deviceId) => {
  // 离线消息缓存由 publishService 真正发出，这里只负责触发。
  const messages = offlineMessages.get(deviceId)
  if (messages && messages.length > 0) {
    // 引入放在函数内解决循环依赖的问题(index.js 中 mqttClient.publishOfflineMessages 是在模块导出后才挂载的，循环依赖加载时该方法还未定义；)
    const mqttClient = require("../index")

    mqttClient
      .publishOfflineMessages(deviceId, messages)
      .then(() => {
        // 发送完成后清除该设备的离线消息
        offlineMessages.delete(deviceId)
      })
      .catch((error) => {
        console.error("发送离线消息失败:", error)
      })
  }
}

// 检查设备离线
exports.checkOfflineDevices = () => {
  // 超过 timeout 没收到心跳，就把设备从 online 切成 offline。
  const nowTime = Date.now()
  const timeout = 6000
  const { broadcastToClients } = require("../../websocket")

  for (const [deviceId, status] of deviceStatus) {
    if (nowTime - status.lastHeartbeat > timeout) {
      if (status.status === "online") {
        status.status = "offline"
        status.updated_at = nowTimeString()
        console.log(deviceStatus.get(deviceId))
        broadcastToClients("device_status", buildStatusPayload(deviceId, status))
      }
    }
  }
}

// 获取设备状态
exports.getDeviceStatus = (deviceId) => {
  // console.log('我在你之前');

  // console.log(deviceStatus.get(deviceId)) // 就是这个会出现undefined
  return deviceStatus.get(deviceId)
}

// 新增：获取所有设备状态方法
exports.getAllDeviceStatus = () => {
  const result = {}
  for (const [deviceId, status] of deviceStatus) {
    result[deviceId] = {
      status: status.status,
      vstatus: status.status === "online" ? status.vstatus : null,
      level: status.status === "online" ? status.level : "unknown",
      text: status.status === "online" ? status.text : "离线",
      updated_at: status.updated_at || null,
    }
  }
  return result
}

exports.setTimeSyncHandler = (handler) => {
  timeSyncHandler = handler
}

exports.__resetForTests = () => {
  deviceStatus.clear()
  offlineMessages.clear()
  timeSyncHandler = null
  nowProvider = () => new Date()
}

exports.__setNowProviderForTests = (provider) => {
  nowProvider = provider
}
