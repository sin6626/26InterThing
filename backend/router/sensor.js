const express = require("express");
const router = express.Router();

// 这个文件只负责“定义路由和 handler 的对应关系”，
// 具体业务逻辑放在 router_handler 和 service 里。

// 导入数据(传感器, 行为, 错误)处理的模块
const data_hander = require("../router_handler/data");
// 导入设备处理模块
const device_hander = require("../router_handler/device");
//导入指令处理模块
const direct_hander = require("../router_handler/direct");
// 导入更新

// 获取单个实时数据的数据的路由
router.get("/sensor/realtime/:tableprefix", data_hander.realtime);

// 获取图表数据的路由
router.get("/sensor/sensorChart/:tableprefix", data_hander.sensorChart);

// 获取历史数据的路由
router.get("/sensor/past/:tableprefix", data_hander.past);

// 提交勾选的传感器历史数据，后续在这里对接智能判定服务。
router.post("/sensor/recognize", data_hander.recognize);

//获取错误的数据
router.get("/error", data_hander.error);

// ------------------------------------------

// 获取/查询设备信息的路由
router.get("/devices", device_hander.devices);

// 获取设备编号列表（用于前端动态选择器）
router.get("/deviceNumbers", device_hander.deviceNumbers);

//回显设备信息的接口
router.get("/devicesInfo/:number", device_hander.devicesInfo);

// 提交设备信息的接口
router.post("/updateDevice", device_hander.updateDevice);

// 新增设备信息的接口
router.post("/addDevice", device_hander.addDevice);

// 删除设备的接口
router.get("/deleteDevice/:id", device_hander.deleteDevice);

// 获取所有设备状态
router.get("/deviceStatus", device_hander.deviceStatus);  // 新增

// ---------------------------------------------------

// 获取指令信息的路由
router.get("/direct/:d_no", direct_hander.direct);

// 获取指令类型选项和操作历史。
router.get("/direct/types/options", direct_hander.types);
router.get("/direct/history/list", direct_hander.history);

// 更新设备单独指令
router.post("/updateDirect/:d_no", direct_hander.updateDirect);

// 更新全局指令
router.post("/updateDirectGlobal", direct_hander.updateGlobalDirect);

// ---------------------------------------------------
// 时间同步相关接口：
// 指令页面手动更新时间会先打到这里，再由应用层下发 MQTT 时间消息。
router.post("/updateTime", direct_hander.updateTime);

// ---------------------------------------------------
// 水循环控制相关接口：
router.post("/waterControl/start", direct_hander.startWaterControl);
router.post("/waterControl/stop", direct_hander.stopWaterControl);
router.post("/waterControl/reset", direct_hander.resetWaterControlFault);
router.get("/waterControl/status/:d_no", direct_hander.getWaterControlStatus);

// ---------------------------------------------------
// 水循环累计流量与流速相关接口：
const waterFlow_hander = require("../router_handler/waterFlow");
router.get("/waterFlow/status/:d_no", waterFlow_hander.getWaterFlowStatus);
router.post("/waterFlow/reset", waterFlow_hander.resetWaterFlow);

// ---------------------------------------------------
// 水循环热工效能分析相关接口 (大纲 4.3 节)：
const thermal_hander = require("../router_handler/thermalAnalysis");
router.get("/thermal/status/:d_no", thermal_hander.getThermalStatus);

module.exports = router;
