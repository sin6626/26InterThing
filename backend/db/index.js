// 数据库连接在项目里仍沿用 mysql2 的回调版，
// 上层如果需要 Promise，会在 repository/query.js 中再包装一层。
const mysql = require('mysql2');

// 公开仓库里不再写死本地密码，统一从环境变量读取。
const env = process.env

// 这里维护应用层默认连接配置。
const dbConfig = {
  host: env.DB_HOST || 'localhost',
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER || 'root',
  password: env.DB_PASSWORD || '123456',
  database: env.DB_NAME || '26InterThing'
};

// 使用连接池而不是单连接，避免并发查询时频繁建立连接。
const db = mysql.createPool(dbConfig);

// 启动时主动试连一次，方便第一时间发现数据库配置问题。
function testDbConnection() {
  db.getConnection((err, connection) => {
    if (err) {
      console.error('数据库连接失败：', err.message);
      return;
    }
    console.log('数据库连接成功！');
    // 连接归还给池，后续查询会复用，不保留在当前作用域。
    connection.release();
  });
}

testDbConnection();

module.exports = db;
