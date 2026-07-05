# IoT Fresh Logistics Web App

一个面向生鲜品储运场景的物联网应用层项目，负责设备数据可视化、实时告警、远程控制和时间同步。

这个仓库只保留应用层代码，适合作为个人作品集展示：

- `frontend/`：Vue 3 + Vite + Element Plus 的管理与监控前端
- `backend/`：Node.js + Express + MySQL + MQTT + WebSocket 的应用层服务

## Project Highlights

- 实时展示传感器数据、行为数据和设备在线状态
- 基于 WebSocket 的实时消息推送与告警提醒
- 历史数据分页查询与趋势图展示
- 设备异常记录查询与状态分级展示
- 树形远程指令控制，支持全局指令和单设备指令
- 基于 MQTT 的时间同步、阈值下发和设备联动控制

## Tech Stack

### Frontend

- Vue 3
- Vite
- Element Plus
- ECharts
- Pinia
- Axios

### Backend

- Node.js
- Express
- MySQL
- MQTT
- WebSocket
- Day.js

## Architecture

```text
Frontend (Vue 3)
  -> HTTP API (Express)
  -> WebSocket realtime updates

Backend (Express)
  -> MySQL for device / telemetry / command data
  -> MQTT broker for device communication
  -> WebSocket broadcast for frontend realtime view
```

## Key Pages

- Realtime dashboard for sensor and behavior data
- Historical data table and trend charts
- Device status bar and alarm notification
- Error message query page
- Device management page
- Direct command page for remote control and manual time sync

## Local Development

### 1. Start the backend

Create `backend/.env`:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=Q3

MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_CLIENT_ID=portfolio_admin
MQTT_USERNAME=your_username
MQTT_PASSWORD=your_password

PORT=3000
FRONTEND_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost:5100
```

Run:

```bash
cd backend
pnpm install
pnpm dev
```

### 2. Start the frontend

Create `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:3000
```

Run:

```bash
cd frontend
pnpm install
pnpm dev
```

## Testing

Backend:

```bash
cd backend
pnpm test
```

Frontend:

```bash
cd frontend
pnpm test
pnpm build
```

## Notes

- This repository focuses on the web application layer only.
- Hardware-side collector code, course report materials, and local deployment utilities are intentionally excluded from this public version.

## About This Project

This project was built as part of an IoT application development course project and then cleaned up into a portfolio-friendly repository for internship applications.
