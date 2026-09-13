# Kaali Ni Tidi v34 — Premium Web Edition

Web-only release. No Android/Gradle/Capacitor native package is included.

## V34 upgrades
- Stronger installable PWA manifest with 192/512 maskable icons and shortcuts.
- Safer service-worker caching: game/API/socket traffic is never cached.
- Offline/reconnecting banner and live connection-quality chip.
- Connection diagnostics (ping, network type, downlink, PWA state).
- Automatic data-saver tuning on slow/high-latency connections.
- Mobile swipe-up-to-play gesture that still uses the existing server-verified card action.
- Mobile viewport/safe-area fixes and compact landscape table mode.
- One-tap fullscreen/landscape helper on mobile.
- Smart turn coach for bidding, Hukum choice and legal-card play.
- Runtime backend configuration via `GAME_SERVER_URL` — no rebuild required on Render.
- Production security headers and `/health`, `/ready`, `/api/runtime` endpoints.
- Render Blueprint included.

The existing v33 features remain: 3–8 player rooms, public/private tables, ranked play, cloud profiles, achievements, daily/weekly missions, tournaments, friends, replays, live voice, spectator mode, reconnect snapshots, fair-play audit, themes, PWA install and cinematic match flow.

## Run locally
```bash
npm install
npm start
```
Open `http://localhost:3000`.

## Verify
```bash
npm run verify
npm run check
```

## Render
Deploy this folder as a Node web service, or use `render.yaml`. Set `GAME_SERVER_URL` to the authoritative multiplayer backend URL.

## Persistence note
This package is the web frontend. Player accounts, ranked ratings, rooms, replays, Redis state and PostgreSQL data belong to the authoritative game backend. `DATABASE_URL` and `REDIS_URL` in this frontend are intentionally not used to duplicate game state.
