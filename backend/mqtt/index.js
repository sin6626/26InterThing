// MQTT 模块入口：
// 1. 负责连接 Broker
// 2. 负责订阅设备上报主题
// 3. 负责把消息分发给 heartbeat / saveData / direct 等模块
const mqtt = require("mqtt")
const heartbeat = require("./mqtt_hander/heartbeat")
const save = require("./mqtt_hander/saveData")
const direct = require("./mqtt_hander/direct")
const { broadcastToClients } = require("../websocket")
const { attachPublishHelpers } = require("./publishService")
const { registerSubscriptions } = require("./subscriptions")
const { createTopicDispatcher } = require("./topicDispatcher")
const { createTimeSyncService } = require("../services/timeSyncService")

const env = process.env

const mqttOptions = {
  clientId: env.MQTT_CLIENT_ID || "portfolio_admin",
  host: env.MQTT_HOST || "localhost",
  port: Number(env.MQTT_PORT || 1883),
  username: env.MQTT_USERNAME || "sin",
  password: env.MQTT_PASSWORD || "1234",
}

// 建立 MQTT 连接后，整个应用层就具备了“和设备侧双向通信”的能力。
const mqttClient = mqtt.connect(mqttOptions)

// 给 mqttClient 挂上统一的发送辅助方法：
// publishToDevice / updateTime / updateDeviceTime / publishOfflineMessages。
attachPublishHelpers(mqttClient)

// 时间同步服务本身只管“生成要发的 payload”，
// 真正的 MQTT 发送还是通过 mqttClient 上面挂的方法完成。
const timeSyncHandler = createTimeSyncService({ mqttClient })
heartbeat.setTimeSyncHandler((deviceId) => {
  return timeSyncHandler.handleTimeRequest(deviceId, { reason: "reconnect" })
})

const waterControlEngine = require("../services/waterControlEngine")

// 收到每条 MQTT 消息后的“总分发器”。
const handleIncomingMessage = createTopicDispatcher({
  broadcastToClients,
  directHandler: direct,
  heartbeatHandler: heartbeat,
  saveHandler: save,
  timeSyncHandler,
  waterControlHandler: waterControlEngine,
})

// 连接成功后再订阅主题，避免应用启动时就盲目订阅。
mqttClient.on("connect", () => {
  console.log("MQTT连接成功")
  registerSubscriptions(mqttClient)
})

// 所有原始 MQTT 消息都会先走这里，再交给 topicDispatcher 做分类处理。
mqttClient.on("message", (topic, payload) => {
  Promise.resolve(handleIncomingMessage(topic, payload)).catch((error) => {
    console.error("处理MQTT消息失败:", error)
  })
})

// 定时检查心跳超时，把设备从 online 切到 offline。
const offlineCheckTimer = setInterval(() => {
  heartbeat.checkOfflineDevices()
}, 3000)
if (offlineCheckTimer && typeof offlineCheckTimer.unref === "function") {
  offlineCheckTimer.unref()
}

mqttClient.on("error", (error) => {
  console.error("MQTT连接错误:", error)
})

module.exports = mqttClient
