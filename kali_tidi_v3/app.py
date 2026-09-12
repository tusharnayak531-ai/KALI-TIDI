from __future__ import annotations

import json
import os
import random
import secrets
import string
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

from flask import Flask, jsonify, render_template, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

from engine import BOT_NAMES, GameEngine, MODE_CONFIGS, mode_catalog

BASE = Path(__file__).resolve().parent
app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-" + secrets.token_hex(24))
raw_db = os.getenv("DATABASE_URL", f"sqlite:///{BASE / 'kali_tidi.db'}")
if raw_db.startswith("postgres://"):
    raw_db = "postgresql://" + raw_db[len("postgres://"):]
app.config["SQLALCHEMY_DATABASE_URI"] = raw_db
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["JSON_SORT_KEYS"] = False

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading", manage_session=False)
ROOM_LOCK = threading.RLock()


def utcnow():
    return datetime.now(timezone.utc)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(24), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    rating = db.Column(db.Integer, nullable=False, default=1000)
    xp = db.Column(db.Integer, nullable=False, default=0)
    games = db.Column(db.Integer, nullable=False, default=0)
    wins = db.Column(db.Integer, nullable=False, default=0)
    avatar = db.Column(db.String(8), nullable=False, default="♠")
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    def public(self):
        return {
            "id": self.id,
            "username": self.username,
            "rating": self.rating,
            "xp": self.xp,
            "level": 1 + self.xp // 150,
            "games": self.games,
            "wins": self.wins,
            "losses": max(0, self.games - self.wins),
            "win_rate": round((self.wins / self.games * 100), 1) if self.games else 0,
            "avatar": self.avatar,
        }


class Match(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    room_code = db.Column(db.String(10), nullable=False, index=True)
    mode_key = db.Column(db.String(2), nullable=False)
    round_no = db.Column(db.Integer, nullable=False)
    ranked = db.Column(db.Boolean, nullable=False, default=False)
    tournament_id = db.Column(db.Integer, nullable=True)
    bid = db.Column(db.Integer, nullable=False)
    bidder_name = db.Column(db.String(40), nullable=False)
    result_json = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)


class ActiveRoom(db.Model):
    code = db.Column(db.String(10), primary_key=True)
    snapshot_json = db.Column(db.Text, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class Tournament(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(48), nullable=False)
    mode_key = db.Column(db.String(2), nullable=False)
    max_players = db.Column(db.Integer, nullable=False, default=32)
    creator_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    status = db.Column(db.String(16), nullable=False, default="open")
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    def public(self, viewer_user_id=None):
        entries = TournamentEntry.query.filter_by(tournament_id=self.id).order_by(
            TournamentEntry.points.desc(), TournamentEntry.wins.desc(), TournamentEntry.score_diff.desc()
        ).all()
        return {
            "id": self.id,
            "name": self.name,
            "mode_key": self.mode_key,
            "max_players": self.max_players,
            "status": self.status,
            "count": len(entries),
            "joined": any(e.user_id == viewer_user_id for e in entries) if viewer_user_id else False,
            "standings": [e.public(rank=i + 1) for i, e in enumerate(entries[:12])],
        }


class TournamentEntry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    tournament_id = db.Column(db.Integer, db.ForeignKey("tournament.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    points = db.Column(db.Integer, nullable=False, default=0)
    wins = db.Column(db.Integer, nullable=False, default=0)
    games = db.Column(db.Integer, nullable=False, default=0)
    score_diff = db.Column(db.Integer, nullable=False, default=0)
    __table_args__ = (db.UniqueConstraint("tournament_id", "user_id", name="uq_tournament_user"),)

    def public(self, rank=None):
        user = db.session.get(User, self.user_id)
        return {
            "rank": rank,
            "user_id": self.user_id,
            "username": user.username if user else "Player",
            "rating": user.rating if user else 1000,
            "points": self.points,
            "wins": self.wins,
            "games": self.games,
            "score_diff": self.score_diff,
        }


with app.app_context():
    db.create_all()


def guest_id() -> str:
    if "guest_id" not in session:
        session["guest_id"] = secrets.token_hex(8)
    return session["guest_id"]


def current_user() -> Optional[User]:
    uid = session.get("user_id")
    return db.session.get(User, uid) if uid else None


def identity_key() -> str:
    user = current_user()
    return f"u:{user.id}" if user else f"g:{guest_id()}"


def identity_name() -> str:
    user = current_user()
    return user.username if user else "Guest-" + guest_id()[-4:].upper()


def identity_user_id(key: str) -> Optional[int]:
    if key.startswith("u:"):
        try:
            return int(key.split(":", 1)[1])
        except ValueError:
            return None
    return None


def room_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(50):
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        if code not in ROOMS and db.session.get(ActiveRoom, code) is None:
            return code
    raise RuntimeError("Could not allocate room code")


class LiveRoom:
    def __init__(self, code: str, mode_key: str, host_key: str, host_name: str, ranked=False, tournament_id=None):
        if mode_key not in MODE_CONFIGS:
            raise ValueError("Invalid mode")
        self.code = code
        self.mode_key = mode_key
        self.ranked = bool(ranked)
        self.tournament_id = int(tournament_id) if tournament_id else None
        self.host_key = host_key
        self.seats = [None for _ in range(MODE_CONFIGS[mode_key]["players"])]
        self.seats[0] = self._member(host_key, host_name)
        self.engine: Optional[GameEngine] = None
        self.online_seats = set()
        self.persisted_rounds = set()

    @staticmethod
    def _member(key: str, name: str, bot=False):
        return {
            "key": key,
            "name": name[:32],
            "user_id": identity_user_id(key) if not bot else None,
            "bot": bool(bot),
        }

    @property
    def started(self):
        return self.engine is not None

    def seat_for(self, key: str) -> Optional[int]:
        for i, seat in enumerate(self.seats):
            if seat and seat["key"] == key:
                return i
        return None

    def human_count(self) -> int:
        return sum(1 for x in self.seats if x and not x["bot"])

    def bot_seats(self):
        return {i for i, x in enumerate(self.seats) if x and x["bot"]}

    def add_member(self, key: str, name: str) -> int:
        existing = self.seat_for(key)
        if existing is not None:
            return existing
        if self.started:
            raise ValueError("Game already started")
        try:
            idx = self.seats.index(None)
        except ValueError:
            raise ValueError("Room is full")
        self.seats[idx] = self._member(key, name)
        return idx

    def fill_bots(self):
        used = {x["name"] for x in self.seats if x}
        choices = [n for n in BOT_NAMES if n not in used]
        j = 0
        for i, seat in enumerate(self.seats):
            if seat is None:
                name = choices[j] if j < len(choices) else f"Bot {i+1}"
                j += 1
                self.seats[i] = self._member(f"bot:{self.code}:{i}", name, bot=True)

    def start(self):
        if self.started:
            return
        self.fill_bots()
        # Ranked rooms require at least two real people.
        if self.ranked and self.human_count() < 2:
            self.ranked = False
        names = [x["name"] for x in self.seats]
        self.engine = GameEngine(self.mode_key, names=names)
        self.engine.advance_bots(self.bot_seats())

    def action(self, key: str, data: dict):
        seat = self.seat_for(key)
        if seat is None:
            raise ValueError("You are not seated in this room")
        if not self.engine:
            raise ValueError("Game has not started")
        action = data.get("action")
        if action == "pass":
            self.engine.auction_action(seat, pass_turn=True)
        elif action == "bid":
            self.engine.auction_action(seat, int(data.get("bid")))
        elif action == "contract":
            self.engine.set_contract(seat, data.get("trump"), data.get("called_ids") or [])
        elif action == "play":
            self.engine.play_card(seat, int(data.get("card_id")))
        elif action == "next_round":
            if self.engine.phase != "result":
                raise ValueError("Round is not finished")
            self.engine.new_round()
        else:
            raise ValueError("Unknown action")
        self.engine.advance_bots(self.bot_seats())

    def public_state(self, viewer_key: Optional[str]) -> dict:
        viewer = self.seat_for(viewer_key) if viewer_key else None
        seats = []
        for idx, member in enumerate(self.seats):
            seats.append({
                "seat": idx,
                "name": member["name"] if member else "Open seat",
                "bot": bool(member and member["bot"]),
                "occupied": member is not None,
                "online": idx in self.online_seats,
                "you": viewer == idx,
                "rating": self._rating(member),
            })
        payload = {
            "room": {
                "code": self.code,
                "mode_key": self.mode_key,
                "ranked": self.ranked,
                "tournament_id": self.tournament_id,
                "host": viewer_key == self.host_key,
                "started": self.started,
                "seats": seats,
                "viewer_seat": viewer,
                "human_count": self.human_count(),
            }
        }
        if self.engine:
            payload["game"] = self.engine.public_state(viewer)
        return payload

    def _rating(self, member):
        if not member or not member.get("user_id"):
            return None
        user = db.session.get(User, member["user_id"])
        return user.rating if user else None

    def to_dict(self):
        return {
            "code": self.code,
            "mode_key": self.mode_key,
            "ranked": self.ranked,
            "tournament_id": self.tournament_id,
            "host_key": self.host_key,
            "seats": self.seats,
            "engine": self.engine.to_dict() if self.engine else None,
            "persisted_rounds": sorted(self.persisted_rounds),
        }

    @classmethod
    def from_dict(cls, data: dict):
        obj = cls.__new__(cls)
        obj.code = data["code"]
        obj.mode_key = data["mode_key"]
        obj.ranked = bool(data.get("ranked"))
        obj.tournament_id = data.get("tournament_id")
        obj.host_key = data["host_key"]
        obj.seats = data["seats"]
        obj.engine = GameEngine.from_dict(data["engine"]) if data.get("engine") else None
        obj.online_seats = set()
        obj.persisted_rounds = set(data.get("persisted_rounds", []))
        return obj


ROOMS: Dict[str, LiveRoom] = {}
SID_CONTEXT: Dict[str, dict] = {}


def save_room(room: LiveRoom):
    row = db.session.get(ActiveRoom, room.code)
    raw = json.dumps(room.to_dict(), separators=(",", ":"))
    if row is None:
        row = ActiveRoom(code=room.code, snapshot_json=raw)
        db.session.add(row)
    else:
        row.snapshot_json = raw
        row.updated_at = utcnow()
    db.session.commit()


def load_room(code: str) -> Optional[LiveRoom]:
    code = code.upper().strip()
    with ROOM_LOCK:
        room = ROOMS.get(code)
        if room:
            return room
        row = db.session.get(ActiveRoom, code)
        if not row:
            return None
        try:
            room = LiveRoom.from_dict(json.loads(row.snapshot_json))
            ROOMS[code] = room
            return room
        except Exception:
            return None


def update_rank_and_history(room: LiveRoom):
    engine = room.engine
    if not engine or engine.phase != "result" or not engine.round_result:
        return
    if engine.round in room.persisted_rounds:
        return
    result = engine.round_result
    match = Match(
        room_code=room.code,
        mode_key=room.mode_key,
        round_no=engine.round,
        ranked=room.ranked,
        tournament_id=room.tournament_id,
        bid=int(result["bid"]),
        bidder_name=engine.names[result["bidder"]],
        result_json=json.dumps(result),
    )
    db.session.add(match)
    winning = set(result["winning_team"])
    diff = int(result["bid_points"]) - int(result["def_points"])
    rating_delta = 12 + round(8 * int(result["bid"]) / engine.config["bid_max"])
    for seat, member in enumerate(room.seats):
        if not member or member["bot"] or not member.get("user_id"):
            continue
        user = db.session.get(User, member["user_id"])
        if not user:
            continue
        won = seat in winning
        user.games += 1
        user.wins += 1 if won else 0
        user.xp += 30 if won else 14
        if room.ranked:
            user.rating = max(100, user.rating + (rating_delta if won else -rating_delta))
        if room.tournament_id:
            entry = TournamentEntry.query.filter_by(tournament_id=room.tournament_id, user_id=user.id).first()
            tournament = db.session.get(Tournament, room.tournament_id)
            if entry and tournament and tournament.status == "open" and tournament.mode_key == room.mode_key:
                entry.games += 1
                entry.wins += 1 if won else 0
                entry.points += 3 if won else 1
                entry.score_diff += diff if seat in engine.bid_team() else -diff
    room.persisted_rounds.add(engine.round)
    db.session.commit()
    save_room(room)


def room_payload(room: LiveRoom, key: str):
    return room.public_state(key)


def broadcast_room(room: LiveRoom):
    for sid, ctx in list(SID_CONTEXT.items()):
        if ctx.get("code") == room.code:
            socketio.emit("state", room_payload(room, ctx["key"]), to=sid)


def serialize_user(user: Optional[User]):
    return user.public() if user else None


def top_users(limit=20):
    rows = User.query.order_by(User.rating.desc(), User.wins.desc(), User.games.asc()).limit(limit).all()
    return [{"rank": i + 1, **u.public()} for i, u in enumerate(rows)]


@app.get("/")
def index():
    guest_id()
    return render_template("index.html")


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True, "version": "3.0"})


@app.get("/api/bootstrap")
def bootstrap():
    user = current_user()
    tournaments = Tournament.query.filter(Tournament.status == "open").order_by(Tournament.created_at.desc()).limit(12).all()
    return jsonify({
        "user": serialize_user(user),
        "guest_name": identity_name() if not user else None,
        "modes": mode_catalog(),
        "leaderboard": top_users(12),
        "tournaments": [t.public(user.id if user else None) for t in tournaments],
    })


@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    if not (3 <= len(username) <= 24) or not all(ch.isalnum() or ch in "_-" for ch in username):
        return jsonify({"error": "Username must be 3–24 letters, numbers, _ or -"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    if User.query.filter(db.func.lower(User.username) == username.lower()).first():
        return jsonify({"error": "Username already exists"}), 409
    user = User(username=username, password_hash=generate_password_hash(password))
    db.session.add(user)
    db.session.commit()
    session["user_id"] = user.id
    return jsonify({"user": user.public()})


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    user = User.query.filter(db.func.lower(User.username) == username.lower()).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Invalid username or password"}), 401
    session["user_id"] = user.id
    return jsonify({"user": user.public()})


@app.post("/api/logout")
def logout():
    session.pop("user_id", None)
    return jsonify({"ok": True})


@app.get("/api/profile")
def profile():
    user = current_user()
    if not user:
        return jsonify({"error": "Login required"}), 401
    # Match history is derived from room snapshots/results; keep the response compact.
    return jsonify({"user": user.public()})


@app.get("/api/leaderboard")
def leaderboard():
    return jsonify({"leaderboard": top_users(50)})


@app.post("/api/rooms")
def create_room():
    data = request.get_json(silent=True) or {}
    mode_key = str(data.get("mode_key", "6"))
    if mode_key not in MODE_CONFIGS:
        return jsonify({"error": "Choose 4, 6, or 8 player mode"}), 400
    ranked = bool(data.get("ranked"))
    user = current_user()
    if ranked and not user:
        return jsonify({"error": "Login to create a ranked room"}), 401
    tournament_id = data.get("tournament_id")
    if tournament_id:
        if not user:
            return jsonify({"error": "Login to play a tournament"}), 401
        tournament = db.session.get(Tournament, int(tournament_id))
        entry = TournamentEntry.query.filter_by(tournament_id=int(tournament_id), user_id=user.id).first()
        if not tournament or tournament.status != "open" or tournament.mode_key != mode_key or not entry:
            return jsonify({"error": "Join an open tournament of the same mode first"}), 400
    key = identity_key()
    with ROOM_LOCK:
        code = room_code()
        room = LiveRoom(code, mode_key, key, identity_name(), ranked=ranked, tournament_id=tournament_id)
        ROOMS[code] = room
        if bool(data.get("fill_bots")):
            room.start()
        save_room(room)
    return jsonify({"code": code, "state": room.public_state(key)})


@app.get("/api/rooms/<code>")
def room_info(code):
    room = load_room(code)
    if not room:
        return jsonify({"error": "Room not found"}), 404
    return jsonify(room.public_state(identity_key()))


@app.get("/api/tournaments")
def tournaments_list():
    user = current_user()
    rows = Tournament.query.order_by(Tournament.created_at.desc()).limit(30).all()
    return jsonify({"tournaments": [t.public(user.id if user else None) for t in rows]})


@app.post("/api/tournaments")
def tournament_create():
    user = current_user()
    if not user:
        return jsonify({"error": "Login required"}), 401
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "Royale Cup")).strip()[:48] or "Royale Cup"
    mode_key = str(data.get("mode_key", "6"))
    max_players = max(4, min(64, int(data.get("max_players", 32))))
    if mode_key not in MODE_CONFIGS:
        return jsonify({"error": "Invalid mode"}), 400
    t = Tournament(name=name, mode_key=mode_key, max_players=max_players, creator_id=user.id)
    db.session.add(t)
    db.session.flush()
    db.session.add(TournamentEntry(tournament_id=t.id, user_id=user.id))
    db.session.commit()
    return jsonify({"tournament": t.public(user.id)})


@app.post("/api/tournaments/<int:tournament_id>/join")
def tournament_join(tournament_id):
    user = current_user()
    if not user:
        return jsonify({"error": "Login required"}), 401
    t = db.session.get(Tournament, tournament_id)
    if not t or t.status != "open":
        return jsonify({"error": "Tournament is not open"}), 404
    existing = TournamentEntry.query.filter_by(tournament_id=t.id, user_id=user.id).first()
    if existing:
        return jsonify({"tournament": t.public(user.id)})
    count = TournamentEntry.query.filter_by(tournament_id=t.id).count()
    if count >= t.max_players:
        return jsonify({"error": "Tournament is full"}), 409
    db.session.add(TournamentEntry(tournament_id=t.id, user_id=user.id))
    db.session.commit()
    return jsonify({"tournament": t.public(user.id)})


@socketio.on("connect")
def ws_connect():
    guest_id()
    emit("connected", {"ok": True})


@socketio.on("room_join")
def ws_room_join(data):
    code = str((data or {}).get("code", "")).upper().strip()
    room = load_room(code)
    if not room:
        emit("error_message", {"error": "Room not found"})
        return
    key = identity_key()
    name = identity_name()
    with ROOM_LOCK:
        try:
            seat = room.add_member(key, name)
        except ValueError as exc:
            emit("error_message", {"error": str(exc)})
            return
        join_room(code)
        SID_CONTEXT[request.sid] = {"code": code, "key": key, "seat": seat}
        room.online_seats.add(seat)
        save_room(room)
        broadcast_room(room)


@socketio.on("room_start")
def ws_room_start(_data=None):
    ctx = SID_CONTEXT.get(request.sid)
    if not ctx:
        emit("error_message", {"error": "Join a room first"})
        return
    room = load_room(ctx["code"])
    if not room:
        return
    if ctx["key"] != room.host_key:
        emit("error_message", {"error": "Only the host can start"})
        return
    with ROOM_LOCK:
        room.start()
        update_rank_and_history(room)
        save_room(room)
        broadcast_room(room)


@socketio.on("game_action")
def ws_game_action(data):
    ctx = SID_CONTEXT.get(request.sid)
    if not ctx:
        emit("error_message", {"error": "Join a room first"})
        return
    room = load_room(ctx["code"])
    if not room:
        emit("error_message", {"error": "Room not found"})
        return
    try:
        with ROOM_LOCK:
            room.action(ctx["key"], data or {})
            update_rank_and_history(room)
            save_room(room)
            broadcast_room(room)
    except (ValueError, TypeError) as exc:
        emit("error_message", {"error": str(exc)})


@socketio.on("room_leave")
def ws_room_leave(_data=None):
    ctx = SID_CONTEXT.pop(request.sid, None)
    if not ctx:
        return
    room = load_room(ctx["code"])
    if room:
        room.online_seats.discard(ctx["seat"])
        leave_room(ctx["code"])
        save_room(room)
        broadcast_room(room)


@socketio.on("disconnect")
def ws_disconnect():
    ctx = SID_CONTEXT.pop(request.sid, None)
    if not ctx:
        return
    room = load_room(ctx["code"])
    if room:
        room.online_seats.discard(ctx["seat"])
        save_room(room)
        broadcast_room(room)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    socketio.run(app, host="0.0.0.0", port=port, debug=debug, allow_unsafe_werkzeug=True)
