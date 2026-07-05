import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'

export const useSwitchStore = defineStore('switch', () => {
  // value=true 表示多设备模式；false 时页面按单设备简化展示。
  const value = ref(false)
  const router = useRouter()
  
  const toggleSwitch = () => {
    value.value = !value.value
  }

  // 关闭多设备模式时，如果还停留在设备管理页，就自动跳回实时页。
  watch(value, (newValue) => {
    if (!newValue && router.currentRoute.value.path === '/device') {
      router.push('/sensorData/realtime')
    }
  })

  return {
    value,
    toggleSwitch
  }
})
