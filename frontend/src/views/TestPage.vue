<script setup>
import { ref } from 'vue'
import { getDirectInfo } from '@/api/sensor.js'

const defaultProps = {
  children: 'children',
  label: 't_name',
}

// const defalutData = [
//   {
//     t_name: '控制模式',
//     value: false,
//     f_type: '1',
//     disabled: false,
//     children: [
//       {
//         t_name: '空调开关',
//         value: true,
//         f_type: '1',
//         disabled: false,
//         children: [
//           {
//             t_name: '空调模式',
//             value: '1',
//             f_type: '1',
//             disabled: false
//           },
//           {
//             t_name: '空调功率',
//             value: '600',
//             f_type: '3',
//             disabled: false
//           }
//         ]
//       },
//       {
//         t_name: '风机开关',
//         value: true,
//         f_type: '1',
//         disabled: false,
//         children: [
//           {
//             t_name: '风机模式',
//             value: '1',
//             f_type: '3',
//             disabled: false
//           },
//           {
//             t_name: '风机功率',
//             value: '100',
//             f_type: '2',
//             disabled: false
//           }
//         ]
//       },
//       {
//         t_name: '温差',
//         value: '3',
//         f_type: '2',
//         disabled: false
//       },
//       {
//         t_name: '温度下限阈值',
//         value: '25',
//         f_type: '2',
//         disabled: false

//       },
//       {
//         t_name: '温度上限阈值',
//         value: '35',
//         f_type: '2',
//         disabled: false

//       },
//       {
//         t_name: '光照阈值',
//         value: '30',
//         f_type: '2',
//         disabled: false
//       },
//     ]
//   }
// ]



const treeData = ref([])

const getList = async () => {
  const res = await getDirectInfo()
  console.log(res.data)
  treeData.value = res.data
}
getList()

const handleNodeClick = (data) => {
  console.log(data)
}

const treeRef = ref()

</script>

<template>
  <el-tree ref="treeRef" :data="treeData" :props=defaultProps @node-click="handleNodeClick" :expand-on-click-node=false
    class="custom-tree" default-expand-all>
    <template #default="{ node, data }">
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-right: 20px;">
        <div style="display: flex; align-items: center;">
          <el-icon>
            <location />
          </el-icon>
          <span>{{ node.label }}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
          <!-- 开关按钮 -->
          <template v-if="data.f_type === '1'">
            <span v-if="node.label === '控制模式'">手动</span>
            <span v-else-if="node.label === '风机模式'">正转</span>
            <span v-else-if="node.label === '空调模式'">制冷</span>
            <span v-else>关</span>

            <el-switch v-if="node.label === '控制模式'" :disabled="data.disabled" v-model="data.value"
              style="--el-switch-on-color: #48a2ff; --el-switch-off-color: #13ce66" />
            <el-switch v-else-if="node.label === '空调模式'" :disabled="data.disabled" v-model="data.value"
              style="--el-switch-on-color: #ed721d; --el-switch-off-color: #2153b3" />
            <el-switch v-else v-model="data.value" :disabled="data.disabled" />

            <span v-if="node.label === '控制模式'">自动</span>
            <span v-else-if="node.label === '风机模式'">反转</span>
            <span v-else-if="node.label === '空调模式'">制热</span>
            <span v-else>开</span>
          </template>
          <!-- 输入框 -->
          <el-input v-else-if="data.f_type === '2'" v-model="data.value" :disabled="data.disabled" style="width: 120px" />
          <!-- 滑动按钮 -->
          <el-slider v-else-if="data.f_type === '3'" v-model="data.value" :disabled="data.disabled" style="width: 120px" />
          <!-- 时间框 -->
          <el-time-picker v-else-if="data.f_type === '4'" v-model="data.value" :disabled="data.disabled" format="HH:mm" value-format="HH:mm" />
          <!-- 单选框 -->
          <el-radio-group v-else-if="data.f_type === '5'" :disabled="data.disabled"  v-model="data.value">
            <el-radio label="on">开启</el-radio>
            <el-radio label="off">关闭</el-radio>
          </el-radio-group>
        </div>
      </div>
    </template>
  </el-tree>
</template>




<style>
.custom-tree {
  --el-tree-node-hover-bg-color: rgba(169, 169, 169, 0.1);
  font-size: 16px;
}

.custom-tree .el-tree-node__content {
  color: #131313;
  padding: 8px 0;
  margin-bottom: 4px;
}

.custom-tree .el-tree-node__content:hover {
  background-color: rgba(140, 63, 63, 0.1);
}

.custom-tree .el-tree-node {
  margin-bottom: 8px;
}

.custom-tree span {
  color: #131313;
}
</style>

