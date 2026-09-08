const outboundEchoTracker = require("./outboundEchoTracker")

const attachPublishHelpers = (mqttClient) => {
  // 执行器只发一次。取消/断线时移除未确认的QoS1消息，避免恢复连接后重放旧开启动作。
  const publishControl = (topic, payload, signal) => new Promise((resolve, reject) => {
    if (!mqttClient.connected || mqttClient._storeProcessing) return reject(new Error('后端的MQTT客户端未连接或正在恢复连接'))
    if (signal?.aborted) return reject(new Error('控制发布已取消'))
    const payloadText = JSON.stringify(payload)
    let messageId
    let settled = false
    const sent = packet => {
      if (packet.cmd === 'publish' && packet.topic === topic && String(packet.payload) === payloadText) messageId = packet.messageId
    }
    const cleanup = () => {
      mqttClient.removeListener?.('packetsend', sent)
      mqttClient.removeListener?.('close', disconnected)
      signal?.removeEventListener('abort', aborted)
    }
    const finish = error => {
      if (settled) return
      settled = true
      cleanup()
      if (error && messageId !== undefined) mqttClient.removeOutgoingMessage?.(messageId)
      if (error) reject(error)
      else resolve()
    }
    const disconnected = () => finish(new Error('MQTT连接中断，控制发布已取消'))
    const aborted = () => finish(new Error('控制发布已取消'))
    mqttClient.on?.('packetsend', sent)
    mqttClient.on?.('close', disconnected)
    signal?.addEventListener('abort', aborted, { once: true })
    if (topic === 'device/direct') outboundEchoTracker.track(topic, payloadText)
    console.log('[MQTT执行器下发]', { topic, payload })
    try { mqttClient.publish(topic, payloadText, { qos: 1, retain: false }, finish) }
    catch (error) { finish(error) }
  })
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
  mqttClient.publishToDevice = (topic, payload, options = {}) => {
    if (options.single) return publishControl(topic, payload, options.signal)
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
