# Jet Lag App — 第一阶段开发

## 前置
- [x] Gap 分析报告移入 `docs/` 并加日期
- [x] 编写第一阶段实施计划并获批

## 阶段一：基础设施
- [x] 1. 用户认证系统（注册/登录/JWT）
  - [x] 安装依赖 (better-sqlite3, bcryptjs, jsonwebtoken)
  - [x] 创建 `src/db/db.js` — 数据库初始化与建表
  - [x] 创建 `src/db/userRepository.js` — 用户 CRUD
  - [x] 创建 `src/db/roomRepository.js` — 房间持久化
  - [x] 创建 `src/auth/auth.js` — 注册/登录/JWT
  - [x] 创建 `src/auth/authMiddleware.js` — 鉴权中间件
  - [x] 修改 `src/server.js` — 接入 auth 路由 + 中间件
  - [x] 修改 `src/game/store.js` — 接入 SQLite 写穿
- [x] 2. SQLite 持久化（房间/用户/事件）
- [x] 3. API 安全（可选鉴权 + 输入校验）
- [x] 4. 后台定位（expo-task-manager）
- [x] 5. 推送通知（FCM/APNs）

## 阶段一.六：前端用户认证集成
- [x] 1. 新增认证状态存储层（authSession.ts）
- [x] 2. 更新 API 通信层附加 Token
- [x] 3. 新增登录/注册 UI（AuthScreen.tsx）
- [x] 4. 调整应用路由与首页（App.tsx、HomeScreen.tsx）
