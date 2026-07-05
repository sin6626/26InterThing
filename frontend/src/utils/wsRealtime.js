import request from '@/utils/request'

// 直接复用 axios 的 baseURL，把 http(s) 替换成 ws(s) 作为实时通道地址。
const WS_URL = request.defaults.baseURL.replace(/^http/, 'ws')

// WebSocket 实例
let ws = null
// 重连定时器
let reconnectTimer = null
// 是否手动关闭连接
let manuallyClosed = false
// 是否已显示错误提示（防止重复提示）
let hasShownError = false

// 消息类型监听器集合（type => Set<callback>）
const listeners = new Map()
// 生命周期事件监听器集合
const lifecycleListeners = new Set()

// 创建生命周期跟踪器，emit 用于分发生命周期事件
export const createLifecycleTracker = (emit) => {
  let hasOpened = false
  return {
    // WebSocket 连接打开时调用
    onOpen() {
      emit(hasOpened ? 'reconnected' : 'connected')
      hasOpened = true
    },
  }
}

// 整个前端共用一套连接状态事件，便于页面在重连后补拉数据。
const lifecycleTracker = createLifecycleTracker((event) => {
  lifecycleListeners.forEach((cb) => cb(event))
})

// 建立 WebSocket 连接
const connect = () => {
  // 已连接或正在连接时不重复连接
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

  ws = new WebSocket(WS_URL)

  // 连接打开
  //将原生标准onopen事件作为触发源
  ws.onopen = () => {
    lifecycleTracker.onOpen()
  }

  // 收到消息
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data)
      // 根据消息类型分发给对应监听器
      const set = listeners.get(message.type)
      if (!set) return
      set.forEach((cb) => cb(message.data))
    } catch (error) {
      console.error('WebSocket message parse failed:', error)
    }
  }

  // 连接关闭，自动重连（非手动关闭）
  ws.onclose = () => {
    ws = null
    if (manuallyClosed) return
    reconnectTimer = setTimeout(connect, 3000)
  }

  // 连接出错，10秒内只提示一次，自动关闭触发重连
  ws.onerror = () => {
    if (!hasShownError) {
      hasShownError = true
      setTimeout(() => {
        hasShownError = false
      }, 10000)
      console.warn('WebSocket connection failed, retrying...')
    }
    ws?.close()
  }
}

/**
 * 订阅实时消息
 * @param {string} type 消息类型
 * @param {function} callback 回调函数
 * @returns {function} 取消订阅函数
 */
export const onRealtimeMessage = (type, callback) => {
  // 注册监听器
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type).add(callback)

  manuallyClosed = false
  connect()

  // 返回取消订阅函数
  return () => {
    const set = listeners.get(type)
    if (!set) return
    set.delete(callback)
    if (set.size === 0) listeners.delete(type)

    // 没有任何监听器时关闭连接
    if (listeners.size === 0 && ws) {
      manuallyClosed = true
      ws.close()
      ws = null
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }
  }
}

/**
 * 订阅 WebSocket 生命周期事件（如连接、重连）
 * @param {function} callback 回调函数
 * @returns {function} 取消订阅函数
 */
export const onWsLifecycle = (callback) => {
  lifecycleListeners.add(callback)
  return () => {
    lifecycleListeners.delete(callback)
  }
}

// 手动触发生命周期事件（一般用于测试）
export const _emitLifecycle = (event) => {
  lifecycleListeners.forEach((cb) => cb(event))
}
