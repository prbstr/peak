import unittest

from deadman import DeadMan, MIND_STATUS_TOPIC


def connected(mind=None):
    d = DeadMan()
    d.on_broker(True)
    if mind is not None:
        d.on_mind_status(mind)
    return d


class Triggers(unittest.TestCase):
    def test_the_mind_going_offline_holds_once(self):
        d = connected(b"online")
        self.assertEqual(d.on_mind_status(b"offline"), "mind offline")
        self.assertFalse(d.alive)
        self.assertIsNone(d.on_mind_status(b"offline"), "a repeated offline is not a second hold")

    def test_losing_the_broker_holds(self):
        d = connected(b"online")
        self.assertEqual(d.on_broker(False), "broker link lost")
        self.assertFalse(d.alive)

    def test_losing_the_broker_while_the_mind_is_down_is_not_a_second_hold(self):
        d = connected(b"offline")
        self.assertIsNone(d.on_broker(False))


class NoFalseHolds(unittest.TestCase):
    def test_an_unknown_mind_counts_as_alive(self):
        # no retained status yet (a fresh broker, a mind never started): the owner's hand commands must still run
        self.assertTrue(connected().alive)

    def test_online_and_reconnects_never_hold(self):
        d = connected(b"online")
        self.assertIsNone(d.on_mind_status(b"online"))
        self.assertIsNone(d.on_broker(True))

    def test_a_cleared_status_is_unknown_again(self):
        d = connected(b"offline")
        self.assertIsNone(d.on_mind_status(b""))
        self.assertTrue(d.alive)

    def test_before_the_first_connect_nothing_holds(self):
        d = DeadMan()
        self.assertFalse(d.alive)
        self.assertIsNone(d.on_mind_status(b"offline"))
        self.assertIsNone(d.on_broker(False))


class Recovery(unittest.TestCase):
    def test_the_mind_back_online_makes_the_body_alive(self):
        d = connected(b"offline")
        self.assertIsNone(d.on_mind_status("online"))
        self.assertTrue(d.alive)

    def test_a_reconnect_after_a_drop_is_alive(self):
        d = connected(b"online")
        d.on_broker(False)
        d.on_broker(True)
        self.assertTrue(d.alive)


class Topic(unittest.TestCase):
    def test_the_topic_is_the_minds_own_status(self):
        # mind/senses/lib.js connect('mind') owns it; broker/peak.acl lets mech read peak/mind/+/status
        self.assertEqual(MIND_STATUS_TOPIC, "peak/mind/mind/status")


if __name__ == "__main__":
    unittest.main()
