const { getAlarmLevel, normalizeErrorCode, VSTATUS_TEXT } = require("./alarm")
const defaultOutboundEchoTracker = require("./outboundEchoTracker")

const parseIncomingPayload = (topic, rawStr) => {
  try {
    return JSON.parse(rawStr)
  } catch (error) {
    console.error(`[MQTT消息解析失败] topic=${topic}，原始payload不是合法JSON`, {
      raw: rawStr,
      error: error.message,
    })
    return null
  }
}

// MQTT 消息分类分发器：
// 按 topic 后缀把消息路由到对应模块。
const createTopicDispatcher = ({
  broadcastToClients,
  directHandler,
  saveHandler,
  timeSyncHandler,
  waterControlHandler,
  outboundEchoTracker = defaultOutboundEchoTracker,
}) => {
  return async (topic, payload) => {
    const rawStr = payload.toString()
    console.log("[MQTT收到原始数据]", topic, "|", rawStr)

    if (topic === "device/direct" && outboundEchoTracker.consumeIfTracked(topic, rawStr)) {
      console.log("[MQTT忽略本机下发回环]", topic)
      return
    }

    const data = parseIncomingPayload(topic, rawStr)
    if (!data) {
      return
    }

    const deviceId = data.d_no

    if (!deviceId) {
      console.error("MQTT消息缺少d_no:", topic)
      return
    }

    // 当前项目不启用心跳机制，收到旧设备的心跳消息也直接忽略。
    if (topic === "device/heartbeat") {
      return
    }

    // 传感器数据：入库 + 推送给前端实时页 + 驱动水循环自动控制引擎 + 记录设备在线活跃。
    if (topic === "device/sensor") {
      try {
        const devicePresenceService = require("../services/devicePresenceService")
        devicePresenceService.recordDeviceActivity(deviceId)
      } catch {}

      saveHandler.saveSensorData(topic, payload, (err) => {
        if (err) {
          console.error("传感器数据保存失败:", err.message)
          return
        }

        broadcastToClients("sensor_realtime", data)
      })

      if (waterControlHandler && typeof waterControlHandler.onSensorData === "function") {
        Promise.resolve(waterControlHandler.onSensorData(deviceId, data)).catch((err) => {
          console.error("[WaterControl] 传感器数据处理异常:", err)
        })
      }

      try {
        const waterFlowService = require("../services/waterFlowService")
        Promise.resolve(waterFlowService.onSensorFlowData(deviceId, data)).catch((err) => {
          console.error("[WaterFlow] 流量计算处理异常:", err)
        })
      } catch {}

      try {
        const thermalAnalysisService = require("../services/thermalAnalysisService")
        Promise.resolve(thermalAnalysisService.onSensorThermalData(deviceId, data)).catch((err) => {
          console.error("[ThermalAnalysis] 热工效能计算处理异常:", err)
        })
      } catch {}

      try {
        const deviceRuntimeService = require("../services/deviceRuntimeService")
        Promise.resolve(deviceRuntimeService.onSensorRuntimeData(deviceId, data)).catch((err) => {
          console.error("[DeviceRuntime] 累计运行时长处理异常:", err)
        })
      } catch {}
      return
    }

    // 行为数据：入库 + 推送给前端行为实时页。
    if (topic === "device/behavior") {
      saveHandler.savebehaviorData(topic, payload, (err) => {
        if (err) {
          console.error("行为数据保存失败:", err.message)
          return
        }

        broadcastToClients("behavior_realtime", data)
      })
      return
    }

    // 错误数据：入库 + 推送错误流 + 必要时转成报警流。
    if (topic === "device/error") {
      saveHandler.saveErrorData(topic, payload, (err, savedData) => {
        if (err) {
          console.error("错误数据保存失败:", err.message)
          return
        }

        const errorPayload = savedData || data
        broadcastToClients("error_realtime", errorPayload)

        const code = normalizeErrorCode(errorPayload.type, errorPayload.e_msg)
        if (code !== 0) {
          broadcastToClients("alarm_realtime", {
            d_no: errorPayload.d_no,
            code,
            level: getAlarmLevel(code),
            text: errorPayload.e_msg || VSTATUS_TEXT[code] || `异常(${code})`,
            updated_at: errorPayload.c_time || null,
          })
        }
      })
      return
    }

    // 设备主动请求校时。
    if (topic === "device/timeRequest" && timeSyncHandler && typeof timeSyncHandler.handleTimeRequest === "function") {
      await timeSyncHandler.handleTimeRequest(deviceId, data)
      return
    }

    // 设备对指令执行结果的回报。
    if (topic === "device/direct") {
      directHandler.updateDirect(topic, payload)
      broadcastToClients("direct_response", data)
    }
  }
}

module.exports = {
  createTopicDispatcher,
}
