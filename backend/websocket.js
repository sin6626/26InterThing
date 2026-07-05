// WebSocket 只做一件事：把后端刚收到的实时数据广播给前端页面。
const { WebSocketServer } = require('ws');

let wss = null;

/**
 * 初始化 WebSocket 服务
 * @param {Object} server - HTTP 服务器对象，用于绑定 WebSocket 服务
 */
function initWebSocket(server) {
  // 绑定到已经启动的 HTTP 服务上，前端就能通过同一端口建立 WS 连接。
  wss = new WebSocketServer({ server });
  
  // 监听 WebSocket 连接事件
  wss.on('connection', (ws) => {
    // 当有新客户端连接时，在控制台打印日志
    console.log('新客户端已连接 WebSocket');
    
    // 当前业务里，客户端发来的消息不会驱动核心逻辑；
    // 这里保留日志，主要用于联调时确认 WebSocket 通路是否正常。
    ws.on('message', (message) => {
      // 当收到客户端消息时，打印消息内容（转换为字符串）
      console.log('收到来自客户端的 WebSocket 消息:', message.toString());
    });

    // 监听 WebSocket 错误事件
    ws.on('error', (error) => {
      // 当发生错误时，打印错误信息
      console.error('WebSocket 错误:', error);
    });
    
    // 监听 WebSocket 连接关闭事件
    ws.on('close', () => {
      // 当客户端断开连接时，打印日志
      console.log('WebSocket 客户端断开连接');
    });
  });

  // 在控制台打印 WebSocket 服务初始化完成的信息
  console.log('WebSocket 服务已初始化');
}

/**
 * 向所有已连接的WebSocket客户端广播消息
 * @param {string} type - 消息类型
 * @param {any} data - 要发送的数据
 */
function broadcastToClients(type, data) {
  // 如果 WebSocket 还没初始化，直接跳过广播。
  if (!wss) return;
  // 统一把推送消息包装成 { type, data }，前端按 type 分发处理。
  const payload = JSON.stringify({ type, data });
  // 遍历所有已连接的客户端
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // 1 代表 OPEN 状态
      client.send(payload);
    }
  });
}

module.exports = { initWebSocket, broadcastToClients };
