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
  - `水循环控制与安全保护通俗指南.md`（水循环系统安全控制通俗白话解读手册）

## 当前项目状态

### 2026-09-08 基于 device/sensor 数据上报的在线/离线判定与可配置超时机制已实现

- 针对设备端不发专用心跳包、仅周期性发送遥测数据的真实物理特性，实现极简可靠的基于数据流活跃度的在线/离线检测（`devicePresenceService`）：
  - **在线判定**：只要收到设备端往 `device/sensor` 发送数据，即记录该设备的最新活跃时间戳（`lastSeen`），并判定为在线（`online`），状态点变绿；
  - **超时判定与可配置项**：在指令配置表 `t_direct_config` 与【指令信息】页增加 `device_offline_timeout`（设备离线超时时间（秒），默认 5 秒），支持页面自由修改；后台巡检定时器动态依据该超时时间检测，超时未上报自动切换为离线（`offline`），并通过 WebSocket 广播 `device_status`；
  - **前端顶部 Header 联动**：顶部状态栏在设备离线时直观展示灰色点与 `<el-tag type="info">离线</el-tag>` 标签；在线且非运行状态展示 `<el-tag type="success">在线</el-tag>`，水循环自动运行中维持运行状态标签；
  - **实时数据与行为数据页卡片联动**：页面顶部 Descriptions 卡片中的【是否在线】项不再展示写死的“未启用心跳”，而是动态联动展示绿色的 `<el-tag type="success">在线</el-tag>` 或灰色的 `<el-tag type="info">离线</el-tag>`；
  - 后端 140 项测试、前端 25 项测试全部通过，生产构建通过。

### 2026-09-08 时间比例 PID 已实现

- 按用户确认的计划增加 `hysteresis/pid` 可选策略，控制 `temp_out`；机械继电器调试候选周期20秒、最短开关各3秒，Kp/Ki/Kd默认0，PID启动要求Kp>0。
- 新增 `timeProportionPid` 和 `pidControlConfig`；执行器共用设备级发布队列和运行代次校验，停止先撤销许可；执行器改为单次QoS1且超时/断线取消未确认消息。
- 说明文档：`时间比例PID实施与调试说明.md`；首版仅手动调参和指令页状态展示，无自动整定。
- 后端126项、前端23项测试通过，生产构建通过；额外水力诊断和动态错误映射脚本通过，C01～C18隔离回归及PID参数覆盖/后台变更场景通过。测试日志在`output/pid-20260907`，复位弹窗截图在`output/playwright/pid-20260908`。
- 发布前重检窗口剩余时间和运行代次；发布结果不确定时使旧成功值失效，确保故障关闭真正下发。数据库读取/历史落库不能阻塞停止及窗口关闭；冷却和复位完成前检查期间的新故障，避免覆盖故障锁定。
- 验证使用独立数据库 `codex_pid_test_20260907`、Broker18885、HTTP3107、前端5107；测试服务/容器/数据库已清理，日志保留。实机继电器规格核验与PID系数整定尚未进行，不能把软件回归当成实机精度验收。

- 已具备：Web 端、传感器实时/历史数据、行为数据、错误数据、设备管理、指令配置/下发、设备端指令上报、指令操作历史查询、MQTT、WebSocket、MySQL 存储。
- 指令操作历史已使用 `t_direct_history`，页面“方向”只有 `应用层下发` 和 `设备端上报` 两类。
- MQTT 入站主题使用 `device/sensor`、`device/behavior`、`device/error`、`device/timeRequest`、`device/direct`；设备编号统一放在 payload 的 `d_no` 字段。
- 心跳机制已停用：不订阅 `device/heartbeat`，不判断在线/离线，不缓存或恢复补发离线指令；控制指令直接尝试发布到 MQTT Broker，设备状态接口统一返回 `unmonitored/未启用心跳`。
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
  - 针对设备端拆除传感器后持续周期性发 0 的物理特性：引入异常零值持续计时机制（`zeroStartTime`）；水温 $\le 0℃$ 视为断线零值，流量/压力在开泵运行中 $\le 0$ 视为失流零值；持续超过 `data_timeout`（默认 3 秒）后精准标记为超时无效，杜绝水温报 0 导致控温误加热风险，停泵时静止零流量不误报。
  - 实际执行器状态只由`water_Y2`、`heat_Y1`更新，应用层下发结果单独记录为`desiredPumpState`、`desiredHeaterState`和`lastCommandStatus`。
  - 安全故障已使用结构化`faultCode`统一决策；运行失流无论加热是否开启都关加热、停泵，复合故障中超压/失流停泵优先于超温留泵散热。
  - `command_timeout`当前只表示等待MQTT发布/PUBACK的秒数，不等待设备或继电器执行ACK；发布失败/超时会抛错并记录失败历史。
  - 应用层下发`device/direct`时会登记短时消息指纹，收到同一客户端的Broker回环后直接忽略，避免误记为设备端上报。
  - 启动时幂等补齐10项控制参数和水泵/加热节点，只插入缺失配置与默认值，不覆盖现场已有参数或MQTT模板。
- 实时数据与图表设备自适应：
  - 修复后端接口（`/api/sensor/realtime`、`/api/sensor/echarts`、`countPastRows`）中残留的写死设备号 `202111` 逻辑；
  - 支持未指定设备编号时自动回退查询全局最新一条记录与图表聚合数据；
  - 前端（实时数据/行为数据）在初始化获取设备号后直接绑定并在单设备/多设备模式下无缝拉取；顶部设备状态栏动态根据实际设备 Map 进行渲染。
- 设备测试发包工具（`mqttTest`）：
  - 彻底精简并移除了水循环物理仿真、宏场景、Modbus 报文解析等专用冗余逻辑；
  - 仅保留核心能力：向用户输入的自定义主题发送自定义数据（JSON/字符串），支持单次立即发送；
  - 支持后台自定义时间间隔自动循环发送与启停控制；
  - 支持动态 Broker 重连配置与发送日志查看，整体代码大幅精简至约 500 行以内。
- 指令树与控制模式联动：
  - 根节点（`config_id=0`, `topic=master`）作为“控制模式”总开关：开启为自动模式（展开 10 项控温、安全与超时参数），关闭为手动模式（展开水泵/加热 2 项手动开关）；
  - 前端 `<el-tree>` 引入响应式重绘 key，确保模式切换时子节点 100% 自动重绘并默认全部展开；
  - 顶部 Header 状态标签与数据库/引擎状态实时联动（`自动模式` / `手动模式` / `建流中` / `自动运行中` / `冷却中` / `故障`）。
- 传感器入库动态校验与历史状态检索：
  - 新建 `sensorValidationService` 动态安全阈值判定模块：入库时依据当前设备设定的 `max_safe_temperature`、`max_safe_pressure`、`min_safe_flow` 等参数及水力联合诊断结论动态计算 `vstatus`；超温、超压、开泵低流或确诊水力异常（过程一~四）时统一标记为 `1`（告警），正常停机零流量保持 `0`；具备短时内存缓存兼顾高频入库吞吐与配置即刻生效；
  - 传感器历史数据接口（`/api/sensor/past`）扩展支持 `status` 筛选参数（`normal` 过滤 `vstatus = 0`，`abnormal` 过滤 `vstatus != 0`）；
  - 前端历史数据页增加【数据状态】筛选下拉框（全部 / 仅看正常 / 仅看告警异常），并在表格中直观展示状态 Tag，异常告警行采用浅红色高亮突出。
- 水循环累计总流量与管内流速分析（补充逻辑功能一）：
  - 新增 `waterFlowService` 模块：采用梯形微积分算法（$\Delta V = \frac{Q_1+Q_2}{2}\times \frac{dt}{60}$）高精度累加瞬时流量；
  - 通讯中断与断线保护：两包采样间隔超过 `data_timeout`（默认 3 秒）时自动暂停时间累加，杜绝离线重连将大跨度时间差乘入虚增水量；
  - 关泵与服务重启保护：累计数据异步节流落盘至 `t_water_flow_accumulator`，停水或服务重启后自动从 MySQL 恢复历史总量；
  - 管内流速换算：根据可配置的水管内径参数 `pipe_inner_diameter`（毫米）动态计算流速（m/s）；未配置时界面明确标注“待配置水管内径”；
  - 累计量清零与留痕：支持前端发起清零，采用弹窗二次确认防误触，清零成功记录至 `t_direct_history`（记录旧累计量与清零操作）；
  - 实时图形化展示：实时数据页（`RealTimeData.vue`）在传感器实时趋势图正下方新增独立 ECharts【水流动态与累计流量分析】图表，双 Y 轴实时呈现瞬时水流、管内流速与累计总流量趋势；顶部 Descriptions 卡片联动展示当前流速、累计量与清零按钮。
- 压力与流量联合诊断（补充逻辑功能二/大纲4.2节）：
  - 新建 `hydraulicDiagnosisService` 模块：实现前 4 个诊断过程（高压低流疑似管路堵塞 `HYDRAULIC_BLOCKAGE`、低压低流疑似泵送异常 `HYDRAULIC_PUMP_ABNORMAL`、常压低流疑似流量计异常 `HYDRAULIC_SENSOR_ANOMALY`、运行中压流断崖式双骤降疑似管路脱落泄漏 `HYDRAULIC_LEAK_OR_BURST`），按用户要求去除高敏感的第 5 项持续波动检测；
  - 防抖、免检与突发确诊机制：停机与启动建流等待期免检不误报；普通异常（低压低流/常压低流）需满足 `pressure_flow_diagnosis_confirm_time`（默认 2 秒）持续确认；超压堵塞（过程 1）与压流骤降（过程 4）属于紧急硬核急停保护，免除防抖立即确诊；
  - 故障态诊断锁定机制：引入 `lockedFaultDiagnosis` 锁定机制，停机保护触发后原子级锁定当前诊断结论，防止水泵关闭后被误重置为正常或静止态，持续在界面呈现红色告警 Tag 直至人工复位；
  - 故障告警深度联动：超压、失流等安全停机保护触发时，将水力联合诊断结论自动融合进 `faultReason` 与 `t_error_msg`；
  - 参数与界面展示闭环：扩展 `min_operating_pressure`（最低参考压力）与 `pressure_flow_diagnosis_confirm_time`（诊断确认时间）并加入数值居中校验白名单；【指令信息】页与【实时数据】页同步展示动态水力诊断状态 Tag 与详细成因 tooltip。
- 错误码语义映射后台驱动与报错联动机制：
  - 后台配置中心联动：底层表 `t_error_code_mapper` 完整补齐 4.2 节水力联合诊断过程一~四（`HYDRAULIC_BLOCKAGE`、`HYDRAULIC_PUMP_ABNORMAL`、`HYDRAULIC_SENSOR_ANOMALY`、`HYDRAULIC_LEAK_OR_BURST`）及常规安全保护规则；
  - 动态读取与短时缓存：`recordFault` 废除硬编码常量字典，改为通过 `getRuleErrorMapping` 动态反查后台 `t_error_code_mapper`；引入 2 秒短时内存缓存兼顾故障期间高频保护与后台保存即刻生效；
  - 题目现场改后台即驱动前台：比赛现场只需在后台管理控制台（`contest_admin` 的【错误码语义映射】）修改 `e_no`、`type` 或 `e_msg`，应用层在报警落库和 WebSocket 广播时 100% 按照后台配置的题目要求呈现。
- 两水箱温差、温度变化速度和估算热传递功率分析（补充逻辑功能三/大纲4.3节）：
  - 新建 `thermalAnalysisService` 模块：维护设备级内存滑动温度采样点队列（基于配置 `temperature_rate_window`，默认 60s）；
  - 核心计算：实时计算两水箱温差（$\Delta T = temp\_out - temp\_in$）、水箱A升温速度与水箱B变化速度（℃/min，平滑滤波去噪）、结合水泵状态与实时流量依据热力学公式 $P = 69.77 \times Q \times \Delta T_{heat}$ 计算估算循环水有效热传递功率（W）；
  - 安全前置校验：水泵停止（`pump_off`）或流量过低（`low_flow`）时强制将功率置 0 并返回工况状态说明；温差反转异常（水箱A比B还冷）时标记 `direction_anomaly`（“供热温差非正，请确认测点与水流方向”）；
  - 接口与广播：新增 `GET /api/thermal/status/:d_no` 接口，入站传感器实时通过 WebSocket 广播 `thermal_realtime` 主题；
  - 方案一界面落地：实时数据页（`RealTimeData.vue`）顶部卡片完整展示两水箱温差、水箱A升温速度、水箱B变化速度、循环水估算热功率 4 个状态 Tag；底部采用 1:1 响应式双栏栅格，左栏为【水流动态与累计流量分析】图表，右栏为【热工效能与热传递分析】双 Y 轴图表，水力与热力工况对称呼应、一览无余。
- 水泵与加热累计运行时长统计与展示（补充逻辑功能四/大纲补充第6节）：
  - 新建 `deviceRuntimeService` 模块：严格依据传感器报文中的 `water_Y2` 和 `heat_Y1`（1/on 为开，未带或为 0 严格按关处理），以时间差 $\Delta t$ 累加运行时长；
  - 具备断网超时防虚增保护：两包数据间隔超过 `data_timeout`（默认 3 秒）时暂停累加，杜绝离线虚增时长；
  - 轻量本地文件持久化：零侵入 MySQL 数据表，状态通过本地 JSON 文件（`backend/data/runtime_stats.json`）节流异步落盘，服务重启后自动从本地文件恢复；
  - 清零与留痕：支持分别清零或一起清零，弹窗二次确认防误触，清零成功记录到 `t_direct_history` 审计留痕；
  - 界面落地：实时数据页（`RealTimeData.vue`）顶部卡片紧跟在累计总流量之后展示【水泵累计运行时长】和【加热累计运行时长】，友好格式化（如 `1小时2分5秒` / `45秒`），配备独立清零按钮，并通过 WebSocket `runtime_realtime` 实时广播无感跳动。
- 现场限制：比赛局域网禁止外网；如果题目不涉及移动应用开发，不允许使用手机。

## 2026-08-24 水循环需求实测结论

- 详细报告见 `水循环系统需求符合性实测报告-2026-08-24.md`；本轮在独立数据库、独立 MQTT Broker 和仿真设备中完成页面、HTTP、WebSocket、MySQL、MQTT 端到端实测。
- 后端 84 项、前端 21 项测试全部通过，前端生产构建成功；10 项参数、五态状态机及主要安全边界均能运行。
- 该报告记录的是当时版本；离线安全指令静默补发在2026-09-05停用心跳时处理；2026-09-08进一步移除执行器未确认消息的恢复重放，并修复“停止过程中并发重开加热”。
- 故障状态重复下发/历史已通过成功目标去重和失败节流处理，2026-09-08完成C01～C18隔离控制回归。旧报告的仿真器Modbus映射及历史页遗留设备混入问题不在此次PID修改范围内。

## 2026-09-08 PID 超调抑制与恢复回差

- PID 出口温度达到目标即撤销当前窗口剩余加热，不受一秒计算节流、最短开启时间限制；最高安全温度故障保护仍独立生效。
- 新增应用层参数 `pid_resume_hysteresis`，默认 0.3℃、正有限数且小于目标温度。恢复条件为出口温度 <= 目标温度 - 恢复回差；默认值为联调起点，并非精度保证。
- 抑制时清零积分、微分和输出，回差内持续禁止加热；恢复不重放旧窗口脉冲，下一窗口按 PID 和最短关闭时间重新安排。
- 状态新增 suppressed/cutoffTemperature/resumeTemperature，页面展示关热/恢复温度及抑制原因；配置修改仍需停止冷却后重新启动。
- 本轮按用户要求不运行构建；不通过测试控制真实设备。

### 2026-09-08 可配置强制关热阈值
- 新增 `pid_overshoot_allowance`（允许超调温差），默认0.1℃，允许0；强制关热温度改为目标+该值，必须低于最高安全温度。指令页PID参数区可编辑，运行中修改仍停止冷却后重新启动。
- 目标35℃时默认35.1℃强制关热；设置0.2则35.2℃。恢复阈值仍为目标-恢复回差（默认34.7℃）。替代上文“达到目标即强制关热”的描述，PID自身仍可提前输出0。
- 用户要求不跑构建。

## 2026-09-08 MQTT频繁重连封禁排查
- Docker EMQX日志确认admin_1234触发flapping_detected：1分钟15次连接，封禁5分钟；连接返回code 5。
- 累计运行时长写入backend/data/runtime_stats.json，而nodemon默认监视json。新增backend/nodemon.json忽略data/**；用nodemon真实匹配器确认旧规则匹配运行文件、新规则忽略，同时业务JS仍匹配。
- 需要完整重启nodemon进程以加载新配置，仅rs重启子进程不足；未修改Broker认证或禁用封禁保护。运行时统计数据为用户改动，不提交。

### 比赛环境关闭频繁连接自动封禁
- 按用户明确要求，Docker容器emqx的flapping_detect.enable已设为false，并确认持久化至/opt/emqx/data/configs/cluster.hocon；不需要重启Broker。
- 已定向清除admin_1234封禁，验证客户端connected=true、5项订阅。账号密码认证未调整。容器重启使用持久化配置；删除数据重建容器需重新配置。
