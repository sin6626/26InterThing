// 设备管理相关接口：
// - 设备列表 / 单设备详情
// - 新增 / 编辑 / 删除
// - 当前在线状态
// 这里还是“接口层”，真正复杂的状态来源来自 heartbeat 模块。

// 导入数据库操作模块
const db = require("../db/index")

// 导入dayjs
const dayjs = require("dayjs") // 导入dayjs

// 导入处理设备状态模块
const heartbeat = require("../mqtt/mqtt_hander/heartbeat")  // 新增

// 返回实际设备列表结合在线状态与控制状态。
exports.deviceStatus = (req, res) => {
  const sql = `select number from t_device where number is not null and number <> '' order by cast(number as unsigned), number`
  db.query(sql, (err, results) => {
    if (err) return res.cc(err)

    const statusMap = heartbeat.getAllDeviceStatus()
    let waterControlEngine = null
    try {
      waterControlEngine = require("../services/waterControlEngine")
    } catch {}

    const fullStatusMap = {}

    // 先把数据库中登记的所有设备初始化（离线或取实时在线状态）
    results.forEach((row) => {
      const num = String(row.number).trim()
      if (!num) return
      if (statusMap[num]) {
        fullStatusMap[num] = statusMap[num]
      } else {
        fullStatusMap[num] = {
          status: "offline",
          vstatus: null,
          level: "unknown",
          text: "离线",
          updated_at: null,
          control: waterControlEngine ? waterControlEngine.getDeviceControlStatus(num) : null,
        }
      }
    })

    // 如果还有通过 MQTT 活跃但未登记在 t_device 的设备，也并入展示
    Object.entries(statusMap).forEach(([dNo, info]) => {
      if (!fullStatusMap[dNo]) {
        fullStatusMap[dNo] = info
      }
    })

    res.send({
      status: 0,
      message: "查询成功",
      data: fullStatusMap,
    })
  })
}

// 设备列表分页查询。
// 这里支持按设备编号、设备名做模糊检索。
exports.devices = (req, res) => {
  const { number, pagenum, pagesize, device_name } = req.query

  const queryParams = []
  const whereConditions = []

  if (number) {
    whereConditions.push("number like ?")
    queryParams.push(`%${number}%`)
  }
  if (device_name) {
    whereConditions.push("device_name like ?")
    queryParams.push(`%${device_name}%`)
  }

  // 构建where子句
  // join() 会在数组的每一个元素之间都插入指定的分隔符
  const whereClause =
    whereConditions.length > 0 ? whereConditions.join(" and ") : "1=1"

  // 先查总数，再查分页数据，这样前端分页器能拿到 total。
  const countSql = `select count(*) as total from t_device where ${whereClause}`

  db.query(countSql, queryParams, (err, countResult) => {
    if (err) return res.cc(err)

    const total = countResult[0].total

    // 查询分页数据
    const offset = (parseInt(pagenum) - 1) * parseInt(pagesize)
    const sql = `select * from t_device where ${whereClause}
     order by ctime desc 
     limit ? offset ?`

    queryParams.push(parseInt(pagesize), offset)

    db.query(sql, queryParams, (err, results) => {
      if (err) return res.cc(err)
      if (results.length === 0) {
        return res.send({
          status: 0,
          message: "查询成功",
          total,
          data: [],
        })
      }

      // 格式化查询的时间
      results.forEach((item) => {
        item.ctime = dayjs(item.ctime).format("YYYY-MM-DD HH:mm:ss")
      })

      res.send({
        status: 0,
        message: "查询成功",
        total,
        data: results,
      })
    })
  })
}

// 获取设备编号下拉列表。
// 前端很多页面会先拿这个接口，再决定默认查看哪个设备。
exports.deviceNumbers = (req, res) => {
  //and number <> ''：过滤掉 number 为空字符串 '' 的记录
  //order by cast(number as unsigned), number：排序规则。
  // 第一排序条件：cast(number as unsigned)，将 number 转换为无符号整数后排序。
  // 第二排序条件：number，按 number 的原始字符串类型排序。
  const sql = `select number from t_device where number is not null and number <> '' order by cast(number as unsigned), number`

  db.query(sql, (err, results) => {
    if (err) return res.cc(err)

    // 使用Set去重并处理结果数组
    const data = [ 
      // 使用Set创建新的集合，去除重复元素
      ...new Set(
        //Boolean：这是一个非常经典的 JavaScript 技巧。Boolean 作为一个函数被调用时，会将传入的值转换为布尔值。经过上一步的 trim() 后，如果原字符串是空字符串 ""，或者转换后变成了 "null"/"undefined"，Boolean("") 会返回 false，而 Boolean("123") 会返回 true
        results.map((item) => String(item.number).trim()).filter(Boolean),
      ),
    ]

    res.send({
      status: 0,
      message: "查询成功",
      data,
    })
  })
}

// 获取单个设备详情，给“编辑设备”弹窗做回显。
exports.devicesInfo = (req, res) => {
  const number = req.params.number

  const sql = `select * from t_device where number = ?`
  db.query(sql, number, (err, results) => {
    if (err) return res.cc(err)
    if (results.length === 0) return res.cc("查询成功，但是没有数据")

    // 只会有一个数据的
    results[0].ctime = dayjs(results[0].ctime).format("YYYY-MM-DD HH:mm:ss")

    res.send({
      status: 0,
      message: "查询成功",
      data: results[0],
    })
  })
}

// 更新设备基础信息。
exports.updateDevice = (req, res) => {
  const { id, number, device_name, remarks } = req.body

  const sql = `update t_device set device_name = ?, remarks = ?, number = ? where id = ?`
  db.query(sql, [device_name, remarks, number, id], (err, results) => {
    if (err) return res.cc(err)
    if (results.affectedRows !== 1) return res.cc("更新失败")

    res.send({
      status: 0,
      message: "更新成功",
    })
  })
}

// 新增一条设备记录。
exports.addDevice = (req, res) => {
  const { number, device_name, remarks, ctime } = req.body
  const sql = `insert into t_device (device_name, remarks, ctime, number) values (?, ?, ?, ?)`
  db.query(sql, [device_name, remarks, ctime, number], (err, results) => {
    if (err) return res.cc(err)
    if (results.affectedRows !== 1) return res.cc("新增失败")

    res.send({
      status: 0,
      message: "添加成功",
    })
  })
}

// 删除设备记录。
exports.deleteDevice = (req, res) => {
  const id = req.params.id

  const sql = `delete from t_device where id = ?`
  db.query(sql, id, (err, results) => {
    if (err) return res.cc(err)
    if (results.affectedRows !== 1) return res.cc("删除失败")

    res.send({
      status: 0,
      message: "删除成功",
    })
  })
}
