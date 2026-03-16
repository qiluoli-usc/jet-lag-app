# Mobile Client

This folder contains the Expo React Native client for Jet Lag App.

## Current Mobile Scope

Implemented in the current version:

- authentication: register / login / logout
- home screen: create room, join room, runtime network override
- room bootstrap from HTTP snapshot + room projection
- realtime sync over WebSocket with reconnect
- local persistence for:
  - auth session
  - network settings
  - room player session
- phase routing:
  - `Lobby`
  - `Hiding`
  - `Seeking`
  - `Summary`

Current phase behavior:

- `Lobby`
  - ready / cancel ready
  - start round
- `Hiding`
  - live countdown until seek starts
  - role roster summary
- `Seeking`
  - seeker view: `Map / Ask / Catch / Tools / Log`
  - hider view: `Map / Answer / Rewards / Cards / Tools / Log`
  - reward-card choice after eligible answers
  - active curse banner with remaining time
  - map, location, polygon drawing, POI search
  - card draw / cast curse / dice / catch claim
- `Summary`
  - winner + reason
  - hide / seek timing
  - seeker route map
  - summary timeline
  - `Prepare Next Round`

## Start

From repo root, start backend first:

```powershell
cd "E:\Crazy_Project\Jet Lag App"
npm run dev:api
```

Then start Expo:

```powershell
cd "E:\Crazy_Project\Jet Lag App\mobile"
npm install
npm run start
```

Other scripts:

```powershell
npm run ios
npm run android
npm run web
```

## Network Configuration

The app resolves backend addresses in this order:

1. saved override in AsyncStorage
2. `EXPO_PUBLIC_API_BASE_URL` / `EXPO_PUBLIC_WS_BASE_URL`
3. values injected from `app.config.js`
4. default Android emulator fallback `10.0.2.2:8080`

This is why the app can keep pointing to an old IP even after your computer's LAN IP changes.

If room creation or login suddenly times out:

1. open `Open Dev Settings` in the app
2. update `HTTP` and `WS` to your computer's current LAN IP
3. save and retry

Example for a real phone on LAN:

- `HTTP`: `http://192.168.0.100:8080`
- `WS`: `ws://192.168.0.100:8080/ws`

Example for Android emulator:

- `HTTP`: `http://10.0.2.2:8080`
- `WS`: `ws://10.0.2.2:8080/ws`

## Environment Example

See [.env.example](.env.example)

Typical local values:

```bash
EXPO_PUBLIC_SERVER_PORT=8080
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8080
EXPO_PUBLIC_WS_BASE_URL=ws://10.0.2.2:8080/ws
```

## Expo Go vs Development Build

Expo Go is fine for most UI and gameplay iteration, but there are important limits.

In Expo Go:

- remote push notifications are not fully supported
- iPhone background location is not fully supported
- the app falls back to foreground-only tracking on iPhone

Use a development build when you need to verify:

- real remote push delivery
- iOS background location
- native permission behavior closer to production

## iOS / Android Notes

iOS config currently includes:

- background location mode
- remote-notification background mode
- required `NSLocation*UsageDescription` keys

Android config currently requests:

- `ACCESS_BACKGROUND_LOCATION`

## Realtime Flow

Room sync uses both REST and WebSocket:

1. `GET /rooms/:code/snapshot?playerId=...`
2. `GET /rooms/:code?playerId=...`
3. open `ws://<host>:8080/ws`
4. send `SUBSCRIBE { roomCode, playerId, sinceCursor, token }`
5. merge `SNAPSHOT` and `EVENT_APPEND`

The app refreshes room projection after action execution so role/capability gating stays accurate.

## Main Mobile API Usage

Endpoints used directly by the app include:

- `POST /auth/register`
- `POST /auth/login`
- `POST /rooms`
- `POST /rooms/:code/join`
- `POST /rooms/:code/leave`
- `POST /rooms/:code/ready`
- `POST /rooms/:code/startRound`
- `POST /rooms/:code/next-round`
- `POST /rooms/:code/location`
- `POST /rooms/:code/places/search`
- `POST /rooms/:code/map-annotations`
- `POST /rooms/:code/rewards/choose`
- `POST /rounds/:id/ask`
- `POST /rounds/:id/answer`
- `POST /rounds/:id/drawCard`
- `POST /rounds/:id/castCurse`
- `POST /rounds/:id/rollDice`
- `POST /rounds/:id/claimCatch`

## Debug Notes

Development helpers currently available in the room header:

- `Next Phase`
- `+2 Phases`
- `Refresh`

Useful when validating:

- hiding -> seeking transition
- summary generation
- next-round reset back to lobby

## Tech Stack

- Expo SDK 54
- React Native 0.81
- React 19
- TypeScript
- `react-native-maps`
- `expo-location`
- `expo-task-manager`
- `expo-notifications`
