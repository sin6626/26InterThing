// 所有 MQTT 入站订阅统一在这里注册，方便排查“当前服务到底监听了哪些主题”。
const registerSubscriptions = (mqttClient, pidHandler) => {
  const subscriptions = [
    ["device/+/heartbeat", "成功订阅心跳主题"],
    ["device/+/sensor", "成功订阅传感器数据主题"],
    ["device/+/behavior", "成功订阅行为数据主题"],
    ["device/+/error", "成功订阅错误数据主题"],
    ["device/+/timeRequest", "成功订阅时间请求主题"],
    ["device/+/direct", "成功订阅设备端指令上报主题"],
  ]

  subscriptions.forEach(([topic, logText]) => {
    mqttClient.subscribe(topic, (err) => {
      if (!err) {
        console.log(logText)
      }
    })
  })

  // PID 清单是可选能力，只有启用对应处理器时才订阅，避免空回调。
  if (pidHandler && typeof pidHandler.savePidData === "function") {
    mqttClient.subscribe("device/+/pid", (err) => {
      if (!err) {
        console.log("成功订阅 PID 清单主题")
      }
    })
  }
}

module.exports = {
  registerSubscriptions,
}
