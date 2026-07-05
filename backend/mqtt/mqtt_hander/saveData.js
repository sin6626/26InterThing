// 收集层主动上报的各类数据，最终都在这里解析并写入数据库。
const db = require("../../db")
const {
  findErrorMessageMapping,
  resolveMappedErrorMessage,
} = require("../../services/errorMessageMapping")

// 传感器数据字段是动态映射的，所以要先查字段定义，再按顺序组装 SQL。
exports.saveSensorData = (topic, payload, callback) => {
  const d_no = topic.split("/")[1]

  let data
  try {
    data = JSON.parse(payload.toString())
  } catch (e) {
    console.log('传感器数据JSON解析失败:', e.message)
    return callback?.(e)
  }

  const params = []
  params.push(d_no)

  const sql1 = 'select * from t_sensor_field_mapper order by db_name'
  db.query(sql1, (err, fieldMapper) => {
    if (err) {
      console.log('传感器字段映射查询失败:', err.message)
      return callback?.(err)
    }

    if (fieldMapper.length === 0) {
      const msg = '传感器字段映射表为空'
      console.log(msg)
      return callback?.(new Error(msg))
    }

    const fieldNames = fieldMapper.map((item) => item.db_name)

    fieldMapper.forEach((item) => {
      // p_name 是设备 payload 中的键名，db_name 是数据库列名。
      params.push(data[item.p_name])
    })

    params.push(data['c_time'])
    params.push(data['online'])

    // VStatus / vstatus 都兼容，缺失时按正常状态 0 处理。
    const vstatusValue = data['VStatus'] ?? data['vstatus'] ?? 0
    params.push(Number.isFinite(Number(vstatusValue)) ? Number(vstatusValue) : 0)

    const allColumns = ['d_no', ...fieldNames, 'c_time', 'online', 'vstatus']
    const placeholders = allColumns.map(() => '?').join(', ')
    const sql2 = `INSERT INTO t_sensor_data (${allColumns.join(', ')}) VALUES (${placeholders})`

    db.query(sql2, params, (err, res) => {
      if (err) {
        console.log('传感器数据插入失败:', err.message)
        return callback?.(err)
      }

      if (res.affectedRows === 1) {
        console.log('传感器数据插入成功')
      } else {
        console.log('传感器数据插入失败: affectedRows=' + res.affectedRows)
      }
      callback?.(null)
    })
  })
}

// 行为数据与传感器数据流程类似，只是没有 vstatus 字段。
exports.savebehaviorData = (topic, payload, callback) => {
  const d_no = topic.split("/")[1]

  let data
  try {
    data = JSON.parse(payload.toString())
  } catch (e) {
    console.log('行为数据JSON解析失败:', e.message)
    return callback?.(e)
  }

  const params = []
  params.push(d_no)

  const sql1 = 'select * from t_behavior_field_mapper order by db_name'
  db.query(sql1, (err, fieldMapper) => {
    if (err) {
      console.log('行为字段映射查询失败:', err.message)
      return callback?.(err)
    }

    if (fieldMapper.length === 0) {
      const msg = '行为字段映射表为空'
      console.log(msg)
      return callback?.(new Error(msg))
    }

    const fieldNames = fieldMapper.map((item) => item.db_name)

    fieldMapper.forEach((item) => {
      params.push(data[item.p_name])
    })

    params.push(data['c_time'])
    params.push(data['online'])

    const allColumns = ['d_no', ...fieldNames, 'c_time', 'online']
    const placeholders = allColumns.map(() => '?').join(', ')
    const sql2 = `INSERT INTO t_behavior_data (${allColumns.join(', ')}) VALUES (${placeholders})`

    db.query(sql2, params, (err, res) => {
      if (err) {
        console.log('行为数据插入失败:', err.message)
        return callback?.(err)
      }

      if (res.affectedRows === 1) {
        console.log('行为数据插入成功')
      } else {
        console.log('行为数据插入失败: affectedRows=' + res.affectedRows)
      }
      callback?.(null)
    })
  })
}

// 错误信息优先做一层应用侧中文映射，避免前端直接看到原始错误码。
exports.saveErrorData = (topic, payload, callback) => {
  const d_no = topic.split("/")[1]

  let data
  try {
    data = JSON.parse(payload.toString())
  } catch (e) {
    console.log('错误数据JSON解析失败:', e.message)
    return callback?.(e)
  }

  resolveMappedErrorMessage({
    e_no: data['e_no'],
    type: data['type'],
    e_msg: data['e_msg'],
    // 这里把查询函数作为依赖传入，测试时可以更容易替换。
    findMapping: findErrorMessageMapping,
  })
    .then((mappedMessage) => {
      const normalizedData = {
        ...data,
        d_no,
        e_msg: mappedMessage,
      }

      const params = []
      params.push(d_no)
      params.push(normalizedData['c_time'])
      params.push(normalizedData['e_msg'])
      params.push(normalizedData['e_no'])
      params.push(normalizedData['type'])

      const sql = `insert into t_error_msg (
         d_no, c_time, e_msg, e_no, type
        ) values (?, ?, ?, ?, ?)`

      db.query(sql, params, (err, res) => {
        if (err) {
          console.log('错误数据插入失败:', err.message)
          return callback?.(err)
        }

        if (res.affectedRows === 1) {
          console.log('错误数据插入成功')
        } else {
          console.log('错误数据插入失败: affectedRows=' + res.affectedRows)
        }
        callback?.(null, normalizedData)
      })
    })
    .catch((error) => {
      console.log('错误信息映射失败:', error.message)
      callback?.(error)
    })
}
