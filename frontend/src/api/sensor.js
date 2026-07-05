import request from '@/utils/request'

// 实时卡片接口：tableprefix 决定查传感器还是行为数据。
export const getSensorDataRealTime = (tableprefix, d_no) => {
  return request.get(`/api/sensor/realtime/${tableprefix}`, {
    params: d_no ? { d_no } : {},
  })
}

// 图表接口默认走后端默认参数。
export const getEchartsSensor = (tableprefix) => {
  return request.get(`/api/sensor/sensorChart/${tableprefix}`)
}

// 图表查询版允许附带设备编号、点数限制、时间范围等参数。
export const getEchartsSensorByQuery = (tableprefix, params) => {
  return request.get(`/api/sensor/sensorChart/${tableprefix}`, {
    params,
  })
}

// 历史列表查询。
export const getSensorDataPast = (params, tableprefix) => {
  return request.get(`/api/sensor/past/${tableprefix}`, {
    params,
  })
}

// 错误记录列表。
export const getErrorData = (params) => {
  return request.get(`/api/error`, {
    params,
  })
}

// 设备管理页列表。
export const getDeviceInfo = (params) => {
  return request.get(`/api/devices`, {
    params,
  })
}

// 下拉框设备编号接口；silent 模式避免初始化阶段弹全局错误提示。
export const getDeviceNumbers = () => {
  return request.get('/api/deviceNumbers', {
    silent: true,
  })
}



// 单个设备详情回显。
export const devicesInfo = (number) => {
  return request.get(`/api/devicesInfo/${number}`)
}

// 更新设备信息。
export const updateDevice = (data) => {
  return request.post(`/api/updateDevice`, data)
}

// 新增设备。
export const addDevice = (data) => {
  return request.post(`/api/addDevice`, data)
}

// 删除设备。
export const deleteDevice = (id) => {
  return request.get(`/api/deleteDevice/${id}`)
}

// 顶部状态栏使用的在线状态接口。
export const getDeviceStatus = () => {
  return request.get('/api/deviceStatus', {
    silent: true,
  })
}


// 获取直控页树形指令数据。
export const getDirectInfo = (d_no) => {
  return request.get(`/api/direct/${d_no}`)
}

// 更新单设备指令。
export const updateDirect = (data, d_no) => {
  return request.post(`/api/updateDirect/${d_no}`, data)
}

// 更新全局默认指令。
export const updateDirectGlobal = (data) => {
  return request.post('/api/updateDirectGlobal', data)
}

// 手动触发时间同步。
export const updateTime = (time) => {
  return request.post(`/api/updateTime`, { time })
}
