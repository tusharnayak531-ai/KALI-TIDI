# V34.1 Connection Fix

The V34 frontend could load normally but stay **Offline** because the browser attempted Socket.IO against the frontend origin while the authoritative multiplayer server lived at a different Render URL.

V34.1 fixes this by making the V34 web server a same-origin reverse proxy:

- `/socket.io/*` -> `GAME_SERVER_URL/socket.io/*` (including WebSocket upgrades)
- `/api/*` -> `GAME_SERVER_URL/api/*`
- `/api/runtime` remains local so you can see the configured backend

This also avoids browser CORS issues and makes localhost, Render and installed-PWA behavior consistent.
