// 所有 MQTT 入站订阅统一在这里注册，方便排查“当前服务到底监听了哪些主题”。
const registerSubscriptions = (mqttClient) => {
  const subscriptions = [
    ["device/sensor", "成功订阅传感器数据主题"],
    ["device/behavior", "成功订阅行为数据主题"],
    ["device/error", "成功订阅错误数据主题"],
    ["device/timeRequest", "成功订阅时间请求主题"],
    ["device/direct", "成功订阅设备端指令上报主题"],
  ]

  subscriptions.forEach(([topic, logText]) => {
    mqttClient.subscribe(topic, (err) => {
      if (!err) {
        console.log(logText)
      }
    })
  })
}

module.exports = {
  registerSubscriptions,
}
