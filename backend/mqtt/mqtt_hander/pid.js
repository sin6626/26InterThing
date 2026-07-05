const db = require("../../db")
const { buildBehaviorPidPayload } = require("../../services/behaviorPid")

// PID 数据如果没有显式时间，就兜底为当前本机时间后再入库。
const nowTimeString = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 兼容 PID 以数组或逗号字符串两种格式上报。
const parsePidPayload = (payload) => {
  let data
  try {
    data = JSON.parse(payload.toString())
  } catch (e) {
    console.log("PID数据JSON解析失败:", e.message)
    return null
  }

  const pidRaw = data.PID ?? data.pid
  let pidList = []

  if (Array.isArray(pidRaw)) {
    pidList = pidRaw.map((item) => String(item).trim()).filter(Boolean)
  } else if (typeof pidRaw === "string" && pidRaw.trim()) {
    pidList = pidRaw.split(",").map((item) => item.trim()).filter(Boolean)
  }

  return {
    pidList,
    c_time: data.c_time || nowTimeString(),
  }
}

exports.savePidData = (topic, payload, callback) => {
  // 设备编号固定从 device/{d_no}/pid 主题中提取。
  const d_no = topic.split("/")[1]

  const parsed = parsePidPayload(payload)
  if (!parsed) {
    return callback(new Error("PID数据解析失败"))
  }

  const { pidList, c_time } = parsed

  if (pidList.length === 0) {
    return callback(null, null)
  }

  // 行为表里最终存的是逗号拼接字符串，同时保留原始 PID 数组用于回调返回。
  const behaviorPayload = buildBehaviorPidPayload({
    d_no,
    pidList,
    c_time,
    online: "实时数据",
  })
  const sql = `INSERT INTO t_behavior_data (d_no, field5, c_time, online) VALUES (?, ?, ?, ?)`

  db.query(sql, [d_no, behaviorPayload.pid, c_time, behaviorPayload.online], (err, res) => {
    if (err) {
      console.log("PID行为数据保存失败:", err.message)
      return callback(err)
    }

    if (res.affectedRows === 1) {
      console.log("PID行为数据保存成功:", d_no, pidList)
    } else {
      console.log("PID行为数据插入异常: affectedRows=" + res.affectedRows)
    }

    callback(null, {
      ...behaviorPayload,
      pidList,
      pidText: behaviorPayload.pid,
    })
  })
}

exports.getCurrentPidByDevice = (dNo, callback) => {
  // 直控页等场景需要知道最近一次上报的 PID 清单，用最新一条记录即可。
  const sql = `SELECT field5 as pid, c_time as last_seen
    FROM t_behavior_data
    WHERE d_no = ? AND field5 IS NOT NULL AND field5 <> ''
    ORDER BY c_time DESC
    LIMIT 1`

  db.query(sql, [dNo], (err, rows) => {
    if (err) {
      console.log("PID查询失败:", err.message)
      return callback(err)
    }

    const pidList = rows.length > 0
      ? String(rows[0].pid || "").split(",").map((item) => item.trim()).filter(Boolean)
      : []
    const lastSeen = rows.length > 0 ? rows[0].last_seen : null

    callback(null, pidList, lastSeen)
  })
}
