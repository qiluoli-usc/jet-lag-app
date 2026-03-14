# Jet Lag App Prototype

This project is a runnable backend prototype based on your game design notes.

## Implemented scope

- Room and player management (`Lobby`, join, ready, role assignment).
- Scale presets (`Small/Medium/Large`) with rule bootstrap.
- Round state machine (`Hide -> Seek -> EndGame -> Caught -> Summary`).
- Timer-driven phase transitions.
- Hiding zone generation at hide-end and EndGame auto trigger when seekers enter zone while off-transit.
- Role-based information visibility (`Hider`, `Seeker`, `Observer`).
- Structured question pipeline with one-pending-question lock.
- Category-based answer time limits/costs and repeat multiplier.
- Timeout handling: auto pause + no reward if answer is late.
- Reward draw flow with keep-card selection endpoint.
- Question cooldown + curse-based category blocking.
- Seeker map annotation placeholders.
- Curse-enforced map restrictions (for example `circle_only` drawing mode).
- Card system includes fixed time bonus / powerups / curses.
- MVP powerups implemented: `Veto`, `Randomize`, `Discard N Draw M`, `Expand Hand Size`.
- Dice rolls with replay proof hash.
- Catch claim + resolve flow (distance mode supports automatic evaluation and requires visual confirmation).
- Pause/resume controls and dispute workflow.
- Hider clue sharing after a configurable seek-time threshold.
- Append-only event log with hash chain.
- Basic anti-cheat speed anomaly flag.
- Player capability projection for frontend button locking.
- V3 unified data-source layer: `MapProviderAdapter` + `TransitPack`.
- Built-in place legitimacy rule: `review_count >= 5`, with dispute vote override.
- API compatibility for both legacy `/rooms/...` and spec-style `/api/rooms/...`.

## Quick start

```bash
cd E:\\Crazy_Project\\Jet Lag App
node src/server.js
```

Default server bind: `0.0.0.0:8080` (LAN/mobile accessible)  
Override with env: `HOST=0.0.0.0 PORT=9090 node src/server.js`

HTTP base URL:

- `http://localhost:8080`
- API alias prefix is also available: `http://localhost:8080/api`

Frontend + backend dev (concurrently):

```bash
cd E:\Crazy_Project\Jet Lag App
npm install
npm --prefix client install
npm run dev
```

Web client now includes the same core round controls as mobile:

- Seeking tabs: `Map / Q&A / Cards / Dice / Catch / Log`
- Foreground location report + POI search + polygon annotation submit
- Dev-only quick controls in room header: `Next Phase` / `+2 Phases`

Run API + Web + Mobile Expo together:

```bash
cd E:\Crazy_Project\Jet Lag App
npm run dev:all
```

Run API + Android emulator mobile app (recommended for daily testing):

```bash
cd E:\Crazy_Project\Jet Lag App
npm run dev:android
```

If Metro cache causes blank/loading issues:

```bash
cd E:\Crazy_Project\Jet Lag App
npm run dev:android:clean
```

Smoke test:

```bash
cd E:\Crazy_Project\Jet Lag App
npm run smoke
```

Network debug notes:

- Android emulator can access host server via `http://10.0.2.2:8080`.
- Real device must use your host LAN IP (for example `http://192.168.1.20:8080`).
- If real device cannot access server, allow Node.js/server port inbound in Windows Firewall.

## Realtime protocol (WebSocket)

WebSocket URL:

- `ws://localhost:8080/ws`
- Alias path also works: `ws://localhost:8080/api/ws`

Client subscribe payload:

```json
{
  "type": "SUBSCRIBE",
  "roomCode": "ABC123",
  "sinceCursor": "12"
}
```

Server messages:

- `SNAPSHOT { projection, cursor }`
- `EVENT_APPEND { event, cursor }`

`sinceCursor` replay rule:

1. If `sinceCursor` is omitted: server returns `SNAPSHOT` at current latest cursor, no historical replay.
2. If `sinceCursor = N`: server returns `SNAPSHOT` at cursor `N`, then replays missing events as `EVENT_APPEND` with cursors `N+1 ... latest`.
3. `sinceCursor` must be an integer in `[0, currentTotalEvents]`; invalid cursor returns error (`400`).

## CORS and mobile debugging

`src/server.js` now enables CORS for HTTP routes and handles preflight:

- `Access-Control-Allow-Methods: GET,POST,OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With`
- `OPTIONS` returns `204`

By default it allows:

- localhost origins (`localhost`, `127.0.0.1`, `0.0.0.0`)
- common LAN/mobile debug origins (`10.x.x.x`, `192.168.x.x`, `172.16-31.x.x`)

To explicitly control origins, set:

- `CORS_ALLOW_ORIGIN=http://192.168.1.20:5173,http://localhost:5173`
- or `CORS_ALLOW_ORIGIN=*` (allow all origins)

## Main endpoints

- `GET /health`
- `GET /`
- `GET /transit/packs`
- `POST /transit/packs/import`
- `GET /rooms`
- `POST /rooms`
- `POST /rooms/:roomId/join`
- `POST /rooms/:roomId/leave`
- `POST /rooms/:roomId/ready`
- `POST /rooms/:roomId/start`
- `POST /rooms/:roomId/dev/advancePhase` (dev-only; can be disabled with `ENABLE_DEV_PHASE_CONTROL=0`)
- `POST /rooms/:roomId/location`
- `POST /rooms/:roomId/transit`
- `POST /rooms/:roomId/questions`
- `POST /rooms/:roomId/answers`
- `POST /rooms/:roomId/rewards/choose`
- `POST /rooms/:roomId/map-annotations`
- `POST /rooms/:roomId/cards/draw`
- `POST /rooms/:roomId/cards/cast`
- `POST /rooms/:roomId/dice/roll`
- `POST /rooms/:roomId/clues`
- `POST /rooms/:roomId/pause`
- `POST /rooms/:roomId/resume`
- `POST /rooms/:roomId/disputes`
- `POST /rooms/:roomId/disputes/:disputeId/vote`
- `POST /rooms/:roomId/disputes/resolve`
- `POST /rooms/:roomId/catch-claims`
- `POST /rooms/:roomId/catch-resolve`
- `POST /rooms/:roomId/next-round`
- `POST /rooms/:roomId/places/search`
- `POST /rooms/:roomId/places/details`
- `POST /rooms/:roomId/admin-levels/reverse`
- `POST /rooms/:roomId/evidence/upload-init`
- `POST /rooms/:roomId/evidence/complete`
- `GET /rooms/:roomId/events?since=&limit=&playerId=`
- `GET /rooms/:roomId?playerId=...`

## V3 API aliases

All routes above are also available under `/api/...`.

Examples:

- `POST /api/rooms/:roomId/questions/ask`
- `POST /api/rooms/:roomId/questions/:askedId/answer`
- `POST /api/rooms/:roomId/cards/play`
- `POST /api/rooms/:roomId/catch/claim`
- `POST /api/rooms/:roomId/catch/:claimId/respond`
- `POST /api/rooms/:roomId/disputes/:disputeId/vote`

## Mobile (Expo Android)

Start backend server:

```bash
cd "E:\Crazy_Project\Jet Lag App"
npm run dev:api
```

Start Expo mobile app:

```bash
cd "E:\Crazy_Project\Jet Lag App\mobile"
npm install
$env:EXPO_PUBLIC_API_BASE_URL="http://10.0.2.2:8080"
npm run android
```

One-command start (API + Android):

```bash
cd "E:\Crazy_Project\Jet Lag App"
npm run dev:android
```

Notes:

- Android emulator should use `10.0.2.2` to access host machine server.
- For a physical phone on the same LAN, set `EXPO_PUBLIC_API_BASE_URL` to your host IP (for example `http://192.168.1.20:8080`).
- Mobile app realtime path is `ws://<api-host>/ws` with `SUBSCRIBE { roomCode, sinceCursor }`.
- In development build, room header includes `Next Phase` / `+2 Phases` buttons to quickly advance test phases.
- Web room page also includes `Next Phase` / `+2 Phases` in development mode for fast multi-phase verification.

## Folder architecture

- `src/`: backend runtime (HTTP/WS/state machine/protocol)
- `scripts/`: automated backend acceptance tests
- `client/`: web app (Vite + React + TS + Tailwind)
- `mobile/`: Expo app (React Native + TS)
- `shared/`: shared cross-platform protocol types (client/mobile)
- `docs/`: PRD/SPEC and architecture notes

Detailed audit and cleanup notes: `docs/PROJECT_STRUCTURE_CN.md`

## Docs version index

- Version index and priority rules: `docs/README.md`
