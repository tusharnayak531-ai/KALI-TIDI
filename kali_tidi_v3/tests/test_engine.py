import unittest

from engine import GameEngine, MODE_CONFIGS, make_deck, point_value, Card


class EngineTests(unittest.TestCase):
    def test_mode_deck_sizes_and_points(self):
        for key in ("4", "6", "8"):
            cfg = MODE_CONFIGS[key]
            deck = make_deck(cfg)
            self.assertEqual(len(deck), cfg["total_cards"])
            self.assertEqual(sum(point_value(c) for c in deck), cfg["total_points"])

    def test_duplicate_later_card_wins(self):
        g = GameEngine("8", seed=1)
        g.trump = "H"
        a1 = Card(1000, "S", "A", 1)
        a2 = Card(1001, "S", "A", 2)
        trick = [{"player": 0, "card": a1}, {"player": 1, "card": a2}]
        self.assertEqual(g.winner_of(trick), 1)

    def test_follow_suit(self):
        g = GameEngine("4", seed=2)
        g.phase = "play"
        g.trump = "H"
        g.turn = 0
        lead = next(c for c in g.hands[1] if c.suit == "S")
        g.current_trick = [{"player": 1, "card": lead}]
        if any(c.suit == "S" for c in g.hands[0]):
            self.assertTrue(all(c.suit == "S" for c in g.legal_cards(0)))

    def test_all_bot_rounds_finish(self):
        for key in ("4", "6", "8"):
            g = GameEngine(key, seed=10 + int(key))
            bots = set(range(g.players))
            g.advance_bots(bots, limit=2000)
            self.assertEqual(g.phase, "result")
            t = g.team_points()
            self.assertEqual(t["bid"] + t["def"], g.config["total_points"])
            self.assertEqual(g.tricks_played, g.config["tricks"])

    def test_serialization_roundtrip(self):
        g = GameEngine("6", seed=9)
        g.advance_bots(set(range(g.players)), limit=2000)
        raw = g.to_dict()
        restored = GameEngine.from_dict(raw)
        self.assertEqual(restored.mode_key, g.mode_key)
        self.assertEqual(restored.phase, g.phase)
        self.assertEqual(restored.team_points(), g.team_points())
        self.assertEqual(restored.round_result, g.round_result)


if __name__ == "__main__":
    unittest.main()
