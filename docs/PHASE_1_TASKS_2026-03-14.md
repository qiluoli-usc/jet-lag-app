# Jet Lag App — 第一阶段开发

> 2026-03-16 状态同步说明：
> 本文档已按当前仓库真实状态回填，不再沿用早期“全部已完成”的口径。
> 更详细的判断依据见 `docs/PHASE_1_REASSESSMENT_2026-03-16.md`。

## 状态说明

- `[x]` 已完成，并已在代码或脚本层面验证
- `[ ]` 尚未完全收口，仍需继续开发或真机验证

## 前置

- [x] Gap 分析报告移入 `docs/` 并加日期
- [x] 编写第一阶段实施计划并获批
- [x] 补充第一阶段复核文档 `docs/PHASE_1_REASSESSMENT_2026-03-16.md`

## 阶段一：基础设施

- [x] 1. 用户认证系统（注册 / 登录 / JWT）
  - [x] 安装依赖（`better-sqlite3`, `bcryptjs`, `jsonwebtoken`）
  - [x] 创建 `src/db/db.js`，完成数据库初始化与建表
  - [x] 创建 `src/db/userRepository.js`，完成用户 CRUD
  - [x] 创建 `src/db/roomRepository.js`，完成房间持久化
  - [x] 创建 `src/auth/auth.js`，完成注册 / 登录 / JWT
  - [x] 创建 `src/auth/authMiddleware.js`，完成鉴权中间件
  - [x] 修改 `src/server.js`，接入 auth 路由与鉴权
  - [x] 修改 `src/game/store.js`，接入 SQLite 写穿
  - [x] 完成登录用户与房间玩家身份绑定（HTTP / WebSocket）

- [x] 2. SQLite 持久化（房间 / 用户 / 事件）

- [x] 3. API 安全（可选鉴权 + 输入校验）

- [ ] 4. 后台定位（`expo-task-manager`）
  - [x] 移动端位置跟踪逻辑接入
  - [x] iOS 权限文案补齐到 `mobile/app.json`
  - [x] Expo Go / iPhone 下加入前台降级，避免直接报错
  - [ ] 用 iPhone `development build` 完成真后台定位验证

- [ ] 5. 推送通知（FCM / APNs）
  - [x] 服务端完成 `/push/register` 与事件驱动 push payload
  - [x] 移动端完成 push token 注册接入
  - [x] 自动化脚本覆盖服务端推送链路
  - [ ] 配置 `EAS projectId` 并在 iPhone `development build` 完成真实送达验证

## 阶段一.六：前端用户认证集成

- [x] 1. 新增认证状态存储层（`authSession.ts`）
- [x] 2. 更新 API 通信层附加 Token
- [x] 3. 新增登录 / 注册 UI（`AuthScreen.tsx`）
- [x] 4. 调整应用路由与首页（`App.tsx`、`HomeScreen.tsx`）
- [x] 5. 房间内玩家名改为使用已登录用户身份
- [x] 6. 登录用户与绑定玩家的读写权限校验生效

## 当前阶段结论

第一阶段已经完成大部分基础设施，尤其是：

- 认证
- 持久化
- 身份绑定
- 移动端认证接入
- 服务端推送链路

但如果按“第一阶段是否已经全部完成”来判断，当前仍有以下收口项未完成：

- [ ] iPhone 推送通知真机闭环
- [ ] iPhone 后台定位真机闭环
- [ ] 阶段一相关文档与最终签收口径同步
