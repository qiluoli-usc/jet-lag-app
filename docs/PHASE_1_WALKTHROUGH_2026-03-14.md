# Phase 1 Walkthrough: 认证 + 持久化

## 完成的变更

### 新增文件

| 文件 | 职责 |
|---|---|
| [db.js](file:///e:/Crazy_Project/Jet Lag App/src/db/db.js) | SQLite 初始化（WAL 模式 + 4 张表 + 索引） |
| [userRepository.js](file:///e:/Crazy_Project/Jet Lag App/src/db/userRepository.js) | 用户 CRUD（prepared statements） |
| [roomRepository.js](file:///e:/Crazy_Project/Jet Lag App/src/db/roomRepository.js) | 房间/事件/玩家 UPSERT + 查询 |
| [auth.js](file:///e:/Crazy_Project/Jet Lag App/src/auth/auth.js) | 注册/登录（bcrypt + JWT） |
| [authMiddleware.js](file:///e:/Crazy_Project/Jet Lag App/src/auth/authMiddleware.js) | 请求级 token 提取 + 可选强制鉴权 |
| [task5-auth-persistence-test.js](file:///e:/Crazy_Project/Jet Lag App/scripts/task5-auth-persistence-test.js) | 18 项自动化测试 |

### 修改文件

| 文件 | 变更 |
|---|---|
| [server.js](file:///e:/Crazy_Project/Jet Lag App/src/server.js) | 新增 `/auth/register`、`/auth/login` 路由；集成 `extractUser` + `requireAuth` 中间件 |
| [store.js](file:///e:/Crazy_Project/Jet Lag App/src/game/store.js) | 启动时从 SQLite 加载房间；`appendRoomEvent` 写穿到 DB；新增 `persistRoom` |
| [package.json](file:///e:/Crazy_Project/Jet Lag App/package.json) | 新增依赖 + `test:task5` 脚本 |
| [.gitignore](file:///e:/Crazy_Project/Jet Lag App/.gitignore) | 忽略 `data/` 目录 |

### 新增 API 端点

```
POST /api/auth/register  →  { displayName, password }  →  { token, user }
POST /api/auth/login     →  { displayName, password }  →  { token, user }
```

### 架构决策

- **写穿缓存**：内存 Map 作为热缓存（读路径不变），每次事件追加同步写 SQLite
- **启动恢复**：模块加载时从 SQLite hydrate 所有房间到内存
- **向后兼容**：`AUTH_REQUIRED=0`（默认），所有现有 API 仍可匿名访问

## 测试结果

### 原有 Smoke Test ✅
```
SMOKE_TEST_OK { code: 'NVZLZF', phase: 'HIDING', cursor: '5', lastEvents: 5 }
```

### Task 5: Auth + Persistence Test ✅ (18/18)
```
Phase 1 ─ Auth
  ✓ Register returns 201
  ✓ Register returns a JWT token
  ✓ Register returns user with id
  ✓ Register returns correct displayName
  ✓ Duplicate register returns 409
  ✓ Login returns 200
  ✓ Login returns a JWT token
  ✓ Wrong password returns 401
  ✓ Anonymous room creation returns 201
  ✓ Room has a code
  ✓ Authenticated room creation returns 201
  ✓ Hider joins room
  ✓ Seeker joins room

Phase 2 ─ Persistence (restart server)
  ✓ Database file exists after server stop
  ✓ GET /rooms succeeds after restart
  ✓ Rooms survived restart (found 2 rooms)
  ✓ Room has 2 players
  ✓ Login works after server restart

═══ Results: 18 passed, 0 failed ═══
```

## 修复过程中发现的问题

1. **SQLite `excluded.` 列名**：`UPSERT` 的 `excluded.` 必须用实际列名（`updated_at`）而非绑定参数名（`updatedAt`）
2. **FK 约束顺序**：`room_events` 表的 `room_id` FK 要求先 `dbSaveRoom(room)` 再 `dbAppendEvent(...)`

---

## Phase 1.4-1.5: 后台定位 + 推送通知

### 移动端新增/修改
- [NEW] [locationTracking.ts](file:///e:/Crazy_Project/Jet Lag App/mobile/src/lib/locationTracking.ts): 后台定位服务（`JETLAG_LOCATION_TASK`），每 5 秒上报直接写库。
- [NEW] [pushNotifications.ts](file:///e:/Crazy_Project/Jet Lag App/mobile/src/lib/pushNotifications.ts): 注册 Expo Push Token 并存入服务端。
- [MODIFY] [SeekingScreen.tsx](file:///e:/Crazy_Project/Jet Lag App/mobile/src/screens/phases/SeekingScreen.tsx): 使用背景定位取代 4 秒前台轮询。
- [MODIFY] [App.tsx](file:///e:/Crazy_Project/Jet Lag App/mobile/App.tsx): 加入房间时自动请求推送权限并保存 Token。
- [MODIFY] [app.json](file:///e:/Crazy_Project/Jet Lag App/mobile/app.json): 新增 `expo-notifications` 插件、Android 后台定位权限、iOS Location 和 Remote Notification 模式。

### 服务端新增/修改
- [NEW] [notificationService.js](file:///e:/Crazy_Project/Jet Lag App/src/notifications/notificationService.js): 管理 `push_tokens` 读写并调用 Expo Push API 接口。
- [MODIFY] [db.js](file:///e:/Crazy_Project/Jet Lag App/src/db/db.js): 数据库新增表 `push_tokens`。
- [MODIFY] [server.js](file:///e:/Crazy_Project/Jet Lag App/src/server.js): 新增开放接口 `POST /api/push/register` 接收手机端 token。
- [NEW] [task6-push-test.js](file:///e:/Crazy_Project/Jet Lag App/scripts/task6-push-test.js): 包含注册、缺失验证、upsert的测试 (3/3 ✅)。
