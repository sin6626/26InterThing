// 收集层主动上报的各类数据，最终都在这里解析并写入数据库。
const db = require("../../db")
const {
  findErrorMessageMapping,
  resolveMappedErrorMessage,
} = require("../../services/errorMessageMapping")
const { evaluateSensorVstatus } = require("../../services/sensorValidationService")

const parsePayloadWithDevice = (payload, label, callback) => {
  try {
    const data = JSON.parse(payload.toString())
    if (!data.d_no) {
      throw new Error(`${label}缺少d_no`)
    }
    return data
  } catch (e) {
    console.log(`${label}JSON解析失败:`, e.message)
    callback?.(e)
    return null
  }
}

// 传感器数据字段是动态映射的，所以要先查字段定义，再按顺序组装 SQL。
exports.saveSensorData = async (topic, payload, callback) => {
  const data = parsePayloadWithDevice(payload, "传感器数据", callback)
  if (!data) return

  let evaluatedVstatus = 0
  try {
    evaluatedVstatus = await evaluateSensorVstatus(data)
  } catch (evalErr) {
    console.warn("评估vstatus失败，降级为0:", evalErr.message)
    evaluatedVstatus = 0
  }
  data.vstatus = evaluatedVstatus

  const params = []
  params.push(data.d_no)

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

    const recordTime = data['c_time'] || data['time'] || new Date()
    params.push(recordTime)
    params.push(data['online'] || '实时数据')

    // 写入根据用户配置动态判定出的真实 vstatus（超标为 1，正常为 0）
    params.push(evaluatedVstatus)

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
  const data = parsePayloadWithDevice(payload, "行为数据", callback)
  if (!data) return

  const params = []
  params.push(data.d_no)

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

    const recordTime = data['c_time'] || data['time'] || new Date()
    params.push(recordTime)
    params.push(data['online'] || '实时数据')

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
  const data = parsePayloadWithDevice(payload, "错误数据", callback)
  if (!data) return

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
        e_msg: mappedMessage,
      }

      const params = []
      params.push(data.d_no)
      params.push(normalizedData['c_time'] || normalizedData['time'] || new Date())
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
