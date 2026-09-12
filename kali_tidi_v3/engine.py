from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Set

SUITS = {
    "S": {"symbol": "♠", "name": "Spades", "red": False},
    "H": {"symbol": "♥", "name": "Hearts", "red": True},
    "D": {"symbol": "♦", "name": "Diamonds", "red": True},
    "C": {"symbol": "♣", "name": "Clubs", "red": False},
}
RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
BOT_NAMES = ["Riya", "Meera", "Arjun", "Kabir", "Diya", "Vivaan", "Isha", "Aarav"]

MODE_CONFIGS = {
    "4": {
        "label": "4 Player Classic",
        "players": 4,
        "decks": 1,
        "remove_spade_twos": 0,
        "cards_per_player": 13,
        "total_cards": 52,
        "total_points": 250,
        "bid_start": 150,
        "bid_max": 250,
        "bid_increment": 5,
        "partners_required": 1,
        "team_size": 2,
        "tricks": 13,
        "source_note": "One-deck classic mode",
    },
    "6": {
        "label": "6 Player Royale",
        "players": 6,
        "decks": 2,
        "remove_spade_twos": 2,
        "cards_per_player": 17,
        "total_cards": 102,
        "total_points": 500,
        "bid_start": 250,
        "bid_max": 500,
        "bid_increment": 5,
        "partners_required": 2,
        "team_size": 3,
        "tricks": 17,
        "source_note": "Two decks · both 2♠ cards removed",
    },
    "8": {
        "label": "8 Player Royale",
        "players": 8,
        "decks": 2,
        "remove_spade_twos": 0,
        "cards_per_player": 13,
        "total_cards": 104,
        "total_points": 500,
        "bid_start": 250,
        "bid_max": 500,
        "bid_increment": 5,
        "partners_required": 3,
        "team_size": 4,
        "tricks": 13,
        "source_note": "Two full 52-card decks",
    },
}


@dataclass(frozen=True)
class Card:
    id: int
    suit: str
    rank: str
    deck_no: int

    def public(self) -> dict:
        return {
            "id": self.id,
            "suit": self.suit,
            "rank": self.rank,
            "symbol": SUITS[self.suit]["symbol"],
            "red": SUITS[self.suit]["red"],
            "points": point_value(self),
            "deck_no": self.deck_no,
            "copy_label": f"Copy {self.deck_no}" if self.deck_no > 1 else "",
            "is_kali": self.suit == "S" and self.rank == "3",
        }


def rank_value(card: Card) -> int:
    return RANKS.index(card.rank)


def point_value(card: Card) -> int:
    if card.suit == "S" and card.rank == "3":
        return 30
    if card.rank in {"10", "J", "Q", "K", "A"}:
        return 10
    if card.rank == "5":
        return 5
    return 0


def card_label(card: Card, include_copy: bool = False) -> str:
    label = f"{card.rank}{SUITS[card.suit]['symbol']}"
    if include_copy and card.deck_no > 1:
        label += f" · D{card.deck_no}"
    return label


def make_deck(config: dict) -> List[Card]:
    cards: List[Card] = []
    cid = 0
    for deck_no in range(1, config["decks"] + 1):
        for suit in SUITS:
            for rank in RANKS:
                cards.append(Card(cid, suit, rank, deck_no))
                cid += 1
    remaining_removals = config.get("remove_spade_twos", 0)
    if remaining_removals:
        kept = []
        for card in cards:
            if remaining_removals and card.suit == "S" and card.rank == "2":
                remaining_removals -= 1
                continue
            kept.append(card)
        cards = kept
    return cards


def mode_catalog() -> List[dict]:
    return [{"key": key, **MODE_CONFIGS[key]} for key in ("4", "6", "8")]


class GameEngine:
    """Server-authoritative Kali Tidi rules engine.

    Human/bot ownership is handled by the room layer. The engine only knows seats.
    """

    def __init__(self, mode_key: str, names: Optional[List[str]] = None, seed: Optional[int] = None):
        if mode_key not in MODE_CONFIGS:
            raise ValueError("Choose 4, 6, or 8 player mode")
        self.mode_key = mode_key
        self.config = dict(MODE_CONFIGS[mode_key])
        self.players = self.config["players"]
        self.rng = random.Random(seed)
        defaults = ["Player 1"] + BOT_NAMES
        self.names = (names or defaults)[: self.players]
        while len(self.names) < self.players:
            self.names.append(f"Player {len(self.names)+1}")
        self.round = 0
        self.dealer = self.rng.randrange(self.players)
        self.events: List[str] = []
        self.new_round()

    def emit(self, text: str):
        self.events.append(text)
        self.events = self.events[-80:]

    def set_names(self, names: List[str]):
        if len(names) != self.players:
            raise ValueError("Name count must match player count")
        self.names = list(names)

    def new_round(self):
        self.round += 1
        self.dealer = (self.dealer + 1) % self.players
        deck = make_deck(self.config)
        self.rng.shuffle(deck)
        self.hands: List[List[Card]] = [[] for _ in range(self.players)]
        for index, card in enumerate(deck):
            self.hands[index % self.players].append(card)
        order = {"S": 0, "H": 1, "D": 2, "C": 3}
        for hand in self.hands:
            hand.sort(key=lambda c: (order[c.suit], rank_value(c), c.deck_no))
        self.phase = "auction"
        self.high_bid = self.config["bid_start"] - self.config["bid_increment"]
        self.high_bidder: Optional[int] = None
        self.passed = [False] * self.players
        self.auction_turn = (self.dealer + 1) % self.players
        self.bidder: Optional[int] = None
        self.bid: Optional[int] = None
        self.trump: Optional[str] = None
        self.called_cards: List[Card] = []
        self.partner_players: List[int] = []
        self.revealed_partner_players: Set[int] = set()
        self.revealed_called_ids: Set[int] = set()
        self.turn: Optional[int] = None
        self.current_trick: List[dict] = []
        self.captured: List[List[Card]] = [[] for _ in range(self.players)]
        self.tricks_won = [0] * self.players
        self.tricks_played = 0
        self.played_cards: List[Card] = []
        self.void_suits: List[Set[str]] = [set() for _ in range(self.players)]
        self.round_result: Optional[dict] = None
        self.events = []
        self.emit(
            f"Round {self.round}: {self.config['total_cards']} cards dealt "
            f"({self.config['cards_per_player']} each)"
        )

    def next_actor(self) -> Optional[int]:
        if self.phase == "auction":
            return self.auction_turn
        if self.phase == "contract":
            return self.bidder
        if self.phase == "play":
            return self.turn
        return None

    def bid_team(self) -> Set[int]:
        if self.bidder is None:
            return set()
        return {self.bidder, *self.partner_players}

    def next_legal_bid(self) -> int:
        return max(self.config["bid_start"], self.high_bid + self.config["bid_increment"])

    def legal_cards(self, player: int) -> List[Card]:
        hand = self.hands[player]
        if not self.current_trick:
            return hand[:]
        lead_suit = self.current_trick[0]["card"].suit
        follow = [c for c in hand if c.suit == lead_suit]
        return follow if follow else hand[:]

    def winner_of(self, trick: List[dict]) -> int:
        if not trick:
            raise ValueError("Cannot score an empty trick")
        trump_entries = [(i, item) for i, item in enumerate(trick) if item["card"].suit == self.trump]
        if trump_entries:
            candidates = trump_entries
        else:
            lead_suit = trick[0]["card"].suit
            candidates = [(i, item) for i, item in enumerate(trick) if item["card"].suit == lead_suit]
        # The later identical winning card beats the earlier copy in two-deck play.
        _, winning = max(candidates, key=lambda pair: (rank_value(pair[1]["card"]), pair[0]))
        return winning["player"]

    def auction_action(self, player: int, bid: Optional[int] = None, pass_turn: bool = False):
        if self.phase != "auction" or self.auction_turn != player:
            raise ValueError("It is not your bidding turn")
        if pass_turn:
            self.passed[player] = True
            self.emit(f"{self.names[player]} passed")
        else:
            requested = self.next_legal_bid() if bid is None else int(bid)
            if requested < self.next_legal_bid():
                raise ValueError(f"Minimum next bid is {self.next_legal_bid()}")
            if requested > self.config["bid_max"]:
                raise ValueError(f"Maximum bid is {self.config['bid_max']}")
            if requested % self.config["bid_increment"]:
                raise ValueError(f"Bids must use +{self.config['bid_increment']} steps")
            self.high_bid = requested
            self.high_bidder = player
            self.emit(f"{self.names[player]} bid {requested}")
        self._advance_auction_turn()

    def _advance_auction_turn(self):
        if self.high_bidder is not None:
            challengers = [
                p for p in range(self.players)
                if not self.passed[p] and p != self.high_bidder
            ]
            if not challengers:
                self._finish_auction()
                return
        elif all(self.passed):
            self.emit("Everyone passed — redealing")
            self.new_round()
            return

        start = self.auction_turn
        for step in range(1, self.players + 1):
            p = (start + step) % self.players
            if self.passed[p]:
                continue
            if self.high_bidder is not None and p == self.high_bidder:
                continue
            self.auction_turn = p
            return
        if self.high_bidder is not None:
            self._finish_auction()

    def _finish_auction(self):
        if self.high_bidder is None:
            self.new_round()
            return
        self.bidder = self.high_bidder
        self.bid = self.high_bid
        self.phase = "contract"
        self.emit(f"{self.names[self.bidder]} won the auction at {self.bid}")

    def available_called_cards(self, player: int) -> List[Card]:
        if self.phase != "contract" or self.bidder != player:
            return []
        own = {c.id for c in self.hands[player]}
        options = [c for c in make_deck(self.config) if c.id not in own]
        return sorted(options, key=lambda c: (point_value(c), rank_value(c), c.suit, -c.deck_no), reverse=True)

    def holder_of(self, card_id: int) -> int:
        for p, hand in enumerate(self.hands):
            if any(c.id == card_id for c in hand):
                return p
        return -1

    def set_contract(self, player: int, trump: str, called_ids: Iterable[int]):
        if self.phase != "contract" or self.bidder != player:
            raise ValueError("Contract selection is not available")
        if trump not in SUITS:
            raise ValueError("Invalid PowerHouse suit")
        called_ids = [int(x) for x in called_ids]
        required = self.config["partners_required"]
        if len(called_ids) != required:
            raise ValueError(f"Choose exactly {required} partner card(s)")
        if len(set(called_ids)) != required:
            raise ValueError("Partner cards must be different")
        own = {c.id for c in self.hands[player]}
        full = {c.id: c for c in make_deck(self.config)}
        selected: List[Card] = []
        holders: List[int] = []
        for cid in called_ids:
            if cid in own:
                raise ValueError("You cannot call a card in your own hand")
            card = full.get(cid)
            holder = self.holder_of(cid)
            if card is None or holder < 0 or holder == player:
                raise ValueError("Invalid partner card")
            selected.append(card)
            holders.append(holder)
        if len(set(holders)) != required:
            raise ValueError("Choose cards held by different partners")
        self.trump = trump
        self.called_cards = selected
        self.partner_players = holders
        self.phase = "play"
        self.turn = self.bidder
        calls = ", ".join(card_label(c, True) for c in selected)
        self.emit(f"{self.names[player]} chose {SUITS[trump]['symbol']} PowerHouse and called {calls}")
        self.emit(f"Play begins — {self.names[self.turn]} leads")

    def play_card(self, player: int, card_id: int):
        if self.phase != "play" or self.turn != player:
            raise ValueError("It is not your turn")
        legal_ids = {c.id for c in self.legal_cards(player)}
        if card_id not in legal_ids:
            raise ValueError("You must follow the led suit when possible")
        idx = next((i for i, c in enumerate(self.hands[player]) if c.id == card_id), None)
        if idx is None:
            raise ValueError("Card not found")
        card = self.hands[player].pop(idx)
        if self.current_trick:
            lead_suit = self.current_trick[0]["card"].suit
            if card.suit != lead_suit:
                self.void_suits[player].add(lead_suit)
        self.current_trick.append({"player": player, "card": card})
        self.played_cards.append(card)
        self.emit(f"{self.names[player]} played {card_label(card, True)}")

        if card.id in {c.id for c in self.called_cards} and card.id not in self.revealed_called_ids:
            self.revealed_called_ids.add(card.id)
            self.revealed_partner_players.add(player)
            self.emit(f"Partner revealed — {self.names[player]} holds {card_label(card, True)}")

        if len(self.current_trick) == self.players:
            winner = self.winner_of(self.current_trick)
            points = sum(point_value(x["card"]) for x in self.current_trick)
            self.captured[winner].extend(x["card"] for x in self.current_trick)
            self.tricks_won[winner] += 1
            self.tricks_played += 1
            self.emit(f"{self.names[winner]} won trick {self.tricks_played} (+{points})")
            self.current_trick = []
            if all(not hand for hand in self.hands):
                self._finish_round()
            else:
                self.turn = winner
        else:
            self.turn = (player + 1) % self.players

    def team_points(self) -> dict:
        if self.bidder is None:
            return {"bid": 0, "def": 0}
        bid_team = self.bid_team()
        bid_points = 0
        def_points = 0
        player_points = []
        for p in range(self.players):
            value = sum(point_value(c) for c in self.captured[p])
            player_points.append(value)
            if p in bid_team:
                bid_points += value
            else:
                def_points += value
        return {"bid": bid_points, "def": def_points, "players": player_points}

    def _finish_round(self):
        self.phase = "result"
        totals = self.team_points()
        made = totals["bid"] >= int(self.bid or 0)
        winning_team = sorted(self.bid_team() if made else (set(range(self.players)) - self.bid_team()))
        self.revealed_partner_players.update(self.partner_players)
        self.round_result = {
            "made": made,
            "bid_points": totals["bid"],
            "def_points": totals["def"],
            "player_points": totals.get("players", []),
            "bid": self.bid,
            "bidder": self.bidder,
            "bid_team": sorted(self.bid_team()),
            "winning_team": winning_team,
            "tricks_won": list(self.tricks_won),
            "total_points": self.config["total_points"],
        }
        self.emit("Round complete — " + ("contract made" if made else "contract failed"))

    # ----------------------------- bot intelligence -----------------------------
    def bot_bid_decision(self, player: int) -> Optional[int]:
        hand = self.hands[player]
        points = sum(point_value(c) for c in hand)
        avg = self.config["total_points"] / self.players
        suit_strength = {}
        for suit in SUITS:
            cards = [c for c in hand if c.suit == suit]
            suit_strength[suit] = len(cards) * 2.2 + sum(max(0, rank_value(c) - 8) for c in cards) * 1.5
        top_suit = max(suit_strength.values())
        aces = sum(1 for c in hand if c.rank == "A")
        kings = sum(1 for c in hand if c.rank == "K")
        kali = sum(1 for c in hand if c.suit == "S" and c.rank == "3")
        confidence = (
            self.config["bid_start"]
            + max(0, points - avg) * 1.15
            + top_suit * 1.6
            + aces * 8
            + kings * 4
            + kali * 8
            + self.rng.choice([0, 0, 5, 10, 15])
        )
        confidence = min(self.config["bid_max"], int(confidence // 5) * 5)
        nxt = self.next_legal_bid()
        if nxt > self.config["bid_max"]:
            return None
        if self.high_bidder is None and nxt == self.config["bid_start"]:
            return nxt if confidence >= nxt or self.rng.random() < 0.68 else None
        if nxt <= confidence and self.rng.random() < 0.84:
            jump = self.rng.choice([0, 0, 0, 5, 10])
            return min(self.config["bid_max"], nxt + jump)
        return None

    def bot_set_contract(self, player: int):
        hand = self.hands[player]
        scores = {suit: 0.0 for suit in SUITS}
        for c in hand:
            scores[c.suit] += 1 + rank_value(c) / 10 + point_value(c) / 12
        trump = max(scores, key=scores.get)

        others = [p for p in range(self.players) if p != player]
        # Prefer partners whose hands contain useful high/point cards.
        ranked_players = sorted(
            others,
            key=lambda p: sum(point_value(c) + max(0, rank_value(c) - 9) for c in self.hands[p]),
            reverse=True,
        )
        partner_players = ranked_players[: self.config["partners_required"]]
        calls: List[int] = []
        for partner in partner_players:
            candidates = sorted(
                self.hands[partner],
                key=lambda c: (point_value(c), rank_value(c), c.suit == trump),
                reverse=True,
            )
            pool = candidates[: max(1, len(candidates) // 3)]
            calls.append(self.rng.choice(pool).id)
        self.set_contract(player, trump, calls)

    def _known_teammate(self, player: int, other: int) -> bool:
        if self.bidder is None:
            return False
        # Bidder knows only partners already revealed. A called-card holder knows the bidder.
        if player == self.bidder:
            return other in self.revealed_partner_players
        if player in self.partner_players:
            return other == self.bidder or other in self.revealed_partner_players
        # Defenders can safely treat explicitly revealed defenders as teammates.
        if player not in self.bid_team() and other not in self.bid_team():
            return bool(self.revealed_partner_players) or self.tricks_played > 3
        return False

    def _card_power(self, card: Card) -> int:
        return rank_value(card) + (100 if card.suit == self.trump else 0)

    def bot_card(self, player: int) -> Card:
        legal = self.legal_cards(player)
        if not self.current_trick:
            # Lead from long suits; preserve KaliTiri/point cards unless the card is likely to win.
            counts = {s: sum(1 for c in self.hands[player] if c.suit == s) for s in SUITS}
            lead_suit = max(counts, key=counts.get)
            candidates = [c for c in legal if c.suit == lead_suit] or legal
            non_kali = [c for c in candidates if not (c.suit == "S" and c.rank == "3")]
            candidates = non_kali or candidates
            candidates.sort(key=lambda c: (rank_value(c), -point_value(c)), reverse=True)
            # Sometimes probe with a middle card rather than always burning the highest.
            idx = min(len(candidates) - 1, self.rng.choice([0, 0, 1, 2]))
            return candidates[idx]

        current_winner = self.winner_of(self.current_trick)
        trick_points = sum(point_value(x["card"]) for x in self.current_trick)
        winning: List[Card] = []
        losing: List[Card] = []
        for c in legal:
            test = self.current_trick + [{"player": player, "card": c}]
            (winning if self.winner_of(test) == player else losing).append(c)

        if self._known_teammate(player, current_winner):
            # Feed valuable cards to a known teammate, but avoid stealing the trick.
            if losing:
                return max(losing, key=lambda c: (point_value(c), -self._card_power(c)))
            return min(winning, key=lambda c: (self._card_power(c), point_value(c)))

        # Try to win valuable tricks using the cheapest winning card.
        if winning and (trick_points >= 10 or any(point_value(c) >= 10 for c in legal) or self.rng.random() < 0.52):
            return min(winning, key=lambda c: (self._card_power(c), point_value(c)))

        if losing:
            # Dump the cheapest low-value loser. Avoid donating 3♠ unless forced.
            safe = [c for c in losing if not (c.suit == "S" and c.rank == "3")]
            pool = safe or losing
            return min(pool, key=lambda c: (point_value(c), self._card_power(c)))
        return min(winning, key=lambda c: (self._card_power(c), point_value(c)))

    def advance_bots(self, bot_seats: Set[int], limit: int = 800):
        steps = 0
        while steps < limit:
            steps += 1
            actor = self.next_actor()
            if actor is None or actor not in bot_seats:
                return
            if self.phase == "auction":
                decision = self.bot_bid_decision(actor)
                self.auction_action(actor, decision, pass_turn=decision is None)
            elif self.phase == "contract":
                self.bot_set_contract(actor)
            elif self.phase == "play":
                self.play_card(actor, self.bot_card(actor).id)
            else:
                return
        raise RuntimeError("Bot loop safety limit reached")

    # ------------------------------- serialization ------------------------------
    def _card_from_id(self, card_id: int) -> Card:
        for c in make_deck(self.config):
            if c.id == card_id:
                return c
        raise ValueError(f"Unknown card id {card_id}")

    def to_dict(self) -> dict:
        def ids(cards: Iterable[Card]) -> List[int]:
            return [c.id for c in cards]
        return {
            "mode_key": self.mode_key,
            "names": self.names,
            "round": self.round,
            "dealer": self.dealer,
            "phase": self.phase,
            "high_bid": self.high_bid,
            "high_bidder": self.high_bidder,
            "passed": self.passed,
            "auction_turn": self.auction_turn,
            "bidder": self.bidder,
            "bid": self.bid,
            "trump": self.trump,
            "called_cards": ids(self.called_cards),
            "partner_players": self.partner_players,
            "revealed_partner_players": list(self.revealed_partner_players),
            "revealed_called_ids": list(self.revealed_called_ids),
            "turn": self.turn,
            "hands": [ids(h) for h in self.hands],
            "current_trick": [{"player": x["player"], "card": x["card"].id} for x in self.current_trick],
            "captured": [ids(c) for c in self.captured],
            "tricks_won": self.tricks_won,
            "tricks_played": self.tricks_played,
            "played_cards": ids(self.played_cards),
            "void_suits": [sorted(v) for v in self.void_suits],
            "round_result": self.round_result,
            "events": self.events,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "GameEngine":
        obj = cls(data["mode_key"], names=data.get("names"))
        obj.round = data["round"]
        obj.dealer = data["dealer"]
        obj.phase = data["phase"]
        obj.high_bid = data["high_bid"]
        obj.high_bidder = data.get("high_bidder")
        obj.passed = list(data["passed"])
        obj.auction_turn = data["auction_turn"]
        obj.bidder = data.get("bidder")
        obj.bid = data.get("bid")
        obj.trump = data.get("trump")
        obj.called_cards = [obj._card_from_id(cid) for cid in data.get("called_cards", [])]
        obj.partner_players = list(data.get("partner_players", []))
        obj.revealed_partner_players = set(data.get("revealed_partner_players", []))
        obj.revealed_called_ids = set(data.get("revealed_called_ids", []))
        obj.turn = data.get("turn")
        obj.hands = [[obj._card_from_id(cid) for cid in row] for row in data["hands"]]
        obj.current_trick = [{"player": x["player"], "card": obj._card_from_id(x["card"])} for x in data.get("current_trick", [])]
        obj.captured = [[obj._card_from_id(cid) for cid in row] for row in data.get("captured", [])]
        obj.tricks_won = list(data.get("tricks_won", [0] * obj.players))
        obj.tricks_played = int(data.get("tricks_played", 0))
        obj.played_cards = [obj._card_from_id(cid) for cid in data.get("played_cards", [])]
        obj.void_suits = [set(v) for v in data.get("void_suits", [[] for _ in range(obj.players)])]
        obj.round_result = data.get("round_result")
        obj.events = list(data.get("events", []))
        return obj

    def public_state(self, viewer: Optional[int]) -> dict:
        legal_ids: List[int] = []
        if viewer is not None and self.phase == "play" and self.turn == viewer:
            legal_ids = [c.id for c in self.legal_cards(viewer)]
        options = []
        if viewer is not None and self.phase == "contract" and self.bidder == viewer:
            options = [c.public() for c in self.available_called_cards(viewer)]
        partner_slots = []
        for idx, card in enumerate(self.called_cards):
            holder = self.partner_players[idx] if idx < len(self.partner_players) else None
            revealed = holder in self.revealed_partner_players or self.phase == "result"
            partner_slots.append({
                "card": card.public(),
                "revealed": revealed,
                "player": holder if revealed else None,
                "name": self.names[holder] if revealed and holder is not None else "Hidden partner",
            })
        return {
            "phase": self.phase,
            "mode_key": self.mode_key,
            "config": self.config,
            "round": self.round,
            "dealer": self.dealer,
            "high_bid": self.high_bid,
            "high_bidder": self.high_bidder,
            "next_bid": self.next_legal_bid() if self.phase == "auction" else None,
            "auction_turn": self.auction_turn,
            "passed": self.passed,
            "bidder": self.bidder,
            "bid": self.bid,
            "trump": self.trump,
            "called_cards": [c.public() for c in self.called_cards],
            "partner_slots": partner_slots,
            "turn": self.turn,
            "viewer": viewer,
            "viewer_hand": [c.public() for c in self.hands[viewer]] if viewer is not None else [],
            "hand_counts": [len(h) for h in self.hands],
            "legal_ids": legal_ids,
            "current_trick": [{"player": x["player"], "card": x["card"].public()} for x in self.current_trick],
            "team_points": self.team_points(),
            "events": self.events[-18:],
            "called_options": options,
            "round_result": self.round_result,
            "names": self.names,
            "tricks_played": self.tricks_played,
            "tricks_won": self.tricks_won,
        }
