// 统一的 axios 实例：集中处理 baseURL、超时和错误提示。
import axios from 'axios'
import { ElMessage } from 'element-plus'

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  timeout: 5000
})

// 后端接口约定 status=1 代表业务失败，这里统一转成 rejected Promise。
request.interceptors.response.use(
  response => {
    console.log(JSON.stringify({
      statusCode: response.status,
      method: (response.config?.method || 'get').toUpperCase(),
      url: response.config?.url,
      params: response.config?.params || response.config?.data,
      response: response.data
    }, null, 2))

    if (response.data.status === 1) {
      if (!response.config?.silent) {
        ElMessage.error(response.data.message || '操作失败')
      }
      return Promise.reject(new Error(response.data.message || '操作失败'))
    }
    return response.data
  },
  error => {
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
