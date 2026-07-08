# MQTT 测试数据文档（2026-07-08）

本文档面向 2026 湖南省物联网应用创新竞赛技能赛水循环项目，按当前代码实现整理。

## 连接信息

| 配置项 | 值 |
|---|---|
| Host | `localhost` |
| Port | `1883` |
| Username | `sin` |
| Password | `1234` |
| 示例设备编号 | `202111` |

## 核心约定

1. 设备端按 `device/{d_no}/...` 上报数据。
2. 应用层按 `device/{topic}/direct` 下发控制指令。
3. 设备端本地手动修改指令后，可按 `device/{d_no}/direct` 上报给应用层。
4. 指令操作历史的方向只有两类：`应用层下发`、`设备端上报`。
5. 传感器 payload 字段名以数据库字段映射表为准，推荐按温度、压力、流量配置。
6. 时间格式统一用 `YYYY-MM-DD HH:mm:ss`。

## 后端订阅主题

| 主题 | 方向 | 说明 |
|---|---|---|
| `device/+/heartbeat` | 设备端 -> 应用层 | 心跳与设备状态 |
| `device/+/sensor` | 设备端 -> 应用层 | 温度、压力、流量等传感器数据 |
| `device/+/behavior` | 设备端 -> 应用层 | 行为/研判结果数据 |
| `device/+/error` | 设备端 -> 应用层 | 错误与告警数据 |
| `device/+/timeRequest` | 设备端 -> 应用层 | 设备请求校时 |
| `device/+/direct` | 设备端 -> 应用层 | 设备端本地指令变更上报 |
| `device/+/pid` | 设备端 -> 应用层 | 可选 PID/识别清单，按行为数据处理 |

## 1. 心跳消息

主题：`device/202111/heartbeat`

```json
{"status":"online","VStatus":0,"c_time":"2026-07-08 09:00:00"}
```

说明：

- 建议每 3 秒发送一次。
- 后端 6 秒未收到心跳会把设备标记为离线。
- 第一次上线或离线恢复上线时，应用层会定向补发时间到 `device/{d_no}/updateTime`。

快速测试：

```json
{"status":"online","VStatus":0,"c_time":"2026-07-08 09:00:00"}
{"status":"online","VStatus":1,"c_time":"2026-07-08 09:00:03"}
{"status":"online","VStatus":0,"c_time":"2026-07-08 09:00:06"}
```

## 2. 传感器数据

主题：`device/202111/sensor`

推荐字段按水循环系统配置为温度、压力、流量。实际入库字段由 `t_sensor_field_mapper.p_name -> db_name` 决定。

```json
{
  "temp1": 26.5,
  "temp2": 27.1,
  "pressure": 12.4,
  "flow": 18.6,
  "VStatus": 0,
  "c_time": "2026-07-08 09:00:00",
  "online": "实时数据"
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `temp1` / `temp2` | 两个温度传感器值 |
| `pressure` | 管路压力 |
| `flow` | 管路流量 |
| `VStatus` | 设备健康主状态码，写入 `t_sensor_data.vstatus` |
| `online` | 数据来源标记，常用 `实时数据` / `保存数据` |

快速测试：

```json
{"temp1":26.5,"temp2":27.1,"pressure":12.4,"flow":18.6,"VStatus":0,"c_time":"2026-07-08 09:00:00","online":"实时数据"}
{"temp1":31.2,"temp2":30.8,"pressure":21.5,"flow":9.2,"VStatus":1,"c_time":"2026-07-08 09:00:03","online":"实时数据"}
{"temp1":25.9,"temp2":26.3,"pressure":11.8,"flow":19.4,"VStatus":0,"c_time":"2026-07-08 09:00:06","online":"保存数据"}
```

## 3. 行为/研判数据

主题：`device/202111/behavior`

行为数据用于承接设备侧运行行为、智能判定结果或管路状态描述。字段名同样以 `t_behavior_field_mapper` 为准。

```json
{
  "pump_status": "on",
  "judge_result": "normal",
  "action": "keep",
  "c_time": "2026-07-08 09:00:00",
  "online": "实时数据"
}
```

快速测试：

```json
{"pump_status":"on","judge_result":"normal","action":"keep","c_time":"2026-07-08 09:00:00","online":"实时数据"}
{"pump_status":"off","judge_result":"pressure_high","action":"stop_pump","c_time":"2026-07-08 09:00:03","online":"实时数据"}
```

## 4. 错误数据

主题：`device/202111/error`

推荐只发错误编号和类型，中文文案可由应用层映射。

```json
{
  "e_no": "E101",
  "type": "3",
  "c_time": "2026-07-08 09:00:03"
}
```

兼容直接带中文：

```json
{
  "e_no": "E101",
  "type": "3",
  "e_msg": "压力传感器异常",
  "c_time": "2026-07-08 09:00:03"
}
```

建议类型：

| type | 建议含义 |
|---|---|
| `1` | 一般告警 |
| `2` | 通信异常 |
| `3` | 传感器故障 |
| `4` | 执行器故障 |
| `5` | 水泵/继电器异常 |
| `6` | 压力或流量越界 |

快速测试：

```json
{"e_no":"E101","type":"3","e_msg":"压力传感器异常","c_time":"2026-07-08 09:00:03"}
{"e_no":"E201","type":"6","e_msg":"管路压力过高","c_time":"2026-07-08 09:00:06"}
```

## 5. 设备端请求时间同步

请求主题：`device/202111/timeRequest`

```json
{"reason":"power_on"}
```

应用层回复主题：`device/202111/updateTime`

```json
{
  "nowTime": "09:00:00",
  "nowdate": "26.07.08"
}
```

说明：

- 设备上电、重启或本地时钟漂移时可主动请求。
- 离线恢复上线时，应用层也会自动补发一次。

## 6. 应用层下发控制指令

应用层实际发布主题：`device/{topic}/direct`

常见水循环指令：

| 指令名称 | 当前 topic | 建议值 | 说明 |
|---|---|---|---|
| 控制模式 | `master` | `on` / `off` | 开启或关闭总控 |
| 水泵开关 | `pump` | `on` / `off` | 启停微型水泵 |
| 温度下限 | `temperatureLower` | 数值 | 温度安全区间下限 |
| 温度上限 | `temperatureUpper` | 数值 | 温度安全区间上限 |
| 流量下限 | `flowLow` | 数值 | 流量安全区间下限 |
| 流量上限 | `flowUpper` | 数值 | 流量安全区间上限 |
| 压力下限 | `pressuerLow` | 数值 | 当前数据库 topic 拼写为 `pressuerLow` |
| 压力上限 | `pressureUpper` | 数值 | 压力安全区间上限 |

当前下发 payload 规则：

- `master` 会映射为 `{"value":"on"}` / `{"value":"off"}`。
- `pump`、`temperatureUpper`、`flowLow`、`flowUpper`、`pressuerLow`、`pressureUpper` 目前走兜底格式 `{"value":"..."}`。
- `temperatureLower` 目前映射为 `{"temp_low":"..."}`。

示例：

```json
{"value":"on"}
{"value":"off"}
{"value":"20"}
{"temp_low":"24"}
```

## 7. 设备端上报本地指令变更

设备端如果通过本地按钮、串口工具或嵌入式逻辑手动修改了水泵/阈值/模式，应上报给应用层。

主题：`device/202111/direct`

最小格式：

```json
{
  "d_no": "202111",
  "config_id": 7,
  "value": "off"
}
```

兼容格式：

```json
{
  "d_no": "202111",
  "config_id": 7,
  "value": "pump off"
}
```

说明：

- 后端会把 `value` 解析为最终值。
- 后端会更新 `t_direct`。
- 后端会写入 `t_direct_history`，方向显示为 `设备端上报`。
- `config_id` 必须对应 `t_direct_config.id`，否则无法展示中文指令名称。

快速测试：

```json
{"d_no":"202111","config_id":7,"value":"off"}
{"d_no":"202111","config_id":10,"value":"temperatureUpper 30"}
{"d_no":"202111","config_id":12,"value":"flowUpper 22"}
```

## 8. 页面手动全局时间同步

应用层下发主题：`device/updateTime`

```json
{
  "nowTime": "09:00:00",
  "nowdate": "26.07.08"
}
```

## 9. 一键复制

### 正常心跳

```json
{"status":"online","VStatus":0,"c_time":"2026-07-08 09:00:00"}
```

### 传感器实时数据

```json
{"temp1":26.5,"temp2":27.1,"pressure":12.4,"flow":18.6,"VStatus":0,"c_time":"2026-07-08 09:00:00","online":"实时数据"}
```

### 压力异常错误

```json
{"e_no":"E201","type":"6","e_msg":"管路压力过高","c_time":"2026-07-08 09:00:06"}
```

### 设备端上报关泵

```json
{"d_no":"202111","config_id":7,"value":"off"}
```

### 请求校时

```json
{"reason":"power_on"}
```

*文档更新时间：2026-07-08*
