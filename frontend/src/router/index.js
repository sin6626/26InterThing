import { createRouter, createWebHistory } from 'vue-router'

// 所有业务页面都挂在统一布局下，按“数据类型 / 功能页”分组。
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [ 
    {
      path: '/',
      name: 'lagout',
      component: () => import('@/views/layout/LayoutContainer.vue'),
      children: [
        {
          path: '/sensorData/realtime',
          name: 'sensorRealTimeData',
          component: () => import('@/views/showSensor/RealTimeData.vue')
        },
        {
          path: '/sensorData/past',
          name: 'sensorPastData',
          component: () => import('@/views/showSensor/PastData.vue')
        },
        {
          path: '/behavior/realtime',
          name: 'behaviorRealTime',
          component: () => import('@/views/showBehavior/RealTimeData.vue')
        },
        {
          path: '/behavior/past',
          name: 'behaviorPastData',
          component: () => import('@/views/showBehavior/PastData.vue')
        },
        {
          path: '/error_data',
          name: 'errorData',
          component: () => import('@/views/ErrorData.vue')
        },
        {
          path: '/device',
          name: 'device',
          component: () => import('@/views/device/DeviceMange.vue')
        },
        {
          path: '/direct',
          name: 'direct',
          component: () => import('@/views/direct/DirectInfo.vue')
        },
        {
          path: '/direct/history',
          name: 'directHistory',
          component: () => import('@/views/direct/DirectHistory.vue')
        },
        {
          path: '/test',
          name: 'test',
          component: () => import('@/views/TestPage.vue')
        },
        {
          path: '',
          name: 'home',
          redirect: '/sensorData/realtime'
        }
      ]
    }
  ],
})

export default router
