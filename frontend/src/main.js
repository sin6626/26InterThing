import { createApp } from 'vue'
import { createPinia } from 'pinia'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import './assets/main.css'
import 'element-plus/dist/index.css'



import App from './App.vue'
import router from './router'

// 应用入口：注册全局图标、Pinia 和路由后再挂载。
const app = createApp(App)
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(createPinia())
app.use(router)

app.mount('#app')

