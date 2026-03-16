# Jet Lag App

Jet Lag App is a local multiplayer hide-and-seek prototype with:

- a Node.js HTTP + WebSocket backend
- a React web client in [`client/`](client/)
- an Expo React Native client in [`mobile/`](mobile/)

The current repo is already runnable end-to-end for local development and real-device LAN testing.

## Current State

Implemented in the current version:

- account registration / login with JWT auth
- room create / join / leave / ready flow
- authenticated player binding so room/player identity is tied to the logged-in user
- round flow: `Lobby -> Hiding -> Seeking -> Summary`
- realtime room sync over WebSocket
- role-based visibility for `hider / seeker / observer`
- question / answer flow with pending-question lock
- reward-card selection after eligible answers
- card draw / curse cast / dice / catch claim actions
- location reporting, map markers, polygon drawing, POI search
- hider / seeker split `Seeking` UI on mobile
- `Hiding` countdown UI on mobile
- `Summary` recap UI with timing, timeline, next-round reset, and seeker route map on mobile
- local persistence for auth session, network settings, and room player sessions
- push token registration and server-side event-driven push pipeline

## Repo Layout

- [`src/`](src/): backend runtime
- [`client/`](client/): Vite + React web app
- [`mobile/`](mobile/): Expo React Native app
- [`shared/`](shared/): shared protocol/types
- [`scripts/`](scripts/): smoke/regression scripts
- [`docs/`](docs/): PRD / spec / implementation notes

## Quick Start

Install dependencies:

```powershell
cd "E:\Crazy_Project\Jet Lag App"
npm install
npm --prefix client install
npm --prefix mobile install
```

Start backend only:

```powershell
cd "E:\Crazy_Project\Jet Lag App"
npm run dev:api
```

Start backend + web:

```powershell
cd "E:\Crazy_Project\Jet Lag App"
npm run dev
```

Start backend + web + Expo:

```powershell
cd "E:\Crazy_Project\Jet Lag App"
npm run dev:all
```

Default backend bind:

- `http://0.0.0.0:8080`
- local debug mirror: `http://localhost:8080`
- WebSocket: `ws://<host>:8080/ws`

## Web Client

Start web client alone:

```powershell
cd "E:\Crazy_Project\Jet Lag App"
npm run dev:client
```

Current web app scope:

- create / join room
- realtime room sync
- lobby / seeking / summary interaction
- same round-action API surface as mobile for day-to-day debugging

## Mobile Client

Start Expo:

```powershell
cd "E:\Crazy_Project\Jet Lag App\mobile"
npm run start
```

Current mobile flow:

- `AuthScreen`: register / login
- `HomeScreen`: create room, join room, network override, logout
- `LobbyScreen`: ready / start round
- `HidingScreen`: live hide countdown
- `SeekingScreen`:
  - seeker view: `Map / Ask / Catch / Tools / Log`
  - hider view: `Map / Answer / Rewards / Cards / Tools / Log`
  - active curse banner
  - reward-card choice UI
- `SummaryScreen`:
  - round timing
  - route map
  - event timeline
  - `Prepare Next Round`

Detailed mobile notes: [mobile/README.md](mobile/README.md)

## LAN / Real Device Setup

For real phones, the backend URL must use your computer's current LAN IP.

Example:

- backend: `http://192.168.0.100:8080`
- websocket: `ws://192.168.0.100:8080/ws`

Important:

- Expo QR / Metro host can change when your IP changes
- the mobile app stores manual network overrides in AsyncStorage
- if the app still points to an old IP, open `Open Dev Settings` in the app and update it

## Expo Go Limitations

The app works in Expo Go for most development flows, but not every native capability is fully testable there.

In Expo Go:

- remote push delivery is not fully supported
- iPhone background location is not fully supported
- on iPhone the app now degrades to foreground-only tracking in Expo Go

For full validation of push and iOS background location, use a development build instead of Expo Go.

## Useful Scripts

From repo root:

```powershell
npm run smoke
npm run test:task5
npm run test:task6
npm run test:task7
```

Available scripts in [`package.json`](package.json):

- `dev:api`
- `dev:client`
- `dev:mobile`
- `dev`
- `dev:all`
- `dev:android`
- `dev:android:clean`
- `smoke`
- `test:task1`
- `test:task3`
- `test:task4`
- `test:task5`
- `test:task6`
- `test:task7`

## Backend Notes

Key runtime behavior:

- CORS is enabled for localhost and common LAN debug origins
- `/api/...` aliases are supported in addition to `/...`
- WebSocket subscribe path is `/ws`
- dev phase controls are enabled by default outside production

Common endpoints include:

- `POST /auth/register`
- `POST /auth/login`
- `POST /rooms`
- `POST /rooms/:roomId/join`
- `GET /rooms/:roomId?playerId=...`
- `GET /rooms/:roomId/snapshot?playerId=...`
- `POST /rooms/:roomId/next-round`
- `POST /rounds/:roomId/{ask|answer|drawCard|castCurse|rollDice|claimCatch}`

## Docs

Primary project notes live in [`docs/`](docs/), especially:

- [docs/README.md](docs/README.md)
- [docs/PROJECT_STRUCTURE_CN.md](docs/PROJECT_STRUCTURE_CN.md)
- [docs/PHASE_1_IMPLEMENTATION_PLAN_2026-03-14.md](docs/PHASE_1_IMPLEMENTATION_PLAN_2026-03-14.md)
