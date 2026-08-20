# 水循环物联网应用层 API 文档（2026-07-08）

本文档面向 2026 湖南省物联网应用创新竞赛技能赛应用层项目，按当前代码实现整理。

## 概述

当前系统负责：

- 接收温度、压力、流量等传感器数据。
- Web 端展示实时数据、历史数据、图表和错误信息。
- Web 端下发水泵、阈值、控制模式等指令。
- 接收设备端本地指令变更上报。
- 记录指令操作历史。
- 预留智能判定服务接口。

## 基础信息

| 项 | 值 |
|---|---|
| HTTP 基础 URL | `http://localhost:3000/api` |
| WebSocket | `ws://localhost:3000` |
| MQTT Broker | `mqtt://localhost:1883` |
| 数据格式 | JSON |

## 通用响应

成功：

```json
{
  "status": 0,
  "message": "查询成功",
  "data": {}
}
```

失败：

```json
{
  "status": 1,
  "message": "错误描述"
}
```

## HTTP API 总览

| 模块 | 接口 | 方法 | 说明 |
|---|---|---|---|
| 数据 | `/sensor/realtime/:tableprefix` | GET | 获取最新一条实时展示数据 |
| 数据 | `/sensor/sensorChart/:tableprefix` | GET | 获取图表数据 |
| 数据 | `/sensor/past/:tableprefix` | GET | 获取历史分页数据 |
| 数据 | `/sensor/recognize` | POST | 提交勾选传感器数据，预留智能判定 |
| 错误 | `/error` | GET | 获取错误分页数据 |
| 设备 | `/devices` | GET | 查询设备列表 |
| 设备 | `/deviceNumbers` | GET | 获取设备编号下拉列表 |
| 设备 | `/devicesInfo/:number` | GET | 获取单个设备信息 |
| 设备 | `/updateDevice` | POST | 更新设备信息 |
| 设备 | `/addDevice` | POST | 新增设备 |
| 设备 | `/deleteDevice/:id` | GET | 删除设备 |
| 设备 | `/deviceStatus` | GET | 获取全部设备状态 |
| 指令 | `/direct/:d_no` | GET | 获取指令树 |
| 指令 | `/updateDirect/:d_no` | POST | 更新单设备指令 |
| 指令 | `/updateDirectGlobal` | POST | 更新全局指令 |
| 指令 | `/direct/types/options` | GET | 获取指令类型选项 |
| 指令 | `/direct/history/list` | GET | 查询指令操作历史 |
| 时间 | `/updateTime` | POST | 手动触发全局时间同步 |

## 数据接口

### 获取实时数据

```http
GET /sensor/realtime/:tableprefix
```

路径参数：

| 参数 | 说明 |
|---|---|
| `tableprefix` | `t_sensor` 或 `t_behavior` |

查询参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `d_no` | 否 | 设备编号，默认 `202111` |

说明：

- `t_sensor` 用于温度、压力、流量等传感器数据。
- `t_behavior` 用于行为数据、智能判定结果或设备行为状态。
- 字段展示由对应的 `_field_mapper` 表决定。

### 获取图表数据

```http
GET /sensor/sensorChart/:tableprefix
```

查询参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `d_no` | 否 | 设备编号 |
| `limit` | 否 | 返回点数，默认 200，范围 10-500 |
| `startTime` | 否 | 开始时间 |
| `endTime` | 否 | 结束时间 |

说明：

- 按分钟聚合数值字段。
- 不再按 `online` 字段过滤。
- 如果没有可画图字段，返回空图表。

### 获取历史数据

```http
GET /sensor/past/:tableprefix
```

查询参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `d_no` | 否 | 设备编号 |
| `startTime` | 否 | 开始时间 |
| `endTime` | 否 | 结束时间 |
| `pagenum` | 是 | 页码 |
| `pagesize` | 是 | 每页条数 |

示例：

```http
GET /sensor/past/t_sensor?pagenum=1&pagesize=20&d_no=202111
```

### 提交智能判定识别

```http
POST /sensor/recognize
```

请求体：

```json
{
  "rows": [
    {
      "编号": "202111",
      "温度1": 26.5,
      "压力": 12.4,
      "流量": 18.6,
      "更新时间": "2026-07-08 09:00:00"
    }
  ]
}
```

当前状态：

- 该接口现在是占位接口。
- 会校验是否选择了数据。
- 还没有真正调用组委会提供的智能判定 HTTP 服务。
- 后续接入后，识别结果应写入行为数据表，必要时写入错误表并触发告警。

成功示例：

```json
{
  "status": 0,
  "message": "已选择 1 条传感器数据，智能判定接口待接入",
  "data": {
    "recognized": false,
    "selectedCount": 1,
    "message": "已选择 1 条传感器数据，智能判定接口待接入"
  }
}
```

## 错误接口

```http
GET /error
```

查询参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `d_no` | 否 | 设备编号 |
| `startTime` | 否 | 开始时间 |
| `endTime` | 否 | 结束时间 |
| `pagenum` | 是 | 页码 |
| `pagesize` | 是 | 每页条数 |

设备端可只上报 `e_no + type`，应用层会尝试按映射表转换为中文错误信息。

## 设备接口

### 查询设备列表

```http
GET /devices?pagenum=1&pagesize=10
```

可选查询：`number`、`device_name`。

### 获取设备编号

```http
GET /deviceNumbers
```

用于前端设备下拉框。

### 获取设备状态

```http
GET /deviceStatus
```

返回设备在线/离线和 `VStatus` 对应状态。

## 指令接口

### 获取指令树

```http
GET /direct/:d_no
```

返回：

- `globalTree`：全局指令配置。
- `deviceTree`：指定设备的指令配置。

### 更新单设备指令

```http
POST /updateDirect/:d_no
```

请求体：

```json
{
  "config_id": 7,
  "f_type": "1",
  "value": true
}
```

说明：

- 后端会把开关类值标准化为 `on/off`。
- 数据库更新成功后，会写入 `t_direct_history`，方向为 `应用层下发`。
- 在线设备立即通过 MQTT `device/direct` 下发，离线设备缓存后上线补发；payload 会包含 `d_no`、`config_id`、`topic` 和最终指令值。

### 更新全局指令

```http
POST /updateDirectGlobal
```

请求体同单设备指令。

说明：

- 写入 `t_direct_global`。
- 写入操作历史，方向为 `应用层下发`。
- 会对所有设备逐个生成带 `d_no` 的 payload，并执行在线直发或离线缓存。

### 获取指令类型选项

```http
GET /direct/types/options
```

来源：`t_direct_config`。

返回示例：

```json
{
  "status": 0,
  "message": "查询成功",
  "data": [
    { "value": "pump", "label": "水泵开关" },
    { "value": "temperatureUpper", "label": "温度上限" },
    { "value": "time_sync", "label": "时间同步" }
  ]
}
```

### 查询操作历史

```http
GET /direct/history/list
```

查询参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `direct_type` | 否 | 指令类型 |
| `startTime` | 否 | 开始时间 |
| `endTime` | 否 | 结束时间 |
| `pagenum` | 否 | 页码，默认 1 |
| `pagesize` | 否 | 每页条数，默认 10 |

返回字段：

| 字段 | 说明 |
|---|---|
| `operate_time` | 操作时间 |
| `direct_name` | 指令名称 |
| `direct_type` | 指令类型 |
| `d_no` | 设备编号，空值表示全局 |
| `old_value` | 原值 |
| `new_value` | 新值 |
| `result` | `success`表示MQTT已发布；`failed`表示发布失败、超时或设备离线仅缓存 |
| `remark` | 页面显示为“方向”：`应用层下发` 或 `设备端上报` |

成功示例：

```json
{
  "status": 0,
  "message": "查询成功",
  "data": [
    {
      "operate_time": "2026-07-08T09:00:00.000Z",
      "direct_type": "pump",
      "d_no": "202111",
      "direct_name": "水泵开关",
      "old_value": "on",
      "new_value": "off",
      "remark": "设备端上报"
    }
  ],
  "total": 1
}
```

### 手动全局时间同步

```http
POST /updateTime
```

请求体：

```json
{
  "time": "2026-07-08 09:00:00"
}
```

说明：

- 应用层发布到 `device/updateTime`。
- 写入操作历史，方向为 `应用层下发`。

### 水循环自动控制

```http
POST /waterControl/start
POST /waterControl/stop
POST /waterControl/reset
GET  /waterControl/status/:d_no
```

启动和停止请求体：

```json
{ "d_no": "202111" }
```

故障复位必须由页面完成现场确认后提交：

```json
{ "d_no": "202111", "confirmed": true }
```

状态接口的`data`在原状态字段基础上包含：

| 字段 | 说明 |
|---|---|
| `faultCode` / `faultReason` | 结构化故障码及中文原因 |
| `sensorUpdatedAt` | 四项关键传感器各自的服务端接收时间戳 |
| `staleSensors` | 超时、缺失或非法的传感器字段列表 |
| `pumpState` / `heaterState` | 由传感器上报得到的实际状态 |
| `desiredPumpState` / `desiredHeaterState` | 应用层最近成功发布的期望状态 |
| `lastCommandStatus` | 最近一次MQTT发布的`pending/success/failed`结果 |

`data_timeout`按秒计算；`command_timeout`只约束MQTT发布/PUBACK，不等待设备或继电器执行ACK。

## WebSocket 推送

服务端向前端统一推送：

```json
{
  "type": "消息类型",
  "data": {}
}
```

| type | 触发条件 | 说明 |
|---|---|---|
| `sensor_realtime` | 收到 `device/sensor` | 传感器实时数据 |
| `behavior_realtime` | 收到 `device/behavior` | 行为实时数据 |
| `error_realtime` | 收到 `device/error` | 错误实时数据 |
| `alarm_realtime` | 错误或异常状态触发 | 前端告警通知 |
| `device_status` | 心跳或状态变化 | 设备在线/异常状态 |
| `direct_response` | 收到 `device/direct` | 设备端指令上报或执行状态 |

## MQTT 协议

### 设备端发给应用层

| 主题 | 说明 |
|---|---|
| `device/heartbeat` | 心跳，payload 必须带 `d_no` |
| `device/sensor` | 温度、压力、流量数据，payload 必须带 `d_no` |
| `device/behavior` | 行为/判定数据，payload 必须带 `d_no` |
| `device/error` | 错误数据，payload 必须带 `d_no` |
| `device/timeRequest` | 请求时间同步，payload 必须带 `d_no` |
| `device/direct` | 设备端本地指令变更上报，payload 必须带 `d_no` |

设备端指令上报示例：

```json
{
  "d_no": "202111",
  "config_id": 7,
  "value": "off"
}
```

或：

```json
{
  "d_no": "202111",
  "config_id": 7,
  "value": "pump off"
}
```

### 应用层发给设备端

| 主题 | 说明 |
|---|---|
| `device/direct` | 应用层下发业务控制指令，payload 带 `d_no` |
| `device/updateTime` | 定向或全局时间同步；定向时 payload 带 `d_no` |

`device/direct` 下发 payload 统一格式：

```json
{
  "d_no": "202111",
  "config_id": 7,
  "topic": "pump",
  "value": "off"
}
```

当前常见指令 topic：

| config_id | 指令 | topic | value |
|---|---|---|---|
| `0` | 控制模式 | `master` | `on/off` |
| `7` | 水泵开关 | `pump` | `on/off` |
| `9` | 温度下限 | `temperatureLower` | 数值 |
| `10` | 温度上限 | `temperatureUpper` | 数值 |
| `11` | 流量下限 | `flowLow` | 数值 |
| `12` | 流量上限 | `flowUpper` | 数值 |
| `13` | 压力下限 | `pressuerLow` | 数值 |
| `15` | 压力上限 | `pressureUpper` | 数值 |

## 数据表说明

### `t_direct_history`

操作历史表，启动时自动创建。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `operate_time` | 操作时间 |
| `direct_type` | 指令类型 |
| `d_no` | 设备编号 |
| `config_id` | 指令配置 ID |
| `direct_name` | 指令名称 |
| `old_value` | 原值 |
| `new_value` | 新值 |
| `result` | 当前默认 `success` |
| `remark` | 当前作为“方向”使用 |

方向规则：

- 应用层接口下发：`应用层下发`
- 设备端 MQTT direct 上报：`设备端上报`

## 注意事项

1. 比赛现场局域网禁止外网依赖。
2. 设备端 MQTT 字段必须和映射表配置一致。
3. 当前智能判定接口仍是占位实现。
4. 当前压力下限 topic 在数据库中为 `pressuerLow`，联调时按数据库实际值使用。
5. 操作历史的“方向”只有两类，不再记录复杂来源。

*文档更新时间：2026-07-08*
