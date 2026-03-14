# Phase 1.6: 前端用户认证 (Mobile Auth UI) Integration

## User Review Required

> [!IMPORTANT]
> **确认需求**：在第一阶段我们完成了**后端**的核心认证功能（JWT、bcrypt、数据库表、`/auth/login` 等 API），但之前为了保证不影响您跑通主流程测试，前端依然是原有的**匿名随时输入名字**模式。
>
> 现在的方案是：在手机端强制加上 **登录/注册界面**（AuthScreen）。用户必须先注册或登录后，才能进入到原来的首页（HomeScreen）去创建和加入房间。玩家在房间中的名字将直接使用其注册的用户名。请确认这个改动是否符合您的预期！

---

## Proposed Changes

### 1. 新增认证状态存储层
#### [NEW] [authSession.ts](file:///e:/Crazy_Project/Jet Lag App/mobile/src/lib/authSession.ts)
提供基于 `AsyncStorage` 的 JWT 和用户信息本地持久化功能：
- `saveAuthSession(token, user)`
- `getAuthSession()`
- `clearAuthSession()`

### 2. 更新 API 通信层
#### [MODIFY] [api.ts](file:///e:/Crazy_Project/Jet Lag App/mobile/src/lib/api.ts)
- 修改基础请求方法 (`request`)，在每次发送请求时自动从 `authSession` 读取 Token，并附加到 HTTP Headers 的 `Authorization: Bearer <token>` 中。
- 新增 `registerUser(baseUrl, displayName, password)` 和 `loginUser(baseUrl, displayName, password)` 方法。

### 3. 新增登录/注册 UI
#### [NEW] [AuthScreen.tsx](file:///e:/Crazy_Project/Jet Lag App/mobile/src/screens/AuthScreen.tsx)
- 提供“登录”与“注册”切换卡。
- 输入 `displayName` (用户名) 和 `password` (密码)。
- 成功后调用 `saveAuthSession` 并触发页面跳转。

### 4. 调整应用路由与首页
#### [MODIFY] [App.tsx](file:///e:/Crazy_Project/Jet Lag App/mobile/App.tsx)
- 引入全局认证状态管理。
- 启动时加载 JWT，若无 Token 则停留在 `AuthScreen`，有 Token 则进入 `HomeScreen`。
#### [MODIFY] [HomeScreen.tsx](file:///e:/Crazy_Project/Jet Lag App/mobile/src/screens/HomeScreen.tsx)
- 在页面顶部展示当前登录的用户名。
- 移除手动输入 Player Name 的框（创建/加入房间时将不再需要手动输入，因为后端现在可以通过 Token 直接提取真实用户或由前端直接传递登录的用户名）。
- 增加一个“注销 (Logout)”按钮。

---

## Verification Plan

### Manual Verification
1. 在手机或模拟器上启动 App，预期首先看到 AuthScreen (登录页)。
2. 创建一个新账号并登录，预期进入 HomeScreen，并且不再需要输入 Player Name。
3. 创建房间并进入游戏页，验证后端能够根据携带的被认证 Token 正确匹配用户信息，且后台定位和推送通知功能不受影响。
4. 重启 App，预期自动免密码记住登录状态。
