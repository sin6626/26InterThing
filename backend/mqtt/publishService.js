const outboundEchoTracker = require("./outboundEchoTracker")

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
          if (topic === "device/direct") {
            outboundEchoTracker.track(topic, payloadText)
          }
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

  // 手动全局时间同步：走 device/updateTime。
  mqttClient.updateTime = async (time) => {
    return publishReliable("device/updateTime", time)
  }

  // 定向时间同步：设备号放 payload，topic 不再区分设备。
  mqttClient.updateDeviceTime = async (deviceId, time) => {
    return publishReliable("device/updateTime", { ...time, d_no: deviceId })
  }
}

module.exports = {
  attachPublishHelpers,
}
