# V34 Premium Web Upgrade Notes

V34 focuses on web/PWA reliability rather than duplicating features that v33 already had.

### Added
- PWA icons, shortcuts, safer update lifecycle and offline shell.
- Online/offline UI and connection diagnostics.
- Automatic weak-network performance mode.
- Swipe-up card play for touch devices.
- Safe-area, dynamic viewport and landscape table improvements.
- Smart turn coach.
- Runtime backend URL via `GAME_SERVER_URL`.
- Render deployment blueprint and health/readiness endpoints.
- Stronger browser security headers.

### Already present from v33 and retained
- Reconnect seat restoration.
- Cloud profiles, XP/levels and ranked seasons.
- Daily/weekly missions and achievements.
- Friends, tournaments, replays and leaderboard.
- Voice chat, host moderation and spectators.
- Hard bot behavior, public rooms and Quick Match.
- Fullscreen/orientation support, premium animations and shareable results.

### Backend boundary
The authoritative game backend remains responsible for shuffles, bids, legal moves, scoring, matchmaking, accounts, PostgreSQL/Redis persistence and anti-cheat enforcement. V34 deliberately does not create a second source of truth in the frontend server.


## V34.1 multiplayer connection fix
- Browser now uses same-origin Socket.IO.
- The web server proxies `/socket.io` and backend `/api` traffic to `GAME_SERVER_URL`.
- This removes the hosted-web CORS/origin mismatch that could leave the UI permanently Offline.
- Reconnect timeout/backoff is more tolerant of Render free-service cold starts.
