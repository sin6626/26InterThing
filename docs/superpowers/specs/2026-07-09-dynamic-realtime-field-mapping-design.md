# 实时字段动态映射设计

## 目标

MQTT 设备上报字段由 `t_sensor_field_mapper.p_name` 定义。修改字段映射配置但不修改数据表结构时，实时卡片与实时图表应自动使用新字段，不再修改 Vue 中的硬编码字段清单。

## 方案

采用实时接口元数据驱动映射：

1. 后端实时接口的 `metadata` 增加 `p_name`，保留现有 `f_name`、`db_name`、`unit` 和 `visible`。
2. 前端收到 WebSocket 原始 payload 后，逐项读取当前接口返回的 `metadata`。
3. 每个字段优先从 payload 的 `p_name` 取值，并兼容 `db_name` 和 `f_name`，将结果写入卡片的 `f_name`。
4. 图表序列通过 `db_name` 找到对应 metadata，再使用同一套取值规则更新分钟数据。
5. 删除传感器实时页中对 `Tout`、`LXin`、`Tin`、`field2`、`field3`、`field4` 等业务字段的硬编码。

## 数据流

`MQTT payload[p_name]` → `WebSocket 原始 payload` → `metadata` 动态解析 → `f_name` 卡片值 / `db_name` 图表序列值。

HTTP 刷新路径保持不变，仍由后端根据 `db_name` 从数据库记录生成卡片和图表数据。

## 兼容与错误处理

- 字段值允许为 `0`，只把 `null` 或 `undefined` 视为缺失。
- payload 缺少某个字段时，不用 `0` 伪造数据：卡片保留原值，图表写入 `null`。
- 保留对 `db_name` 和 `f_name` 的兼容，便于旧测试数据继续使用。
- 不增加数据库查询，不改变 MQTT 协议，不修改数据表结构。

## 测试

- 后端序列化测试确认实时 metadata 返回 `p_name`。
- 前端单元测试用 `{ temp, flow, pressurre }` 与动态 metadata 验证卡片和图表映射。
- 前端完整测试与构建通过。
- 后端完整测试通过。

## 范围

本次修复传感器实时卡片和实时图表。若行为实时页存在相同硬编码，则复用同一解析函数消除该问题，不做无关页面重构。
