# Mobile (Expo + TypeScript)

This folder contains the Expo React Native client for the Jet Lag backend.

## Implemented scope

- HomeScreen: create room + join room (REST API)
- RoomScreen: HTTP bootstrap + WebSocket subscribe (`SUBSCRIBE`) + reconnect sync
- RoomScreen dev test controls: `Next Phase` / `+2 Phases` (calls `/rooms/:code/dev/advancePhase`)
- Back action now calls `POST /rooms/:code/leave` and keeps local player session so rejoin can reuse the same `playerId`
- LobbyScreen: `ready` / `startRound` controls for mobile-side round startup
- PhaseRouter: Lobby / Hiding / Seeking / Summary
- SeekingScreen tabs:
  - `Map`: `react-native-maps` + player markers + POI search (`/rooms/:code/places/search`) + polygon annotation submit (`/rooms/:code/map-annotations`)
  - Foreground location report: `expo-location` + `POST /rooms/:code/location` (auto interval in Seeking screen)
  - `Q&A`: question picker (`/defs/questions`) + `ask` + `answer`
  - `Cards`: `drawCard` + hand display + `castCurse`
  - `Dice`: `rollDice`
  - `Catch`: `claimCatch`
  - `Log`: realtime event stream
- Buttons are auto-disabled by `projection.allowedActions` and `projection.capabilities`, with visible disable reason
- Dev Settings modal: runtime override for `HTTP_BASE_URL` and `WS_BASE_URL` persisted via AsyncStorage

## Network base URL strategy

Priority order for mobile runtime URL resolution:

1. Saved override in AsyncStorage (Dev Settings)
2. `.env` / shell env (`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_WS_BASE_URL`)
3. `app.config.js` `extra.apiBaseUrl` / `extra.wsBaseUrl`
4. Default fallback: Android emulator host `http://10.0.2.2:8080` and `ws://10.0.2.2:8080/ws`

### Address rules

- Android emulator -> host machine: `http://10.0.2.2:PORT`
- Physical phone -> host machine: `http://<your-lan-ip>:PORT` (for example `http://192.168.1.20:8080`)

## Environment examples

Copy `.env.example` to `.env` and adjust:

```bash
EXPO_PUBLIC_SERVER_PORT=8080
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8080
EXPO_PUBLIC_WS_BASE_URL=ws://10.0.2.2:8080/ws
```

## Start backend server

From project root:

```bash
cd "E:\Crazy_Project\Jet Lag App"
npm run dev:api
```

## Start mobile app (Android)

```bash
cd "E:\Crazy_Project\Jet Lag App\mobile"
npm install
npx expo install expo-location react-native-maps
npm run android
```

Or from project root in one command:

```bash
cd "E:\Crazy_Project\Jet Lag App"
npm run dev:android
```

In development mode, use `Dev Settings` inside app to switch emulator URL and LAN IP URL.

When the app first enters Seeking screen, allow foreground location permission.

## Realtime + projection sync

RoomScreen synchronizes from both sources:

1. `GET /rooms/:code/snapshot`
2. `GET /rooms/:code?playerId=...` (full projection with `allowedActions/capabilities/hand`)
3. Open WS: `<WS_BASE_URL>` and send:

```json
{
  "type": "SUBSCRIBE",
  "roomCode": "ABC123",
  "sinceCursor": "<snapshot.cursor>"
}
```

4. Apply `SNAPSHOT` / `EVENT_APPEND`, then refresh room projection for capability-correct action gating.

## Main action endpoints used by mobile

- `POST /rounds/:id/ask`
- `POST /rounds/:id/answer`
- `POST /rounds/:id/drawCard`
- `POST /rounds/:id/castCurse`
- `POST /rounds/:id/rollDice`
- `POST /rounds/:id/claimCatch`
- `POST /rooms/:code/location`
- `POST /rooms/:code/places/search`
- `POST /rooms/:code/map-annotations`
- `POST /rooms/:code/dev/advancePhase` (dev helper)
