const attachPublishHelpers = (mqttClient) => {
  // 所有“发给设备”的消息都尽量走这一套可靠发布逻辑：
  // - qos: 1
  // - 双发
  // 这样收集层更不容易丢消息。
  const publishReliable = (topic, payload) => {
    return new Promise((resolve, reject) => {
      if (!mqttClient.connected) {
        reject(new Error("后端的MQTT客户端未连接"))
        return
      }

      // 单次发布逻辑抽出来，后面第一次和第二次发送复用同一套实现。
      const publishSingle = () => {
        return new Promise((pubResolve, pubReject) => {
          const payloadText = JSON.stringify(payload)
          mqttClient.publish(
            topic,
            payloadText,
            { qos: 1, retain: false },
            (err) => {
              if (err) {
                pubReject(err)
                return
              }

              pubResolve()
            },
          )
        })
      }

      // 打印最终主题和最终 payload，联调时最有价值的日志就在这里。
      console.log("[MQTT指令下发]", {
        topic,
        payload,
        payloadText: JSON.stringify(payload),
      })

      publishSingle()
        .then(() => {
          console.log(`指令第一次发送成功: ${topic}`)
          setTimeout(() => {
            publishSingle()
              .then(() => {
                console.log(`指令第二次发送成功: ${topic}`)
                resolve()
              })
              .catch((err) => {
                console.error(`指令第二次发送失败: ${err.message}`)
                reject(err)
              })
          }, 100)
        })
        .catch((err) => {
          console.error(`指令第一次发送失败: ${err.message}`)
          reject(err)
      })
    })
  }

  // 普通业务指令（如风扇、空调、阈值）统一走这个方法。
  mqttClient.publishToDevice = (topic, payload) => {
    return publishReliable(topic, payload)
  }

  // 设备离线期间先把消息缓存起来，恢复在线后由这里逐条补发。
  mqttClient.publishOfflineMessages = async (deviceId, messages) => {
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.warn(`设备 ${deviceId} 无离线消息可发送`)
      return
    }

    try {
      for (const [index, msg] of messages.entries()) {
        if (!msg || typeof msg !== "object") {
          console.error(
            `设备 ${deviceId} 第${index + 1}条离线消息格式错误：非对象类型`,
            msg,
          )
          continue
        }

        if (!msg.topic) {
          console.error(
            `设备 ${deviceId} 第${index + 1}条离线消息缺少topic字段`,
            msg,
          )
          continue
        }

        const topic = `device/${msg.topic}/direct`
        const payload = msg.commandPayload || msg
        await mqttClient.publishToDevice(topic, payload)

        if (index < messages.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }

      console.log(
        `设备 ${deviceId} 的 ${messages.length} 条离线消息（每条双发）已全部发送成功`,
      )
    } catch (error) {
      console.error(`设备 ${deviceId} 的离线消息发送失败:`, error)
      throw error
    }
  }

  // 手动全局时间同步：走 device/updateTime。
  mqttClient.updateTime = async (time) => {
    return publishReliable("device/updateTime", time)
  }

  // 定向时间同步：走 device/{d_no}/updateTime。
  mqttClient.updateDeviceTime = async (deviceId, time) => {
    return publishReliable(`device/${deviceId}/updateTime`, time)
  }
}

module.exports = {
  attachPublishHelpers,
}
