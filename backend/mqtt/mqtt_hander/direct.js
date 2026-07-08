// 处理设备端回传的指令执行结果，并把最终值回写到数据库。
const db = require('../../db')
const directHistoryRepository = require("../../repositories/directHistoryRepository")
const directRepository = require("../../repositories/directRepository")
const { normalizeReportedDirectValue } = require("./directPayload")

exports.updateDirect = (topic, payload) => {
  const data = JSON.parse(payload.toString())
  const newValue = normalizeReportedDirectValue(data.value)

  Promise.all([
    directRepository.getDeviceDirectValue(data.config_id, data.d_no),
    directRepository.getDirectConfigById(data.config_id),
  ]).then(([oldValue, config]) => {
    // 设备回传的 value 可能是 "key value" 这种格式，这里只取最终值部分落库。
    const sql = `update t_direct set value = ? where config_id = ? and d_no = ?;`
    const params = [newValue, data.config_id, data.d_no]

    db.query(sql, params, (err) => {
      if (err) {
        console.log(err)
      } else {
        console.log('设备回传指令状态更新成功')
        console.log("更新的指令信息为: ", data)
        directHistoryRepository
          .insertDirectHistory({
            config_id: data.config_id,
            d_no: data.d_no,
            direct_name: config?.t_name,
            direct_type: config?.topic || "device",
            new_value: newValue,
            old_value: oldValue,
            remark: "设备端上报",
          })
          .catch((error) => {
            console.error("设备端上报指令历史记录失败:", error.message)
          })
      }
    })
  }).catch((error) => {
    console.error("设备端上报指令处理失败:", error.message)
  })
}

