// 应用层入口：
// 1. 启动 HTTP 接口服务
// 2. 初始化 MQTT 客户端，让应用层可以和设备侧通信
// 3. 初始化 WebSocket，把实时数据主动推给前端页面
const express = require("express")
const cors = require("cors")
const dbPool = require("./db") // 引入数据库连接池
const mqttClient = require("./mqtt") // 引入 MQTT 客户端
const { ensureBehaviorPidMapping } = require("./services/behaviorPid")
const { ensureErrorMessageMappings } = require("./services/errorMessageMapping")
// const mqttClientTest = require('./mqtt/sensorTest') // 引入 MQTT 测试心跳的客户端

// 创建 Express 实例。
const app = express()
const port = Number(process.env.PORT || 3000) // 接口服务端口（可自定义，如 3000、4000 等）
const frontendOrigins = String(
  process.env.FRONTEND_ORIGINS ||
    "http://localhost:5173,http://localhost:5174,http://localhost:5100",
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)

// 中间件：解决跨域问题（允许前端调用）- 优化为精准配置
app.use(
  cors({
    origin: frontendOrigins, // 允许 Vite / HBuilder 等开发端口
    credentials: true, // 允许携带 Cookie（如需登录态可保留）
    methods: ["GET", "POST", "PUT", "DELETE"], // 允许的请求方法
    allowedHeaders: ["Content-Type", "Authorization"], // 允许的请求头
  }),
)

// 中间件：添加 ngrok 安全提示跳过头（解决 ERR_NGROK_6024 页面拦截问题）
// ngrok是一个内网的穿透工具, 当时打包app端之后测试的, 现在可以不用,本身项目不会正式上线
app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "6024") // 关键：跳过 ngrok 安全提示
  next()
})

// 中间件：解析 JSON 格式的请求体（用于处理 POST 请求数据）
// 配置解析表单数据的中间件
// 只能解析application/x-www-form-urlencoded格式的表单数据
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

// 统一错误响应助手。
// 后面的 handler 只要调用 res.cc(err) 就能返回一致的错误结构。
app.use((req, res, next) => {
  // status 默认值为1, 表示失败的情况
  // err的值可能是一个错误对象, 也可能是一个错误的描述字符串
  res.cc = (err, status = 1) => {
    res.send({
      status,
      message: err instanceof Error ? err.message : err,
    })
  }
  next()
})

// 把 MQTT 客户端挂到 request 上，方便后续某些 handler 直接访问。
app.use((req, res, next) => {
  req.mqttClient = mqttClient
  next()
})

// 导入路由模块
const sensorRouter = require("./router/sensor.js")
app.use("/api", sensorRouter)

// 启动时确保一些“运行依赖的数据映射”已经准备好。
ensureBehaviorPidMapping()
  .then(() => {
    console.log("行为数据 PID 映射已就绪")
  })
  .catch((error) => {
    console.error("初始化行为数据 PID 映射失败:", error.message)
  })

ensureErrorMessageMappings()
  .then(() => {
    console.log("错误码映射表已就绪")
  })
  .catch((error) => {
    console.error("初始化错误码映射表失败:", error.message)
  })

// 启动 HTTP 服务。
const server = app.listen(port, () => {
  console.log(`Node 接口服务已启动，地址：http://localhost:${port}`)
})

// WebSocket 和 HTTP 共用一个 server，这样前端能直接连同一个端口。
const { initWebSocket } = require("./websocket")
initWebSocket(server)
