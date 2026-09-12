# Kali Tidi Royale V3

Premium real-time Kali Tidi for **4, 6, and 8 players**, built for Render.

## V3 upgrades

- **Real-time online rooms** with six-character invite codes.
- **WebSocket gameplay** using Flask-SocketIO.
- **Reconnect support:** seats remain reserved after refresh/disconnect.
- **Persistent active-room snapshots:** room/game state is stored in the database after every action and can be restored after an app restart.
- **Accounts:** register/login, XP, levels, wins, games, win rate, and rating.
- **Ranked rooms:** rating changes after each completed round. A ranked room needs at least two real players when it starts.
- **PostgreSQL on Render** with SQLite fallback for local development.
- **Private rooms + bots:** invite friends, then fill any empty seats with AI.
- **Smarter bots:** hand-strength bidding, long-suit leads, cheap winning cards, point-card protection, partner-aware play after information is known, and played-card/void-suit memory.
- **Tournament Hub:** account holders can create/join mode-specific Royale tournaments. Tournament rounds award 3 points for a win and 1 for a loss, with score difference as a tiebreaker.
- **Leaderboard:** persistent rating, wins, win rate, XP and level.
- **PWA:** installable manifest, service worker, app icon, and cached app shell.
- **Premium responsive UI:** black/gold/green table, dynamic 4P/6P/8P seat placement, card animation, secret partner display, live feed, mobile layout, and win confetti.
- **Shareable results** via the Web Share API with clipboard fallback.
- **Server-authoritative rules:** cards, bidding, PowerHouse, legal moves, partner calls, trick winners and scoring are validated on the Python server.

## Kali Tidi rules implemented

### 6 Player Royale
- Two decks with both `2♠` cards removed = **102 cards**
- **17 cards per player**
- **500 total card points**
- Bidding **250–500**, minimum step **+5**
- Bidder calls **2 partner cards**, making a team of 3

### 8 Player Royale
- Two full decks = **104 cards**
- **13 cards per player**
- **500 total card points**
- Bidding **250–500**, minimum step **+5**
- Bidder calls **3 partner cards**, making a team of 4

### Card points
- `3♠` = 30
- `10`, `J`, `Q`, `K`, `A` = 10
- Every `5` = 5
- Other cards = 0

The `3♠` is a high-value **point card**, not a universal highest trick card. Trick order still uses the normal rank order, with PowerHouse taking priority. In two-deck modes, when identical winning cards appear, the later identical card wins.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

Open:

```text
http://127.0.0.1:5000
```

On Windows, activate with `.venv\\Scripts\\activate`.

## Run tests

The engine tests do not need Flask:

```bash
python3 -m unittest discover -s tests -v
```

## Deploy to Render

The repository includes a Blueprint that creates both:

1. `kali-tidi-royale-v3` web service
2. `kali-tidi-royale-db` PostgreSQL database

Steps:

1. Upload the **contents of this folder** to the root of a GitHub repository.
2. Render → **New → Blueprint**.
3. Connect the repository.
4. Render reads `render.yaml`, provisions PostgreSQL, generates `SECRET_KEY`, installs dependencies, and deploys the WebSocket-enabled service.
5. Open the generated `onrender.com` URL.

Render Web Services support inbound WebSocket connections, and the Blueprint wires `DATABASE_URL` from the managed Postgres instance.

## Important production note

This V3 intentionally runs **one Gunicorn worker** because live room coordination is currently in-process. PostgreSQL persists room snapshots, accounts and statistics, so refreshes and service restarts can restore games. If you later want multiple web workers/instances, add a shared Socket.IO message queue (for example Render Key Value / Redis-compatible storage) and distributed room locks.

## Project structure

```text
kali_tidi_v3/
├── app.py                 # Flask, Socket.IO, accounts, rooms, DB, tournaments
├── engine.py              # Server-authoritative Kali Tidi rules + bots
├── render.yaml            # Render web service + Postgres Blueprint
├── Procfile
├── requirements.txt
├── templates/
│   └── index.html
├── static/
│   ├── game.js
│   ├── style.css
│   ├── manifest.json
│   ├── sw.js
│   └── icon.svg
└── tests/
    └── test_engine.py
```
