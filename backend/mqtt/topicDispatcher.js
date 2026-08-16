const { getAlarmLevel, normalizeErrorCode, VSTATUS_TEXT } = require("./alarm")

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
  heartbeatHandler,
  saveHandler,
  timeSyncHandler,
}) => {
  return async (topic, payload) => {
    const rawStr = payload.toString()
    console.log("[MQTT收到原始数据]", topic, "|", rawStr)

    const data = parseIncomingPayload(topic, rawStr)
    if (!data) {
      return
    }

    const deviceId = data.d_no

    if (!deviceId) {
      console.error("MQTT消息缺少d_no:", topic)
      return
    }

    // 心跳消息只更新在线状态，不直接入业务数据表。
    if (topic === "device/heartbeat") {
      heartbeatHandler.handleHeartbeat(deviceId, data)
      return
    }

    // 传感器数据：入库 + 推送给前端实时页。
    if (topic === "device/sensor") {
      saveHandler.saveSensorData(topic, payload, (err) => {
        if (err) {
          console.error("传感器数据保存失败:", err.message)
          return
        }

        broadcastToClients("sensor_realtime", data)
      })
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
            text: VSTATUS_TEXT[code] || errorPayload.e_msg || `异常(${code})`,
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
