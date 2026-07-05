import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getDeviceNumbers } from '@/api/sensor'

export const useDeviceNumbers = () => {
  // 设备编号在多个页面复用，所以抽成组合式函数统一处理加载态和报错。
  const loading = ref(false)
  const numbers = ref([])
  const loadError = ref(null)

  const fetchDeviceNumbers = async () => {
    loading.value = true
    loadError.value = null
    try {
      const res = await getDeviceNumbers()
      // 下拉框统一转成 { value, label } 结构，页面无需重复适配。
      numbers.value = (res.data || []).map((num) => ({
        value: String(num),
        label: String(num),
      }))
    } catch (error) {
      numbers.value = []
      loadError.value = error
      ElMessage.warning('设备编号接口不可用，请检查后端接口')
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    loadError,
    numbers,
    fetchDeviceNumbers,
  }
}
