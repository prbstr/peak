import unittest

import eyes
from eyes import RoboEyes


class FixedRng:
    """uniform() lands this fraction of the way along the range."""
    def __init__(self, at=0.5):
        self.at = at

    def uniform(self, lo, hi):
        return lo + self.at * (hi - lo)


class FakeDraw:
    def __init__(self):
        self.rects, self.polygons = [], []

    def rounded_rectangle(self, box, radius=0, fill=None):
        self.rects.append((box, fill))

    def polygon(self, points, fill=None):
        self.polygons.append((points, fill))

    def lit(self):
        return [box for box, fill in self.rects if fill == "white"]


def run(e, start, seconds, dt):
    """Advance in steps of dt; returns the left eye's height after every update."""
    heights, t = [], start
    while t < start + seconds:
        t += dt
        e.update(t)
        heights.append(e.left.h)
    return heights


def awake(rng=None):
    e = RoboEyes(rng=rng or FixedRng())
    e.settle(0)
    return e


class TweenTest(unittest.TestCase):
    def test_starts_shut_and_opens(self):
        e = RoboEyes(rng=FixedRng())
        self.assertEqual(e.left.h, 1)
        self.assertEqual(run(e, 0, 1, 0.02)[-1], 36)

    def test_the_same_motion_at_any_frame_rate(self):
        ends = []
        for dt in (0.02, 0.1):
            e = awake()
            e.set_position("e")
            run(e, 0, 0.1, dt)
            ends.append(e.left.x)
        self.assertGreater(ends[0], e.constraint_x() / 2 + 5)
        self.assertLess(ends[0], e.constraint_x() - 1)
        self.assertAlmostEqual(ends[0], ends[1], delta=1)

    def test_a_blink_always_shows_a_shut_frame_and_reopens(self):
        for dt in (0.02, 0.07, 0.25):
            e = awake()
            e.blink()
            heights = run(e, 0, 2, dt)
            self.assertEqual(min(heights), 1, dt)
            self.assertEqual(heights[-1], 36, dt)

    def test_close_stays_shut_until_open(self):
        e = awake()
        e.close()
        self.assertEqual(run(e, 0, 1, 0.05)[-1], 1)
        e.open()
        self.assertEqual(run(e, 1, 1, 0.05)[-1], 36)

    def test_one_eye_can_wink(self):
        e = awake()
        e.close(left=True, right=False)
        run(e, 0, 1, 0.05)
        self.assertEqual((e.left.h, e.right.h), (1, 36))

    def test_a_new_height_does_not_open_a_shut_eye(self):
        e = awake()
        e.close()
        e.set_height(48, 48)
        self.assertEqual(run(e, 0, 1, 0.05)[-1], 1)
        e.open()
        self.assertEqual(run(e, 1, 1, 0.05)[-1], 48)

    def test_at_rest_nothing_is_animating(self):
        e = awake()
        self.assertFalse(e.animating(0))
        e.set_position("nw")
        self.assertTrue(e.animating(0))
        e.settle(1)
        self.assertFalse(e.animating(1))


class GeometryTest(unittest.TestCase):
    def test_default_geometry_is_the_originals(self):
        e = awake()
        self.assertEqual((e.left.x, e.left.y, e.right.x, e.right.y), (23, 14, 69, 14))

    def test_positions_reach_the_edges(self):
        e = awake()
        for name, (x, y) in {"nw": (0, 0), "e": (46, 14), "se": (46, 28), "s": (23, 28)}.items():
            e.set_position(name)
            e.settle(0)
            self.assertEqual((e.left.x, e.left.y), (x, y), name)
            self.assertEqual(e.right.x, x + 36 + 10, name)

    def test_curiosity_grows_the_outer_eye(self):
        e = awake()
        e.set_curiosity(True)
        e.set_position("w")
        e.settle(0)
        self.assertEqual((e.left.h, e.right.h), (36 + eyes.CURIOUS_PX, 36))
        e.set_position("e")
        e.settle(0)
        self.assertEqual((e.left.h, e.right.h), (36, 36 + eyes.CURIOUS_PX))

    def test_cyclops_draws_one_eye_with_the_whole_screen_to_roam(self):
        e = awake()
        e.set_cyclops(True)
        e.settle(0)
        d = FakeDraw()
        e.draw(d)
        self.assertEqual(len(d.lit()), 1)
        self.assertEqual(e.constraint_x(), 128 - 36)

    def test_a_shut_eye_is_a_line_through_its_middle(self):
        e = awake()
        e.close()
        e.settle(0)
        d = FakeDraw()
        e.draw(d)
        (x0, y0, x1, y1), _ = d.lit()[0], None
        self.assertEqual((y0, y1), (32, 32))


class MoodTest(unittest.TestCase):
    def lids(self, mood):
        e = awake()
        e.set_mood(mood)
        e.settle(0)
        d = FakeDraw()
        e.draw(d)
        return e, d

    def test_tired_droops_at_the_outer_corners(self):
        e, d = self.lids("tired")
        self.assertEqual(e.lid_tired, 18)
        (left, _), (right, _) = d.polygons
        self.assertEqual(left[2], (23, 14 + 18 - 1))
        self.assertEqual(right[2], (69 + 36, 14 + 18 - 1))

    def test_angry_slants_in_to_the_inner_corners(self):
        e, d = self.lids("angry")
        (left, _), (right, _) = d.polygons
        self.assertEqual(left[2][0], 23 + 36)
        self.assertEqual(right[2][0], 69)

    def test_happy_cuts_into_the_bottom(self):
        e, d = self.lids("happy")
        self.assertEqual(d.polygons, [])
        cuts = [box for box, fill in d.rects if fill == "black"]
        self.assertEqual(len(cuts), 2)
        self.assertEqual(cuts[0][1], 14 + 36 - 18 + 1)

    def test_default_has_no_lids(self):
        e, d = self.lids("default")
        self.assertEqual((d.polygons, len(d.rects)), ([], 2))

    def test_moods_ease_in(self):
        e = awake()
        e.set_mood("tired")
        e.update(0.04)
        self.assertTrue(0 < e.lid_tired < 18)


class MacroTest(unittest.TestCase):
    def test_autoblinker_blinks_and_says_when_next(self):
        e = awake(FixedRng(0.5))
        e.set_autoblinker(True, 3, 2)
        e.update(10)
        self.assertEqual(e.left.h_next, 1)
        self.assertEqual(e.next_event(10.5), 14)
        self.assertEqual(run(e, 10, 1, 0.05)[-1], 36)

    def test_idle_mode_glances_inside_the_screen(self):
        for at in (0, 0.99):
            e = awake(FixedRng(at))
            e.set_idle_mode(True, 2, 3)
            e.update(10)
            e.settle(10)
            self.assertTrue(0 <= e.left.x <= e.constraint_x() and 0 <= e.left.y <= e.constraint_y())
            self.assertTrue(e.right.x + e.right.w <= 128)

    def test_no_timers_no_next_event(self):
        self.assertIsNone(awake().next_event(0))

    def test_laughing_shakes_up_and_down_for_half_a_second(self):
        e = awake()
        e.anim_laugh(1)
        tops = set()
        for i in range(10):
            e.update(1 + i * 0.04)
            d = FakeDraw()
            e.draw(d)
            tops.add(d.lit()[0][1])
        self.assertEqual(len(tops), 2)
        self.assertTrue(e.animating(1.4))
        self.assertFalse(e.animating(1 + eyes.ANIM_S))

    def test_confusion_shakes_sideways(self):
        e = awake()
        e.anim_confused(1)
        lefts = set()
        for i in range(10):
            e.update(1 + i * 0.04)
            d = FakeDraw()
            e.draw(d)
            lefts.add(d.lit()[0][0])
        self.assertEqual(len(lefts), 2)
        self.assertGreater(max(lefts) - min(lefts), 20)

    def test_sweat_draws_as_many_drops_as_asked_and_keeps_coming(self):
        e = awake()
        e.set_sweat(2)
        seen = set()
        for i in range(200):
            e.update(i * 0.04)
            d = FakeDraw()
            e.draw(d)
            drops = len(d.lit()) - 2
            self.assertLessEqual(drops, 2)
            seen.add(drops)
        self.assertIn(2, seen)
        self.assertEqual([drop is not None for drop in e.drops], [True, True, False])
        self.assertTrue(e.animating(8))
        self.assertFalse(e.animating(8, sweat=False))
        self.assertGreater(min(drop[0] for drop in e.drops if drop), 1)  # not the first drops any more
        e.set_sweat(0)
        e.update(9)
        self.assertEqual(e.drops, [None, None, None])
        self.assertFalse(e.animating(9))


try:
    from PIL import Image, ImageDraw
except ImportError:
    Image = None


@unittest.skipUnless(Image, "needs Pillow")
class PictureTest(unittest.TestCase):
    def lit(self, mood="default", **kw):
        e = awake()
        e.set_mood(mood)
        if kw.get("shut"):
            e.close()
        e.settle(0)
        img = Image.new("1", (128, 64))
        e.draw(ImageDraw.Draw(img))
        return sum(1 for p in img.tobytes() for b in range(8) if p >> b & 1)

    def test_open_eyes_light_about_two_squares(self):
        self.assertTrue(2 * 36 * 36 * 0.9 < self.lit() <= 2 * 36 * 36)

    def test_every_mood_darkens_the_eyes(self):
        for mood in ("tired", "angry", "happy"):
            self.assertLess(self.lit(mood), self.lit() * 0.9, mood)

    def test_shut_eyes_are_two_lines(self):
        self.assertEqual(self.lit(shut=True), 2 * 36)


if __name__ == "__main__":
    unittest.main()
