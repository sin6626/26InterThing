const mqttClient = require("../mqtt")
const heartbeat = require("../mqtt/mqtt_hander/heartbeat")
const { buildDeviceCommandPayload } = require("../mqtt/commandMapper")
const directHistoryRepository = require("../repositories/directHistoryRepository")
const directRepository = require("../repositories/directRepository")
const { buildTree } = require("../utils/directTree")
const { createTimeSyncService } = require("./timeSyncService")

// 指令服务层：
// 负责“读指令树、写数据库、判断设备在线状态、下发 MQTT、缓存离线消息”。
const timeSyncService = createTimeSyncService({ mqttClient })

const normalizeValue = (value, fType) => {
  // 页面控件值需要先转成数据库里统一保存的字符串形态。
  if (fType === "1") return value ? "on" : "off"
  if (fType === "6" && Array.isArray(value)) return value.join(",")
  return value
}

const getDirectTrees = async (dNo) => {
  // 同时拉全局配置树和设备个性化配置树，前端页面会并排展示。
  const [globalRows, deviceRows] = await Promise.all([
    directRepository.getGlobalConfigRows(),
    directRepository.getDeviceConfigRows(dNo),
  ])

  return {
    globalTree: buildTree(globalRows),
    deviceTree: buildTree(deviceRows),
  }
}

const dispatchGlobalCommand = async (configId, topic, value) => {
  // 全局指令的含义是“对所有设备都生效”，所以这里要遍历所有设备编号。
  const deviceNumbers = await directRepository.getAllDeviceNumbers()

  deviceNumbers.forEach((dNo) => {
    const status = heartbeat.getDeviceStatus(dNo)
    // 先把页面/数据库里的值翻译成设备端真正认识的 payload。
    const commandPayload = buildDeviceCommandPayload({
      config_id: configId,
      topic,
      value,
    })

    const offlinePayload = {
      topic,
      commandPayload,
    }

    // 在线设备立即发，离线设备先缓存，等恢复在线后补发。
    if (status && status.status === "online") {
      const mqttTopic = `device/${topic}/direct`
      mqttClient.publishToDevice(mqttTopic, commandPayload).catch((error) => {
        console.error(`发送全局指令到设备 ${dNo} 失败:`, error)
      })
      return
    }

    heartbeat.storeOfflineMessage(dNo, offlinePayload)
  })

  console.log(`全局指令已发送给 ${deviceNumbers.length} 个设备`)
}

const updateGlobalDirect = async ({ config_id, f_type, value }) => {
  // 先写数据库，保证页面刷新后能看到最新值；
  // MQTT 下发作为异步副作用继续执行。
  const newValue = normalizeValue(value, f_type)
  const [oldValue, config] = await Promise.all([
    directRepository.getGlobalDirectValue(config_id),
    directRepository.getDirectConfigById(config_id),
  ])
  await directRepository.upsertGlobalDirect(config_id, newValue)
  await directHistoryRepository.insertDirectHistory({
    config_id,
    direct_name: config?.t_name,
    direct_type: config?.topic || "global",
    new_value: newValue,
    old_value: oldValue,
    remark: "Web手动控制",
  })

  directRepository
    .getTopicByConfigId(config_id)
    .then((topic) => {
      if (!topic) return
      return dispatchGlobalCommand(config_id, topic, newValue)
    })
    .catch((error) => {
      console.error("全局指令下发失败:", error)
    })
}

const dispatchDeviceCommand = async (dNo, configId, newValue) => {
  // 单设备指令比全局指令少一步“遍历所有设备”，其他思路一致。
  const topic = await directRepository.getTopicByConfigId(configId)
  if (!topic) {
    throw new Error("未找到对应的topic")
  }

  const payload = {
    d_no: dNo,
    config_id: configId,
    value: newValue,
    topic,
  }

  const commandPayload = buildDeviceCommandPayload(payload)
  const status = heartbeat.getDeviceStatus(dNo)

  if (status && status.status === "online") {
    const mqttTopic = `device/${payload.topic}/direct`
    mqttClient.publishToDevice(mqttTopic, commandPayload).catch((error) => {
      console.error("发送指令失败:", error)
    })
    return
  }

  heartbeat.storeOfflineMessage(dNo, {
    topic: payload.topic,
    commandPayload,
  })
}

const updateDeviceDirect = async (dNo, { config_id, f_type, value }) => {
  // 单设备值存在就 update，不存在就 insert。
  const newValue = normalizeValue(value, f_type)
  const [oldValue, config] = await Promise.all([
    directRepository.getDeviceDirectValue(config_id, dNo),
    directRepository.getDirectConfigById(config_id),
  ])
  const results = await directRepository.updateDeviceDirectValue(config_id, newValue, dNo)

  if (results.affectedRows === 0) {
    await directRepository.insertDeviceDirectValue(config_id, newValue, dNo)
  }

  await directHistoryRepository.insertDirectHistory({
    config_id,
    d_no: dNo,
    direct_name: config?.t_name,
    direct_type: config?.topic || "device",
    new_value: newValue,
    old_value: oldValue,
    remark: "Web手动控制",
  })

  dispatchDeviceCommand(dNo, config_id, newValue).catch((error) => {
    console.error("设备指令下发失败:", error)
  })
}

const updateTime = async (time) => {
  // 手动时间同步本质上也是一条“特殊指令”，只是 topic 固定为时间同步主题。
  await timeSyncService.updateTime(time)
  await directHistoryRepository.insertDirectHistory({
    direct_name: "时间同步",
    direct_type: "time_sync",
    new_value: time || "当前时间",
    remark: "设备时间同步",
  })
}

const getDirectHistory = async (query) => {
  const result = await directHistoryRepository.getDirectHistory(query)
  return {
    status: 0,
    message: "查询成功",
    data: result.rows,
    total: result.total,
  }
}

const getDirectTypes = async () => {
  const rows = await directRepository.getDirectTypes()
  return {
    status: 0,
    message: "查询成功",
    data: [
      ...rows,
      { value: "time_sync", label: "时间同步" },
    ],
  }
}

module.exports = {
  getDirectHistory,
  getDirectTrees,
  getDirectTypes,
  updateDeviceDirect,
  updateGlobalDirect,
  updateTime,
}
