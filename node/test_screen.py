import itertools
import unittest

import screen
from screen import Face, Frame, Screen

FINE = {"throttled": "0x0", "temp": 45.0}


class FixedRng:
    """Glances wherever the test says."""
    def __init__(self, gaze=0):
        self.gaze = gaze

    def choice(self, options):
        return self.gaze


class FakeDraw:
    def __init__(self):
        self.boxes, self.texts = [], []

    def rectangle(self, box, fill=None):
        self.boxes.append(box)

    def text(self, at, text, fill=None):
        self.texts.append((at, text))


class DamageTest(unittest.TestCase):
    def test_clean_flags_are_no_damage(self):
        self.assertEqual(screen.damage_level(FINE), 0)
        self.assertEqual(screen.damage_level({}), 0)

    def test_undervoltage_now_while_throttled_is_three(self):
        self.assertEqual(screen.damage_level({"throttled": "0x50005", "temp": 47.0}), 3)

    def test_a_past_dip_alone_is_one(self):
        self.assertEqual(screen.damage_level({"throttled": "0x50000"}), 1)

    def test_heat_adds_one(self):
        self.assertEqual(screen.damage_level({"throttled": "0x50005", "temp": 71.0}), 4)

    def test_unreadable_flags_are_no_damage(self):
        self.assertEqual(screen.damage_level({"throttled": "garbage"}), 0)


class FaceTest(unittest.TestCase):
    def setUp(self):
        self.rng = FixedRng()
        self.face = Face(self.rng)

    def test_offline_is_dead_at_zero_health(self):
        frame = self.face.frame(0, FINE, online=False)
        self.assertEqual(frame.mood, "dead")
        self.assertEqual(screen.health(frame), 0)

    def test_idle_glances_where_the_dice_say_every_half_second(self):
        self.rng.gaze = -1
        self.assertEqual(self.face.frame(0, FINE, True), Frame("idle", -1, False, 0))
        self.rng.gaze = 1
        self.assertEqual(self.face.frame(0.4, FINE, True).gaze, -1)
        self.assertEqual(self.face.frame(0.5, FINE, True).gaze, 1)

    def test_winces_when_something_comes_close_then_recovers(self):
        self.assertEqual(self.face.frame(0, {**FINE, "distance_cm": 80}, True).mood, "idle")
        self.assertEqual(self.face.frame(1, {**FINE, "distance_cm": 12}, True).mood, "ouch")
        self.assertEqual(self.face.frame(1 + screen.OUCH_S, {**FINE, "distance_cm": 12}, True).mood, "idle")

    def test_something_that_stays_close_is_one_wince(self):
        near = {**FINE, "distance_cm": 12}
        self.face.frame(0, near, True)
        for t in (5, 10, 15):
            self.assertEqual(self.face.frame(t, near, True).mood, "idle")

    def test_wavering_at_the_line_is_one_wince(self):
        self.face.frame(0, {**FINE, "distance_cm": 29}, True)
        self.face.frame(5, {**FINE, "distance_cm": 31}, True)
        self.assertEqual(self.face.frame(6, {**FINE, "distance_cm": 29}, True).mood, "idle")

    def test_no_echo_then_close_winces_again(self):
        self.face.frame(0, {**FINE, "distance_cm": 12}, True)
        self.face.frame(5, FINE, True)
        self.assertEqual(self.face.frame(6, {**FINE, "distance_cm": 12}, True).mood, "ouch")

    def test_a_gesture_gets_a_grin(self):
        self.face.on_gesture("wave", 10)
        self.assertEqual(self.face.frame(11, FINE, True).mood, "grin")
        self.assertEqual(self.face.frame(10 + screen.GRIN_S, FINE, True).mood, "idle")

    def test_look_left_is_the_viewers_right(self):
        self.face.on_gesture("look_left", 10)
        self.assertEqual(self.face.frame(11, FINE, True), Frame("idle", 1, False, 0))
        self.face.on_gesture("look_right", 12)
        self.assertEqual(self.face.frame(13, FINE, True).gaze, -1)
        self.assertEqual(self.face.frame(12 + screen.LOOK_S, FINE, True).gaze, 0)

    def test_talks_for_as_long_as_the_line_takes(self):
        self.face.on_say("x" * 100, 10)
        frames = [self.face.frame(10 + i / 8, FINE, True) for i in range(8)]
        self.assertEqual({f.mood for f in frames}, {"talk"})
        self.assertEqual({f.open for f in frames}, {True, False})
        self.assertEqual(self.face.frame(10 + 100 * screen.TALK_S_PER_CHAR, FINE, True).mood, "idle")

    def test_a_short_line_still_moves_the_mouth_for_a_second(self):
        self.face.on_say("Hi.", 10)
        self.assertEqual(self.face.frame(10.9, FINE, True).mood, "talk")


class SpriteTest(unittest.TestCase):
    def test_every_frame_fits_the_grid(self):
        self.assertEqual({len(row) for row in screen.HEAD}, {screen.W})
        self.assertEqual(len(screen.HEAD), screen.H)
        for mood, gaze, is_open, damage in itertools.product(
                ("idle", "talk", "grin", "ouch", "dead"), (-1, 0, 1), (False, True), range(screen.MAX_DAMAGE + 1)):
            rows = screen.sprite(Frame(mood, gaze, is_open, damage))
            self.assertEqual((len(rows), {len(r) for r in rows}), (screen.H, {screen.W}))

    def test_only_cuts_into_the_head_never_lights_outside_it(self):
        rows = screen.sprite(Frame("dead", 0, False, screen.MAX_DAMAGE))
        for row, head in zip(rows, screen.HEAD):
            for lit, base in zip(row, head):
                self.assertFalse(lit == "#" and base == " ")

    def test_pupils_follow_the_gaze(self):
        def pupil_columns(gaze):
            row = screen.sprite(Frame("idle", gaze, False, 0))[11]
            return [x for x in range(4, 20) if row[x] == " "]
        self.assertEqual(pupil_columns(-1), [4, 5, 14, 15])
        self.assertEqual(pupil_columns(0), [6, 7, 16, 17])
        self.assertEqual(pupil_columns(1), [8, 9, 18, 19])

    def test_each_level_of_damage_darkens_more(self):
        lit = [sum(row.count("#") for row in screen.sprite(Frame("idle", 0, False, d)))
               for d in range(screen.MAX_DAMAGE + 1)]
        self.assertEqual(lit, sorted(lit, reverse=True))
        self.assertEqual(len(set(lit)), len(lit))


class ScreenTest(unittest.TestCase):
    def setUp(self):
        self.screen = Screen("mech", FixedRng())
        self.screen.online = True
        self.screen.sense = {**FINE, "distance_cm": 82.4}

    def test_idle_is_the_status_bar(self):
        self.assertEqual(self.screen.scene(0), ("hud", Frame("idle", 0, False, 0), 82, 100))

    def test_no_echo_shows_no_distance(self):
        self.screen.sense = FINE
        self.assertIsNone(self.screen.scene(0)[2])

    def test_gesture_and_line_within_the_window_are_one_reply(self):
        self.screen.reply(10, gesture="wave")
        self.screen.reply(10.3, say="Hello there!")
        layout, frame, gesture, lines = self.screen.scene(10.4)
        self.assertEqual((layout, gesture, lines), ("reply", "wave", ("Hello there!",)))
        self.assertEqual(frame.mood, "talk")

    def test_a_later_line_is_a_new_reply_without_the_old_gesture(self):
        self.screen.reply(10, gesture="wave")
        self.screen.reply(20, say="Got it.")
        self.assertEqual(self.screen.scene(20.1)[2:], (None, ("Got it.",)))

    def test_the_status_bar_returns_after_the_reply(self):
        self.screen.reply(10, say="Got it.")
        self.assertEqual(self.screen.scene(10 + screen.REPLY_HOLD_S - 0.1)[0], "reply")
        self.assertEqual(self.screen.scene(10 + screen.REPLY_HOLD_S)[0], "hud")

    def test_a_long_line_turns_its_pages_and_every_page_is_shown(self):
        line = "I can move, see, hear, and speak. I can wave, nod, shrug, point, look left or right, and rest."
        self.screen.reply(10, say=line)
        pages = self.screen.pages()
        self.assertGreater(len(pages), 2)
        self.assertTrue(all(len(p) <= Screen.ROWS and all(len(l) <= Screen.COLS for l in p) for p in pages))
        self.assertEqual(" ".join(" ".join(p) for p in pages), line)
        for i, page in enumerate(pages):
            self.assertEqual(self.screen.scene(10 + i * screen.PAGE_S + 0.1)[3], tuple(page))
        self.assertEqual(self.screen.scene(10 + len(pages) * screen.PAGE_S)[0], "hud")

    def test_the_scene_is_equal_while_nothing_changes(self):
        self.assertEqual(self.screen.scene(0.1), self.screen.scene(0.2))

    def test_everything_painted_is_on_the_glass(self):
        self.screen.reply(10, gesture="look_right", say="Careful, that's quite close.")
        for now in (0, 10.5):
            d = FakeDraw()
            self.screen.paint(d, self.screen.scene(now))
            self.assertTrue(d.boxes and d.texts)
            for x0, y0, x1, y1 in d.boxes:
                self.assertTrue(0 <= x0 <= x1 < 128 and 0 <= y0 <= y1 < 64)
            for (x, y), _ in d.texts:
                self.assertTrue(0 <= x < 128 and 0 <= y < 64)


if __name__ == "__main__":
    unittest.main()
