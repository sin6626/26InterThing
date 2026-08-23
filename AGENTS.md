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
- `t_direct_config` 已扩展支持 `publish_topic`、`payload_template`、`value_map` 三个字段：默认仍兼容旧 payload；如需适配设备端原始报文，可在模板里按节点配置真实 MQTT 主题、JSON 载荷模板和取值映射（例如把 `on/off` 映射为不同 `mb` 字符串）。
- MQTT 入站如果收到非法 JSON，应用层现在会记录原始 payload 并忽略该条消息，不再因为 `JSON.parse` 直接崩溃；但要真正入库和展示，设备端仍必须发送合法 JSON。
- 旧 PID 特殊补丁逻辑已移除。
- 智能判定已预留 HTTP 转发：后端启动时读取 `backend/.env`，配置 `AI_RECOGNIZE_URL` 后，`/api/sensor/recognize` 会把前端勾选的历史传感器数据转发给题目提供的 Python/YOLO 服务；请求体优先由 `backend/config/ai-recognize-payload.json` 模板决定；未配置 URL 时返回待接入提示。
- 水循环自动控制引擎（`waterControlEngine.js`）：
  - 基于配置驱动（复用 `t_direct_config` 现有的 `topic` 语义键如 `target_temperature`、`min_safe_flow`、`pump`、`heater` 等）；
  - 实现状态机（`STOPPED` / `BUILDING_FLOW` / `RUNNING` / `COOLING` / `FAULT`）；
  - 实现五重安全联锁与保护：启动限时 5s 建流超时保护、运行中低流量（<0.5L/min 持续 2s）防干烧保护、超温（>=45℃）关加热留泵散热保护、超压（>=150kPa）急停保护、传感器数据超过 `data_timeout`（默认 3s）保护；
  - 实现出口水温回差控温（$T_{out} \le 34.5℃$ 开加热，$T_{out} \ge 35.0℃$ 关加热）；
  - 实现手动开启加热前 5 项安全前置审查拦截与开关自动回滚；
  - 自动动作留痕至 `t_direct_history`，故障报警留痕至 `t_error_msg`；
  - 顶部 Header 紧凑展示实时设备状态标签（`手动` / `已停止` / `建流中` / `自动运行中` / `冷却中` / `故障`）。
  - 四项关键传感器分别维护有效值和服务端接收时间，`data_timeout`统一按秒计算；状态接口会返回`staleSensors`和`sensorUpdatedAt`，缺失或非法值不再按0参与控制。
  - 实际执行器状态只由`water_Y2`、`heat_Y1`更新，应用层下发结果单独记录为`desiredPumpState`、`desiredHeaterState`和`lastCommandStatus`。
  - 安全故障已使用结构化`faultCode`统一决策；运行失流无论加热是否开启都关加热、停泵，复合故障中超压/失流停泵优先于超温留泵散热。
  - `command_timeout`当前只表示等待MQTT发布/PUBACK的秒数，不等待设备或继电器执行ACK；发布失败/超时会抛错并记录失败历史。
  - 应用层下发`device/direct`时会登记短时消息指纹，收到同一客户端的Broker回环后直接忽略，避免误记为设备端上报。
  - 启动时幂等补齐10项控制参数和水泵/加热节点，只插入缺失配置与默认值，不覆盖现场已有参数或MQTT模板。
- 实时数据与图表设备自适应：
  - 修复后端接口（`/api/sensor/realtime`、`/api/sensor/echarts`、`countPastRows`）中残留的写死设备号 `202111` 逻辑；
  - 支持未指定设备编号时自动回退查询全局最新一条记录与图表聚合数据；
  - 前端（实时数据/行为数据）在初始化获取设备号后直接绑定并在单设备/多设备模式下无缝拉取；顶部设备状态栏动态根据实际设备 Map 进行渲染。
- 设备仿真测试控制台（`mqttTest`）：
  - 支持动态 Broker 重连配置与设备号快速切换；
  - 支持水循环物理环境仿真（开关、出水温/进水温/流量/压力滑块、自动连续上报与自然微小扰动）；
  - 支持一键安全联锁场景宏（建流超时、失流干烧、超温告警、超压急停、传感器中断、断网重连等）；
  - 支持实时监听并记录应用层下发的 Modbus RTU / JSON 指令流水与时间同步。
- 指令树与控制模式联动：
  - 根节点（`config_id=0`, `topic=master`）作为“控制模式”总开关：开启为自动模式（展开 10 项控温、安全与超时参数），关闭为手动模式（展开水泵/加热 2 项手动开关）；
  - 前端 `<el-tree>` 引入响应式重绘 key，确保模式切换时子节点 100% 自动重绘并默认全部展开；
  - 顶部 Header 状态标签与数据库/引擎状态实时联动（`自动模式` / `手动模式` / `建流中` / `自动运行中` / `冷却中` / `故障`）。
- 现场限制：比赛局域网禁止外网；如果题目不涉及移动应用开发，不允许使用手机。

## 2026-08-24 水循环需求实测结论

- 详细报告见 `水循环系统需求符合性实测报告-2026-08-24.md`；本轮在独立数据库、独立 MQTT Broker 和仿真设备中完成页面、HTTP、WebSocket、MySQL、MQTT 端到端实测。
- 后端 84 项、前端 21 项测试全部通过，前端生产构建成功；10 项参数、五态状态机及主要安全边界均能运行。
- 当前仍不可按需求最终验收：存在“停止过程中可能并发重开加热”和“发布失败的离线安全指令恢复连接后静默补发”两项 P0 风险。
- 另有故障状态每秒重复下发并写历史、仿真器加热 Modbus 映射不一致、单设备历史页混入遗留设备数据三项 P1 问题；修复后需按报告 C01～C18 全量回归。
