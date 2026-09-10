// 统一的 axios 实例：集中处理 baseURL、超时和错误提示。
import axios from 'axios'
import { ElMessage } from 'element-plus'

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  timeout: 5000
})

const parseRequestBody = (data) => {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

const sanitizeHeaders = (headers) => {
  const source = typeof headers?.toJSON === 'function' ? headers.toJSON() : (headers || {})
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => {
      const normalizedKey = key.toLowerCase()
      const sensitive = normalizedKey === 'authorization'
        || normalizedKey === 'cookie'
        || normalizedKey.includes('token')
      return [key, sensitive ? '[已脱敏]' : value]
    }),
  )
}

const resolveRequestUrl = (config = {}) => {
  try {
    return new URL(config.url || '', config.baseURL || window.location.origin).toString()
  } catch {
    return `${config.baseURL || ''}${config.url || ''}`
  }
}

const logApiCall = ({ config, response, statusCode }) => {
  console.log(JSON.stringify({
    statusCode,
    method: (config?.method || 'get').toUpperCase(),
    url: resolveRequestUrl(config),
    params: {
      query: config?.params || {},
      body: parseRequestBody(config?.data),
    },
    requestHeaders: sanitizeHeaders(config?.headers),
    response,
  }, null, 2))
}

// 后端接口约定 status=1 代表业务失败，这里统一转成 rejected Promise。
request.interceptors.response.use(
  response => {
    // logApiCall({
    //   config: response.config,
    //   response: response.data,
    //   statusCode: response.status,
    // })

    if (response.data.status === 1) {
      if (!response.config?.silent) {
        ElMessage.error(response.data.message || '操作失败')
      }
      return Promise.reject(new Error(response.data.message || '操作失败'))
    }
    return response.data
  },
  error => {
    logApiCall({
      config: error.config,
      response: error.response?.data || { message: error.message },
      statusCode: error.response?.status ?? null,
    })
    // 网络层错误统一翻译成中文提示，页面无需重复写状态码分支。
    let message = ''
    const status = error.response?.status
    switch (status) {
      case 400:
        message = '请求参数错误'
        break
      case 401:
        message = '未授权，请登录'
        break
      case 403:
        message = '拒绝访问'
        break
      case 404:
        message = '请求地址出错'
        break
      case 408:
        message = '请求超时'
        break
      case 500:
        message = '服务器内部错误'
        break
      case 501:
        message = '服务未实现'
        break
      case 502:
        message = '网关错误'
        break
      case 503:
        message = '服务不可用'
        break
      case 504:
        message = '网关超时'
        break
      case 505:
        message = 'HTTP版本不受支持'
        break
      default:
        message = '网络连接故障'
    }
    if (!error.config?.silent) {
      ElMessage.error(message)
    }
    return Promise.reject(error)
  }
)


export default request
