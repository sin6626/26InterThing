<script setup>
// 页面通用卡片容器：统一标题栏和右上角扩展操作区样式。
const props = defineProps({
  title: {
    type: String,
    default: '标题'
  }
})

</script>

<template>
  <el-card class="page-container">
    <template #header>
      <div class="header">
        <span>{{ props.title }}</span>
        <div class="extra">
          <slot name="extra"></slot>
        </div>
      </div>
    </template>
    <!-- 主体内容由具体页面通过默认插槽填充。 -->
    <slot></slot>
  </el-card>

</template>

<style lang="scss" scoped>
.page-container {
  min-height: 100%;
  box-sizing: border-box;

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
}
</style>
