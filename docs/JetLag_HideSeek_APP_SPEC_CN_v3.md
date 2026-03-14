# Jet Lag Hide + Seek 游戏控制 APP — PRD/开发规格（v3, Codex-friendly）

> v3 目标：把 PRD v2 中依赖的外部软件/工具（地图/POI/行政区查询/交通线路查询/画图/掷骰/聊天/证据提交等）全部集成到 APP 内，并在**同一房间内统一**为同一“来源与交互”。

## 0. 变更说明（v2 → v3）
- 全面内置化：地图与 POI、行政区查询、交通线路查询、绘图标注、掷骰、聊天、相机与证据提交、仲裁投票。
- 新增：MapProviderAdapter（统一地图与数据源适配层）、TransitPack（GTFS/自定义站点包）、REST+WebSocket 协议、TypeScript 数据模型、验收标准。

## 1. 目标与非目标
### 1.1 目标
1. 玩家无需打开外部 App 即可完成：地图查看/POI 搜索/测距/范围绘制/题库提问/回答计时/抽牌施咒/掷骰/抓捕判定/复盘。
2. 房间内“统一来源”：所有人看到同一套站点网络、POI 分类与行政区层级，仲裁结果对本房间本局固定。
3. 规则全配置化：Small/Medium/Large 参数、题库、牌堆、扩展包开关。

### 1.2 非目标
- 不提供 Street View / Look Around 等街景能力（规则禁止），也不提供跳转入口。
- 不做 AI 自动识别照片内容判定；照片类任务以规则+人工确认+元数据为主。

## 2. 外部软件统一内置化（必须项）
| 外部软件/工具（过去依赖） | v3：APP 内置替代模块 | 统一化规则（房间内） |
|---|---|---|
| Google Maps / Apple Maps（地图、POI 分类） | Map + Places（统一地图与 POI 服务） | Lobby 选择 mapProvider；房间内强制一致 |
| Google Reviews（>=5 评价合法） | PlaceDetails.review_count 合法性判定 | 以同一数据源返回的 review_count 为准；争议投票 |
| Wikipedia/浏览器查行政区 | In-App Reference（Wikipedia/行政区查询） | 引用来源与快照共享；仲裁后锁定 |
| 外部交通 App/时刻表 | TransitPack（GTFS/自定义站点包） | 房间内统一使用同一份 TransitPack |
| 外部画图/截图标注 | In-App Map Drawing（点线面/图层/测距） | 绘制对象作为共享图层 |
| 外部掷骰器 | In-App Dice（可证明随机） | 服务端生成并广播；写入日志 |
| 短信/IM | In-App Chat + 结构化提问流 | “官方提问”必须结构化；自由聊天可选 |
| 相机/第三方上传 | In-App Camera + Evidence Upload | 证据统一存储与回放 |

## 3. 系统架构（建议）
- Client：iOS/Android（主）+ Web（可选：裁判/复盘）
- Server：状态机 + 规则引擎 + 随机数服务 + 证据索引
- DB：PostgreSQL（元数据）+ S3（证据）
- Real-time：WebSocket（事件流）+ REST（查询/上传）

## 4. 状态机（机器可读）
```json
{
  "states": ["LOBBY","HIDING","SEEK","END_GAME","CAUGHT","SUMMARY","NEXT_ROUND"],
  "initial": "LOBBY",
  "transitions": [
    {"from":"LOBBY","event":"START_ROUND","to":"HIDING"},
    {"from":"HIDING","event":"HIDE_TIMER_END","to":"SEEK"},
    {"from":"SEEK","event":"ENTER_HIDING_ZONE_OFF_TRANSIT","to":"END_GAME"},
    {"from":"SEEK","event":"CATCH_CLAIM_ACCEPTED","to":"CAUGHT"},
    {"from":"END_GAME","event":"CATCH_CLAIM_ACCEPTED","to":"CAUGHT"},
    {"from":"CAUGHT","event":"SETTLE_DONE","to":"SUMMARY"},
    {"from":"SUMMARY","event":"NEXT_ROUND_READY","to":"NEXT_ROUND"},
    {"from":"NEXT_ROUND","event":"START_ROUND","to":"HIDING"}
  ]
}
```

## 5. 权限矩阵（信息差）
- Hider：实时看到所有 Seekers；可抽牌/施咒；默认看不到 Seekers 的圈地推理。
- Seekers：默认看不到 Hider 位置；可问答、圈地、抓捕。
- Observer（可选）：可看全部并做最终仲裁。

## 6. 数据结构（TypeScript）
```ts
export type GameScale = "SMALL" | "MEDIUM" | "LARGE";
export type Role = "HIDER" | "SEEKER" | "OBSERVER";

export interface RoomConfig {
  scale: GameScale;
  mapProvider: "GOOGLE" | "MAPBOX" | "AMAP" | "CUSTOM";
  transitPackId?: string;
  enableExpansionPackV1: boolean;
  borderPolygonGeoJSON: any;
  timers: {
    hideSeconds: number;
    answerSeconds: { default: number; photo: number };
    nextRoundPrepSeconds: number;
  };
  catchRules: { distanceMeters: number; requireVisualConfirm: boolean; };
  questionRules: { oneAtATime: boolean; repeatCostMultiplier: boolean; };
  logging: { retainDays: number; shareHiderTrackInSummary: boolean; };
}
```

## 7. 接口规范
### 7.1 REST（示例）
```http
POST /api/rooms
POST /api/rooms/{roomId}/join
POST /api/rooms/{roomId}/start

POST /api/rooms/{roomId}/location
POST /api/rooms/{roomId}/questions/ask
POST /api/rooms/{roomId}/questions/{askedId}/answer
POST /api/rooms/{roomId}/cards/draw
POST /api/rooms/{roomId}/cards/play

POST /api/rooms/{roomId}/catch/claim
POST /api/rooms/{roomId}/disputes/{id}/vote
```

### 7.2 WebSocket 事件（广播）
```txt
ROOM_STATE_UPDATED
PLAYER_LOCATION_UPDATED
QUESTION_ASKED
QUESTION_ANSWERED
CARD_DRAWN
CARD_PLAYED
CURSE_APPLIED
DICE_ROLLED
CATCH_RESULT
SUMMARY_READY
```

## 8. 统一地图与数据源（MapProviderAdapter）
```ts
interface MapProviderAdapter {
  searchPlaces(query: string, center:{lat:number,lng:number}, radiusM:number): Promise<Place[]>;
  getPlaceDetails(placeId: string): Promise<PlaceDetails>;
  reverseGeocodeAdminLevels(lat:number,lng:number): Promise<AdminLevels>;
}
```

### 8.1 POI 合法性判定（review_count）
- 默认阈值：`review_count >= 5` 视为合法；`< 5` 默认不合法，除非全员一致投票通过。
- review_count 字段：例如 Google Places `user_ratings_total`。

## 9. TransitPack（交通站点网络）
- Lobby 导入 GTFS 或选择预置站点包
- Transit Line 题判定基于 TransitPack 的 stop-route 关系
- 避免依赖外部交通 App

## 10. UI Routes
- `/lobby` 房间设置、地图与站点包、边界绘制
- `/round/seek` 地图+题库抽屉+圈地/测距+卡牌/骰子
- `/round/summary` 时间线与回放

## 11. 验收标准（示例）
- AC-01：房间内 mapProvider 统一，所有 POI 搜索结果一致；日志记录 mapProvider。
- AC-02：结构化提问串行；存在 PENDING 时禁止发下一题。
- AC-03：掷骰由服务端生成并可重放一致。

## 12. MVP
- P0：房间/状态机/计时；内置地图+POI；定位；结构化问答；抽牌/诅咒；掷骰；抓捕；Summary。
- P1：GTFS 导入；仲裁投票；证据回放；几何推理辅助。
