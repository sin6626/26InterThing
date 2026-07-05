<script setup>
import { ref } from "vue"
import { ElMessage } from 'element-plus'
import { devicesInfo } from '@/api/sensor'

const showDialog = ref(false)

// 表单数据
const passForm = ref({
  id: '',
  number: '', // 编号
  device_name: '',
  remarks: '',
  ctime: ''
})

// 表单验证规则
const validateDeviceNumber = (_rule, value, callback) => {
  const num = Number(value)
  if (!Number.isInteger(num) || num < 1 || num > 10) {
    callback(new Error('设备编号必须是 1 到 10 的整数'))
    return
  }
  callback()
}

const rules = {
  device_name: [{ required: true, message: '请输入设备名称', trigger: 'blur' }],
  number: [
    { required: true, message: '请输入设备编号', trigger: 'blur' },
    { validator: validateDeviceNumber, trigger: 'blur' },
  ],
  remarks: [{ required: true, message: '请输入备注', trigger: 'blur' },]
}

// 表单引用
const passFormRef = ref(null)

const open = async (row) => {
  showDialog.value = true
  console.log(row)

  // 有number编号就回显数据, 没有就是新增数据
  if (row.number) {
    // 调用接口获取数据才行
    const res = await devicesInfo(row.number)
    // console.log(res)

    passForm.value = res.data

  } else {
    passForm.value = {
      id: '',
      number: '', // 设备编号
      device_name: '',
      remarks: '',
      ctime: ''
    }
  }
}

import { updateDevice, addDevice } from '@/api/sensor'
import dayjs from 'dayjs'
const emit = defineEmits(['success'])

// 修改后提交表单
const btnOK = () => {
  passFormRef.value.validate(async (isOK) => {
    if (isOK) {
      // 提醒父组件再次渲染数据
      if (passForm.value.id) {
        // 因为无法设置id, 所以只有编辑的时候才有值
        // api提交表单
        const res = await updateDevice(passForm.value)
        // console.log(res.message)
        emit('success', 'edit')
        ElMessage.success(res.message)
      } else {
        // 没有id那就是新增, 新增的id由数据库那边主键递增
        // 添加之前先把时间改成sql的预期格式, 使用yyyy-MM-dd HH:mm:ss
        passForm.value.ctime = dayjs(passForm.value.ctime).format('YYYY-MM-DD HH:mm:ss')

        const res = await addDevice(passForm.value)
        console.log(res.message)
        emit('success', 'add')
        ElMessage.success(res.message)
      }
      btnCancel()
    } else {
      console.log('error submit!!')
      return false
    }
  })
}

const btnCancel = () => {
  showDialog.value = false
}

defineExpose({
  open
})



</script>

<template>
  <el-dialog v-model="showDialog" width="500px" title="设备信息" @close="btnCancel" destroy-on-close>
    <!-- 放置表单 -->
    <el-form ref="passFormRef" label-width="120px" :model="passForm" :rules="rules">
      <el-form-item label="设备编号" prop="number">
        <el-input v-model="passForm.number" size="small" />
      </el-form-item>
      <el-form-item label="设备名称" prop="device_name">
        <el-input v-model="passForm.device_name" size="small" />
      </el-form-item>
      <el-form-item label="备注" prop="remarks">
        <el-input v-model="passForm.remarks" size="small" type="textarea" />  
      </el-form-item>
      <el-form-item label="创建时间" prop="ctime">
        <el-date-picker v-model="passForm.ctime" type="datetime" size="small" :disabled="!!passForm.id" />
      </el-form-item>
      <el-form-item>
        <el-button size="small" type="primary" @click="btnOK">{{ passForm.id ? '确认' : '确认添加' }}</el-button>
        <el-button size="small" @click="btnCancel">取消</el-button>
      </el-form-item>
    </el-form>
  </el-dialog>
</template>
