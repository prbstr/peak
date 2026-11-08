import json
import math
import unittest
from pathlib import Path

import yaml

import cmdcheck
from cmdcheck import validate_cmd

HERE = Path(__file__).parent
SERVOS = yaml.safe_load((HERE / "config.yaml").read_text())["servos"]
GESTURES = yaml.safe_load((HERE / "gestures.yaml").read_text())


def check(cmd):
    return validate_cmd(cmd, SERVOS, GESTURES)


class Good(unittest.TestCase):
    def test_what_the_mind_sends_passes(self):
        for cmd in ({"gesture": "wave"}, {"gesture": "rest"}, {"say": "Hello."}, {"stop": True},
                    {"servo": "head", "deg": 120, "ms": 400}, {"servo": "head", "deg": 90.5},
                    {"servo": "waist", "deg": -10, "ms": 20}, {"servo": "waist", "deg": 500, "ms": 5000},
                    {"eyes": {"mood": "happy", "ms": 3000}}, {"eyes": {"release": True}}):
            self.assertIsNone(check(cmd), cmd)

    def test_every_shipped_gesture_and_servo_is_known(self):
        for g in GESTURES:
            self.assertIsNone(check({"gesture": g}))
        for s in SERVOS:
            self.assertIsNone(check({"servo": s, "deg": 90}))

    def test_a_stop_is_never_refused(self):
        self.assertIsNone(check({"stop": True, "junk": [1, 2]}))
        self.assertIsNone(check({"stop": 1, "servo": "nope"}), "a stop wins over a bad move in the same message")

    def test_unused_fields_are_ignored(self):
        self.assertIsNone(check({"gesture": "nod", "note": "from a test"}))


class Bad(unittest.TestCase):
    def assertRefused(self, cmd, why):
        problem = check(cmd)
        self.assertIsNotNone(problem, cmd)
        self.assertIn(why, problem)

    def test_the_review_case_an_unknown_servo(self):
        self.assertRefused({"servo": "nope", "deg": 1}, "unknown servo")
        self.assertRefused({"servo": 3, "deg": 1}, "unknown servo")

    def test_deg_missing_or_not_a_finite_number(self):
        self.assertRefused({"servo": "head"}, "without deg")
        for deg in ("90", None, True, [90], math.nan, math.inf, -math.inf):
            self.assertRefused({"servo": "head", "deg": deg}, "deg must be")

    def test_ms_bounds(self):
        for ms in (19, 0, -5, 5001, 10 ** 9, 300.5, "300", True, None):
            self.assertRefused({"servo": "head", "deg": 90, "ms": ms}, "ms must be")

    def test_gestures(self):
        self.assertRefused({"gesture": "backflip"}, "unknown gesture")
        self.assertRefused({"gesture": ["wave"]}, "gesture must be a string")
        self.assertRefused({"gesture": None}, "gesture must be a string")

    def test_say_and_eyes(self):
        self.assertRefused({"say": 42}, "say must be a string")
        self.assertRefused({"say": None}, "say must be a string")
        self.assertRefused({"eyes": "happy"}, "eyes must be an object")

    def test_not_a_command(self):
        for cmd in (None, [], "wave", 7, {}, {"stop": False}, {"dance": "now"}):
            self.assertIsNotNone(check(cmd), cmd)

    def test_it_never_raises(self):
        # whatever arrives off the broker, the check answers instead of throwing
        for cmd in (None, 1.5, {"servo": {}}, {"servo": "head", "deg": {}}, {"gesture": {}}, {"eyes": None},
                    {"servo": "head", "deg": 1e308, "ms": 2 ** 64}):
            check(cmd)


class Contract(unittest.TestCase):
    def test_the_limits_are_the_contracts(self):
        contract = HERE.parent / "contracts" / "cmd.schema.json"
        if not contract.exists():
            self.skipTest("contracts/ is not deployed to the Pi")
        shapes = json.loads(contract.read_text())["oneOf"]
        servo = next(s for s in shapes if "servo" in s["required"])
        ms = servo["properties"]["ms"]
        self.assertEqual((ms["type"], ms["minimum"], ms["maximum"]), ("integer", cmdcheck.MS_MIN, cmdcheck.MS_MAX))
        self.assertEqual(servo["properties"]["deg"]["type"], "number")
        self.assertEqual(servo["required"], ["servo", "deg"])
        say = next(s for s in shapes if "say" in s["required"])
        self.assertEqual(say["properties"]["say"]["type"], "string")
        # every command the contract names is one cmdcheck knows how to dispatch
        kinds = {s["required"][0] for s in shapes}
        self.assertEqual(kinds, {"gesture", "servo", "say", "stop", "eyes"})
        for k in kinds:
            self.assertEqual(cmdcheck.kind({k: True}), k)


if __name__ == "__main__":
    unittest.main()
