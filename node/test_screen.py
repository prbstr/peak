import unittest

import screen
from screen import Screen

FINE = {"throttled": "0x0", "temp": 45.0}
WORN = {"throttled": "0x50005", "temp": 47.0}


class FixedRng:
    def uniform(self, lo, hi):
        return (lo + hi) / 2


def make(online=True, sense=FINE, **cfg):
    s = Screen(cfg, FixedRng())
    s.online = online
    s.on_sense(0, sense)
    s.settle(0)
    return s


class DamageTest(unittest.TestCase):
    def test_clean_flags_are_no_damage(self):
        self.assertEqual(screen.damage_level(FINE), 0)
        self.assertEqual(screen.damage_level({}), 0)

    def test_undervoltage_now_while_throttled_is_three(self):
        self.assertEqual(screen.damage_level(WORN), 3)

    def test_a_past_dip_alone_is_one(self):
        self.assertEqual(screen.damage_level({"throttled": "0x50000"}), 1)

    def test_heat_adds_one(self):
        self.assertEqual(screen.damage_level({"throttled": "0x50005", "temp": 71.0}), 4)

    def test_unreadable_flags_are_no_damage(self):
        self.assertEqual(screen.damage_level({"throttled": "garbage"}), 0)


class ReflexTest(unittest.TestCase):
    def test_offline_is_asleep(self):
        s = make(online=False, sense=WORN)
        self.assertEqual((s.eyes.left.h, s.eyes.right.h), (1, 1))
        self.assertFalse(s.eyes.autoblinker or s.eyes.idle or s.eyes.sweat)
        self.assertIsNone(s.next_event(0))
        self.assertFalse(s.animating(0))

    def test_waking_opens_the_eyes_and_starts_them_wandering(self):
        s = make(online=False)
        s.online = True
        s.settle(1)
        self.assertEqual(s.eyes.left.h, 36)
        self.assertTrue(s.eyes.autoblinker and s.eyes.idle)
        self.assertIsNotNone(s.next_event(1))

    def test_going_offline_shuts_them_again(self):
        s = make()
        s.online = False
        s.settle(1)
        self.assertEqual(s.eyes.left.h, 1)

    def test_startled_when_something_comes_close_then_back_to_size(self):
        s = make(sense={**FINE, "distance_cm": 80})
        self.assertTrue(s.on_sense(1, {**FINE, "distance_cm": 12}))
        s.settle(1.1)
        self.assertEqual((s.eyes.left.w, s.eyes.left.h), (40, 48))
        self.assertEqual(s.eyes.left.x, (128 - 40 - 10 - 40) / 2)
        self.assertFalse(s.eyes.idle)
        s.on_sense(1.5, {**FINE, "distance_cm": 12})
        s.settle(1 + screen.STARTLED_S)
        self.assertEqual((s.eyes.left.w, s.eyes.left.h), (36, 36))
        self.assertTrue(s.eyes.idle)

    def test_something_that_stays_close_is_one_startle(self):
        s = make(sense={**FINE, "distance_cm": 12})
        for t in (5, 10, 15):
            self.assertFalse(s.on_sense(t, {**FINE, "distance_cm": 12}))
            self.assertEqual(s.pose(t).shape, s.shape)

    def test_wavering_at_the_line_is_one_startle(self):
        s = make(sense={**FINE, "distance_cm": 29})
        s.on_sense(5, {**FINE, "distance_cm": 31})
        s.on_sense(6, {**FINE, "distance_cm": 29})
        self.assertEqual(s.pose(6).shape, s.shape)

    def test_no_echo_then_close_startles_again(self):
        s = make(sense={**FINE, "distance_cm": 12})
        s.on_sense(5, FINE)
        s.on_sense(6, {**FINE, "distance_cm": 12})
        self.assertNotEqual(s.pose(6).shape, s.shape)

    def test_curious_while_something_is_near(self):
        s = make(sense={**FINE, "distance_cm": 12})
        self.assertTrue(s.pose(5).curious)
        s.on_sense(6, {**FINE, "distance_cm": 90})
        self.assertFalse(s.pose(6).curious)

    def test_look_left_is_the_viewers_right_and_wears_off(self):
        s = make()
        s.on_gesture(10, "look_left")
        s.settle(10)
        self.assertEqual(s.eyes.left.x, s.eyes.constraint_x())
        self.assertFalse(s.eyes.idle)
        s.on_gesture(11, "look_right")
        s.settle(11)
        self.assertEqual(s.eyes.left.x, 0)
        self.assertEqual(s.next_event(11), 11 + screen.LOOK_S)
        s.settle(11 + screen.LOOK_S)
        self.assertTrue(s.eyes.idle)

    def test_other_gestures_leave_the_eyes_alone(self):
        s = make()
        before = s.pose(10)
        s.on_gesture(10, "wave")
        self.assertEqual(s.pose(10), before)

    def test_talking_pulses_for_as_long_as_the_line_takes(self):
        s = make()
        s.on_say(10, "x" * 100)
        squeezes = {s.pose(10 + i / 20).squeeze for i in range(20)}
        self.assertEqual(squeezes, {0, screen.TALK_PX})
        self.assertEqual(s.pose(10.5).look, "center")
        self.assertTrue(s.animating(10.5))
        self.assertEqual(s.pose(10 + 100 * screen.TALK_S_PER_CHAR).squeeze, 0)

    def test_talking_waits_for_the_voice(self):
        s = make(talk_delay_s=2.5)
        s.on_say(10, "Hi.")
        self.assertEqual(s.pose(11).look, None)
        self.assertLessEqual(s.next_event(11), 12.5)
        self.assertEqual(s.pose(12.6).look, "center")
        self.assertEqual(s.pose(13.6).look, None)

    def test_talking_keeps_a_look(self):
        s = make()
        s.on_gesture(10, "look_left")
        s.on_say(10.2, "Over there.")
        self.assertEqual(s.pose(10.5).look, "e")

    def test_strain_is_tired_eyes_and_sweat(self):
        for sense, mood, drops in ((FINE, "default", 0), ({"throttled": "0x50000"}, "default", 0),
                                   ({"throttled": "0x50001"}, "tired", 1), (WORN, "tired", 2),
                                   ({**WORN, "temp": 75.0}, "tired", 3)):
            pose = make(sense=sense).pose(1)
            self.assertEqual((pose.mood, pose.sweat), (mood, drops), sense)

    def test_strain_can_be_switched_off(self):
        pose = make(sense=WORN, strain=False).pose(1)
        self.assertEqual((pose.mood, pose.sweat), ("default", 0))

    def test_startled_beats_a_look_and_asleep_beats_everything(self):
        s = make(sense={**FINE, "distance_cm": 80})
        s.on_gesture(1, "look_left")
        s.on_sense(1.1, {**FINE, "distance_cm": 12})
        self.assertEqual(s.pose(1.2).look, "center")
        s.online = False
        self.assertFalse(s.pose(1.3).open)

    def test_a_reading_that_changes_nothing_says_so(self):
        s = make(sense={**FINE, "distance_cm": 80})
        self.assertFalse(s.on_sense(1, {**FINE, "distance_cm": 78.2}))
        self.assertTrue(s.on_sense(2, {**WORN, "distance_cm": 78.2}))

    def test_eye_size_comes_from_the_config(self):
        s = make(eye_width=30, eye_height=44, eye_radius=10, eye_space=14)
        self.assertEqual((s.eyes.left.w, s.eyes.left.h, s.eyes.left.r, s.eyes.space), (30, 44, 10, 14))
        self.assertEqual(s.eyes.right.x - s.eyes.left.x, 44)


if __name__ == "__main__":
    unittest.main()
