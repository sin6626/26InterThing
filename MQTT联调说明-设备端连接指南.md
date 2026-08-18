# MQTT联调说明（设备端）

## 1. 当前环境确认（已实测）

- MQTT Broker: Docker 容器 `emqx`（镜像 `emqx/emqx:latest`）
- 容器状态: `Up`
- 端口映射: `0.0.0.0:1883->1883/tcp`、`0.0.0.0:18083->18083/tcp`
- 本机 MQTT 连通性实测: 使用项目内 `mqtt` 客户端本地发布/订阅回环测试通过（`LOCAL_CONNECT_OK`、`LOCAL_LOOP_OK`）

结论：**MQTT 服务本身已正常启动并可用**。

---

## 2. 设备端连不上的常见根因（结合本项目）

### 根因A：设备端把 Broker 地址写成 `localhost`

- `localhost` 对设备端来说是“设备自己”，不是你的电脑。
- 设备在另一台机器时，必须连接你电脑的局域网 IP（例如 `10.140.56.254`），而不是 `localhost`。

### 根因B：容器没在运行

- 之前容器是 `Exited`，设备连接会直接失败。
- 现在已启动，但如果重启电脑后没自动拉起，也会再次断联。

### 根因C：客户端 ID 冲突（会被踢）

- EMQX 日志出现过 `flapping_detected`、`kick_session_due_to_banned`，对应 `clientid: admin_1234`。
- MQTT 要求同一时刻同一个 `clientId` 只能有一个连接；重复会互踢，表现为“时好时坏/不断重连”。

### 根因D：网络路径不通

- 不在同一局域网、AP 隔离、公司网络策略、主机防火墙未放行 `1883`，都会导致设备无法接入。

---

## 3. 设备端应该如何连接（直接按此配置）

## 连接参数

- 协议: `mqtt://`
- Host: `10.140.56.254`（你的当前 WLAN IPv4）
- Port: `1883`
- Username: `sin`
- Password: `1234`
- clientId: 设备唯一值（示例：`device_202111`、`esp32_A01`）
- KeepAlive: `60`
- Clean Session: `true`（先联调建议）

> 注意：你的 WLAN IP 可能变化。若变化，以 `ipconfig`/`Get-NetIPAddress` 的 WLAN IPv4 为准。

## 主题约定（本项目）

- 心跳上报: `device/{d_no}/heartbeat`
- 传感器上报: `device/{d_no}/sensor`
- 行为上报: `device/{d_no}/behavior`
- 错误上报: `device/{d_no}/error`
- 指令下发（后端->设备）: `device/{topic}/direct`

示例（设备号 `202111`）：

- `device/202111/heartbeat`
- `device/202111/sensor`

---

## 4. 你的 Docker 要不要改

建议做，原因是提高稳定性和联调成功率。

### 建议1（必须）：加自动重启策略

避免 Docker/主机重启后 Broker 没启动：

```bash
docker update --restart unless-stopped emqx
```

### 建议2（建议）：固定并补齐端口映射

当前只映射了 `1883` 和 `18083`，若后续有 TLS 或 WebSocket 需求，建议补齐：

- MQTT TLS: `8883`
- MQTT over WS: `8083`
- MQTT over WSS: `8084`

可重建容器时统一映射（示例）：

```bash
docker run -d --name emqx \
  --restart unless-stopped \
  -p 1883:1883 \
  -p 8883:8883 \
  -p 8083:8083 \
  -p 8084:8084 \
  -p 18083:18083 \
  emqx/emqx:latest
```

### 建议3（建议）：避免固定重复 clientId

你后端代码里 `clientId` 固定为 `admin_1234`（`backend/mqtt/index.js`）。
建议改成带环境后缀或随机后缀，避免多人联调时冲突。

---

## 5. 设备端联调最小检查清单

1. 设备端 Host 不是 `localhost`，而是你的电脑 IP。
2. 设备端 `clientId` 全局唯一。
3. 设备和你电脑在同一网段可互通。
4. Docker 容器 `emqx` 状态为 `Up`。
5. 用户名密码正确（当前为 `sin/1234`）。

---

## 6. 快速排障命令（你这边）

```bash
docker ps --filter name=emqx
docker logs --tail 100 emqx
```

若日志出现 `kick_session_due_to_banned`，优先检查是否有重复 `clientId`。
