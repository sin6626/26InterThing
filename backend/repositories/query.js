const db = require("../db")

// mysql 回调风格统一包成 Promise，方便 service / repository 使用 async/await。
const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) {
        // 这里直接把数据库原始错误抛出去，交给上层统一处理和记录。
        reject(err)
        return
      }

      resolve(results)
    })
  })
}

module.exports = {
  query,
}
