# AGENTS.md

## 项目约束

- 使用中文沟通。
- 禁止批量删除文件或目录；如需删除，只能一次删除一个明确路径的文件。
- GitHub 仓库维护优先使用 Codex GitHub 插件，插件不可用时再考虑本机 GitHub CLI。
- 临时文件和临时工作树放在本项目目录下，不放 C 盘。
- 本项目必须使用 git 做版本控制；不要回滚用户已有改动。

## 当前项目背景

- 项目是 2026 湖南省物联网应用创新竞赛技能赛应用层准备项目。
- 技术栈：`backend` 为 Node.js/Express/MySQL/MQTT/WebSocket，`frontend` 为 Vue 3/Vite/Element Plus/ECharts。
- 当前重点对照材料：
  - `2026湖南省物联网应用创新竞赛-技能赛大纲v3.docx`
  - `技能赛竞赛细则2026 v3.docx`
  - `老师认为的大纲的要求.txt`

## 当前项目状态

- 已具备：Web 端、传感器实时/历史数据、行为数据、错误数据、设备管理、指令配置/下发、设备端指令上报、指令操作历史查询、MQTT、WebSocket、MySQL 存储。
- 指令操作历史已使用 `t_direct_history`，页面“方向”只有 `应用层下发` 和 `设备端上报` 两类。
- MQTT 入站主题已改为 `device/heartbeat`、`device/sensor`、`device/behavior`、`device/error`、`device/timeRequest`、`device/direct`；设备编号统一放在 payload 的 `d_no` 字段。
- MQTT 指令下发统一使用 `device/direct`，payload 为 `{ d_no, config_id, topic, value }`。
- 旧 PID 特殊补丁逻辑已移除。
- 智能判定已预留 HTTP 转发：后端启动时读取 `backend/.env`，配置 `AI_RECOGNIZE_URL` 后，`/api/sensor/recognize` 会把前端勾选的历史传感器数据转发给题目提供的 Python/YOLO 服务；请求体优先由 `backend/config/ai-recognize-payload.json` 模板决定；未配置 URL 时返回待接入提示。
- 现场限制：比赛局域网禁止外网；如果题目不涉及移动应用开发，不允许使用手机。
