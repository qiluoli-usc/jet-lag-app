# 项目结构审计与整理（2026-02-16）

本文档用于说明当前 `E:\Crazy_Project\Jet Lag App` 的结构、重复点、缺失点和整理结论。

## 1) 当前结构（功能视角）

- `src/`: 后端核心（HTTP + WS + 状态机 + 事件协议）
  - `src/server.js`: API 路由、CORS、WS 挂载入口
  - `src/game/*`: 领域模型、状态机、事件存储
  - `src/realtime/*`: 事件协议、WebSocket 服务器
- `scripts/`: 后端回归脚本（smoke + task1 + task3 + task4）
- `client/`: Web 前端（Vite + React + TS + Tailwind）
- `mobile/`: 移动端（Expo + React Native + TS）
- `docs/`: 需求与规格文档（PRD/SPEC）

## 2) 重复/多余情况（结论）

### A. 合理重复（保留）

- `client/` 与 `mobile/` 都存在 `phase` 映射与 `api` 调用层：
  - 这是多端独立运行导致的必要重复，不建议强行抽公共包，当前阶段保留更稳。

### B. 非必要产物（应忽略，不应进版本）

- `node_modules/`（根、`client/`、`mobile/`）
- `mobile/.expo/`
- `client/dist/`、`mobile/dist/`

已通过新增 `.gitignore` 进行整理。

### C. 文档版本并存（可接受）

- `docs/JetLag_HideSeek_APP_PRD_CN_v2.extracted.txt`
- `docs/JetLag_HideSeek_APP_PRD_CN_v3_Codex.extracted.txt`
- `docs/JetLag_HideSeek_APP_SPEC_CN_v3.md`

这是历史演进文档，不建议删除；建议后续在 `docs/` 增加版本索引（可在下一步执行）。

## 3) 缺失项（本次已补齐/建议）

### 已补齐

- 根目录 `.gitignore`（避免产物污染）

### 建议后续补齐（本次未动业务代码）

- 将 `client`/`mobile` 的公共协议类型抽到 `shared/`（例如 phase 类型与 WS message 类型），减少长期重复维护成本。
- 增加 CI 脚本统一执行：
  - `npm run smoke`
  - `npm run test:task1`
  - `npm run test:task3`
  - `npm run test:task4`

## 4) 风险提示

- 当前仓库内存在大量本地依赖目录（`node_modules`），若后续需要提交或打包，必须依赖 `.gitignore` 控制。
- `mobile` 运行依赖本机 Android 环境与 Expo CLI，属于环境依赖，不是代码结构问题。

## 5) 结论

当前产品结构是清晰可运行的三层架构：

- 后端（`src/`）稳定
- Web（`client/`）可用
- Mobile（`mobile/`）已接入 HTTP+WS 最小闭环

不存在需要立即删除的“危险冗余代码”。当前最重要的整理工作是：**保持产物目录不入库 + 继续完善多端共享协议层**。
