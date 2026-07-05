const { getAlarmLevel, normalizeErrorCode, VSTATUS_TEXT } = require("./alarm")

// MQTT 消息分类分发器：
// 按 topic 后缀把消息路由到对应模块。
const createTopicDispatcher = ({
  broadcastToClients,
  directHandler,
  heartbeatHandler,
  pidHandler,
  saveHandler,
  timeSyncHandler,
}) => {
  return async (topic, payload) => {
    const rawStr = payload.toString()
    console.log("[MQTT收到原始数据]", topic, "|", rawStr)

    const data = JSON.parse(rawStr)
    const deviceId = topic.split("/")[1]

    // 心跳消息只更新在线状态，不直接入业务数据表。
    if (topic.endsWith("/heartbeat")) {
      console.log(deviceId)
      heartbeatHandler.handleHeartbeat(deviceId, data)
      return
    }

    // 传感器数据：入库 + 推送给前端实时页。
    if (topic.endsWith("/sensor")) {
      data.d_no = deviceId
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
    if (topic.endsWith("/behavior")) {
      data.d_no = deviceId
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
    if (topic.endsWith("error")) {
      data.d_no = deviceId
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

    // PID 被当作“行为数据的一种特殊形态”单独处理。
    if (topic.endsWith("/pid") && pidHandler && typeof pidHandler.savePidData === "function") {
      pidHandler.savePidData(topic, payload, (err, result) => {
        if (err) {
          console.error("PID 清单处理失败:", err.message)
          return
        }

        if (!result) return

        broadcastToClients("behavior_realtime", {
          d_no: result.d_no,
          pid: result.pidText,
          PID: result.pidList,
          c_time: result.c_time || data.c_time || null,
          online: result.online || "实时数据",
        })
      })
      return
    }

    // 设备主动请求校时。
    if (topic.endsWith("/timeRequest") && timeSyncHandler && typeof timeSyncHandler.handleTimeRequest === "function") {
      await timeSyncHandler.handleTimeRequest(deviceId, data)
      return
    }

    // 设备对指令执行结果的回报。
    if (topic.endsWith("direct")) {
      console.log(topic)
      directHandler.updateDirect(topic, payload)
      broadcastToClients("direct_response", data)
    }
  }
}

module.exports = {
  createTopicDispatcher,
}
