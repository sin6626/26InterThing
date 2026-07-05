// 处理设备端回传的指令执行结果，并把最终值回写到数据库。
const db = require('../../db')

exports.updateDirect = (topic, payload) => {
  const data = JSON.parse(payload.toString())

  // 设备回传的 value 可能是 "key value" 这种格式，这里只取最终值部分落库。
  const sql = `update t_direct set value = ? where config_id = ? and d_no = ?;`
  const params = []
  const values = data['value'].split(' ')
  // 如果没有第二段，就退回使用原始第一段，避免写入 undefined。
  params.push(values[1] ? values[1] : values[0])
  params.push(data['config_id'])
  params.push(data['d_no'])

  db.query(sql, params, (err, result) => {
    if (err) {
      console.log(err)
    } else {
      console.log('设备回传指令状态更新成功')
      console.log("更新的指令信息为: ", data)
    } 
  })

}

