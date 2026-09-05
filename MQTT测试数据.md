# MQTT 联调测试数据（按当前代码整理）

更新时间：2026-07-08

## 连接信息

| 项 | 值 |
|---|---|
| Broker | `mqtt://localhost:1883` |
| Username | `sin` |
| Password | `1234` |
| QoS | 建议 `0` 或 `1`，后端下发使用 `1` |
| 示例设备 | `202111` |

## 总规则

1. 设备编号不放在 MQTT topic 里，统一放在 JSON payload 的 `d_no`。
2. 设备端发给应用层，只用下面 5 个 topic：`device/sensor`、`device/behavior`、`device/error`、`device/timeRequest`、`device/direct`。
3. 应用层发给设备端，只用 `device/direct` 和 `device/updateTime`。
4. payload 必须是合法 JSON；缺少 `d_no` 的设备端消息会被后端丢弃。
5. 时间建议用 `YYYY-MM-DD HH:mm:ss`。

## 设备端 -> 应用层

### 1. 传感器数据

Topic：`device/sensor`

当前数据库 `t_sensor_field_mapper` 识别这 3 个设备端字段：

| payload 字段 | 页面字段 | 入库列 | 说明 |
|---|---|---|---|
| `temp` | 温度 | `field4` | 温度值 |
| `flow` | 流量 | `field2` | 流量值 |
| `pressurre` | 压力 | `field3` | 压力值；当前库里拼写就是 `pressurre` |

标准 payload：

```json
{
  "d_no": "202111",
  "temp": 26.5,
  "flow": 18.6,
  "pressurre": 12.4,
  "VStatus": 0,
  "c_time": "2026-07-08 09:00:00",
  "online": "实时数据"
}
```

说明：

- `d_no` 必填。
- `temp`、`flow`、`pressurre` 的字段名必须和上表一致；发 `temp1`、`pressure` 当前不会入到对应列。
- `VStatus` 会写入 `t_sensor_data.vstatus`，缺省为 `0`。
- `online` 可填 `实时数据` 或 `保存数据`。

快速测试：

```json
{"d_no":"202111","temp":26.5,"flow":18.6,"pressurre":12.4,"VStatus":0,"c_time":"2026-07-08 09:00:00","online":"实时数据"}
{"d_no":"202112","temp":31.2,"flow":9.2,"pressurre":21.5,"VStatus":1,"c_time":"2026-07-08 09:00:03","online":"实时数据"}
```

### 3. 行为/判定数据

Topic：`device/behavior`

当前数据库 `t_behavior_field_mapper` 识别这些设备端字段：

| payload 字段 | 页面字段 | 入库列 | 说明 |
|---|---|---|---|
| `text_field` | 测试的行为字段 | `field4` | 行为/判定描述 |
| `pid` | PID | `field5` | 历史字段；当前没有独立 `device/pid` topic |

标准 payload：

```json
{
  "d_no": "202111",
  "text_field": "水泵正常运行",
  "c_time": "2026-07-08 09:00:00",
  "online": "实时数据"
}
```

如果确实要上报当前库里残留的 PID 字段，也走 `device/behavior`：

```json
{
  "d_no": "202111",
  "text_field": "识别到目标",
  "pid": "BOX1001,BOX1002",
  "c_time": "2026-07-08 09:00:00",
  "online": "实时数据"
}
```

### 4. 错误/告警数据

Topic：`device/error`

```json
{
  "d_no": "202111",
  "e_no": "E201",
  "type": "6",
  "e_msg": "管路压力过高",
  "c_time": "2026-07-08 09:00:06"
}
```

字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `d_no` | 是 | 设备编号 |
| `e_no` | 是 | 错误编号 |
| `type` | 是 | 错误类型/状态码 |
| `e_msg` | 否 | 错误描述；不发时后端会尝试按错误码映射 |
| `c_time` | 否 | 发生时间 |

快速测试：

```json
{"d_no":"202111","e_no":"E101","type":"3","e_msg":"压力传感器异常","c_time":"2026-07-08 09:00:03"}
{"d_no":"202112","e_no":"E201","type":"6","e_msg":"管路压力过高","c_time":"2026-07-08 09:00:06"}
```

### 5. 请求校时

Topic：`device/timeRequest`

```json
{
  "d_no": "202111",
  "reason": "power_on"
}
```

后端会向 `device/updateTime` 下发：

```json
{
  "nowTime": "09:00:00",
  "nowdate": "26.07.08",
  "d_no": "202111"
}
```

### 6. 设备端手动上报指令变化

Topic：`device/direct`

设备端如果通过本地按钮、串口、屏幕菜单等方式改了水泵/阈值/模式，要用这个 topic 回传给应用层，应用层会更新 `t_direct` 并写入操作历史，方向为 `设备端上报`。

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
  "config_id": 10,
  "value": "temperatureUpper 30"
}
```

说明：

- `config_id` 必须是 `t_direct_config.id`。
- 后端只取 `value` 的最终值；例如 `"temperatureUpper 30"` 会落库为 `"30"`。

当前指令配置：

| config_id | 指令 | topic | 合法值 |
|---|---|---|---|
| `0` | 控制模式 | `master` | `on` / `off` |
| `7` | 水泵开关 | `pump` | `on` / `off` |
| `9` | 温度下限 | `temperatureLower` | 数值 |
| `10` | 温度上限 | `temperatureUpper` | 数值 |
| `11` | 流量下限 | `flowLower` | 数值 |
| `12` | 流量上限 | `flowUpper` | 数值 |
| `13` | 压力下限 | `pressuerLower` | 数值；当前库里拼写就是 `pressuerLower` |
| `15` | 压力上限 | `pressureUpper` | 数值 |

快速测试：

```json
{"d_no":"202111","config_id":7,"value":"off"}
{"d_no":"202111","config_id":10,"value":"30"}
{"d_no":"202111","config_id":12,"value":"22"}
```

## 应用层 -> 设备端

### 1. 下发控制指令

Topic：`device/direct`

应用层从网页改指令后，会向设备端发布下面这种统一格式：

```json
{
  "d_no": "202111",
  "config_id": 7,
  "topic": "pump",
  "value": "off"
}
```

设备端处理规则：

1. 先判断 `d_no` 是不是自己的设备编号。
2. 用 `topic` 判断是哪条指令。
3. 用 `value` 执行动作。
4. 执行后如需上报本地状态变化，可再向 `device/direct` 发 `{ "d_no": "...", "config_id": ..., "value": "..." }`；应用层当前不把该上报作为执行ACK。

应用层可能下发的 payload 示例：

```json
{"d_no":"202111","config_id":0,"topic":"master","value":"on"}
{"d_no":"202111","config_id":21,"topic":"pump","value":"off"}
{"d_no":"202111","config_id":22,"topic":"heater","value":"off"}
{"d_no":"202111","config_id":10,"topic":"target_temperature","value":"35"}
{"d_no":"202111","config_id":12,"topic":"min_safe_flow","value":"0.5"}
{"d_no":"202111","config_id":13,"topic":"max_safe_pressure","value":"150"}
```

注意：后端可靠发布会连续发布两次同一条指令，设备端应按幂等处理。

应用层将`command_timeout`解释为等待MQTT发布/PUBACK的最长秒数。发布成功只代表报文已交给Broker，不代表设备或继电器已经执行。应用层会过滤同一MQTT客户端收到的本机下发回环，避免把它误记为“设备端上报”。

### 2. 下发时间

Topic：`device/updateTime`

定向校时：

```json
{
  "nowTime": "09:00:00",
  "nowdate": "26.07.08",
  "d_no": "202111"
}
```

全局校时：

```json
{
  "nowTime": "09:00:00",
  "nowdate": "26.07.08"
}
```

设备端处理规则：

- 带 `d_no`：只有对应设备处理。
- 不带 `d_no`：所有设备都可以处理。

## 最常用一键复制

### 传感器

```json
{"d_no":"202111","temp":26.5,"flow":18.6,"pressurre":12.4,"VStatus":0,"c_time":"2026-07-08 09:00:00","online":"实时数据"}
```

### 错误

```json
{"d_no":"202111","e_no":"E201","type":"6","e_msg":"管路压力过高","c_time":"2026-07-08 09:00:06"}
```

### 请求校时

```json
{"d_no":"202111","reason":"power_on"}
```

### 设备端回传关泵

```json
{"d_no":"202111","config_id":7,"value":"off"}
```
