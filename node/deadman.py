"""peak node: the dead-man switch. When nobody can stop the body any more, it stops moving and holds.

Two things can leave a move running with no one able to stop it: the mind dies (its retained
peak/mind/mind/status turns "offline" by the broker's Last Will, the moment its socket closes), or the body loses
the broker itself (Wi-Fi, the Mac). Either one cancels the move in progress and the one waiting, and the servos
HOLD where they are: on the mech under gravity a limp arm drops (docs/decisions.md, Stage B). The eyes shut, as
they do when the broker is gone. Nothing is replayed when the mind comes back; the next command simply runs.

There is no silence timer: the mind sends one-shot commands, and one legal move lasts up to 5 s on its own.

Import-safe like cmdcheck.py: no GPIO, no MQTT, so the unit tests run on the Mac's Python 3.9.
"""

MIND_STATUS_TOPIC = "peak/mind/mind/status"


class DeadMan:
    """Tracks the broker link and the mind's status. Each on_* call returns the reason the body must hold now (once,
    on the change from alive to dead), or None."""

    def __init__(self):
        self.broker = False   # the body's own link to the broker
        self.mind = None      # the mind's last status payload; None until one arrives (unknown counts as alive)

    @property
    def alive(self):
        """True while someone can still stop the body: the broker is reachable and the mind is not known dead."""
        return self.broker and self.mind != "offline"

    def _change(self, was, why):
        return why if was and not self.alive else None

    def on_broker(self, up):
        was = self.alive
        self.broker = bool(up)
        return self._change(was, "broker link lost")

    def on_mind_status(self, payload):
        was = self.alive
        text = payload.decode("utf-8", "replace") if isinstance(payload, (bytes, bytearray)) else str(payload)
        self.mind = text.strip() or None  # an empty retained message clears the status: unknown again
        return self._change(was, "mind offline")
