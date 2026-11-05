"""peak node — what the OLED shows.

Two eyes (eyes.py, a port of FluxGarage RoboEyes) and the reflexes that move them. The reflexes need only
what the body itself knows, so the eyes stay alive when the mind is away: they wander and blink, follow a
look gesture, pulse while a line is spoken, go wide when something comes close, droop and sweat as the Pi's
power gets worse, and shut when the broker is gone. The mind can take them over for a while with an
`eyes` command (contracts/cmd.schema.json); when its time is up the reflexes have them back.

Pure Python: the only drawing calls are on the ImageDraw it is handed, so it runs in tests and on the Mac.
"""
import random
from collections import namedtuple

from eyes import MOODS, POSITIONS, RoboEyes

NEAR_CM = 30         # the same line the mind's presence filter draws for "close"
FAR_CM = 36          # and it must back off past this before it can come close again
STARTLED_S = 1.5
LOOK_S = 3
TALK_HZ = 3          # pulses a second
TALK_PX = 6
TALK_S_PER_CHAR = 0.07
TALK_MAX_S = 12
HOT_C = 70
BLINK_S = (3, 3)     # at least this long between blinks, plus up to this much more
IDLE_S = (2, 3)      # the same for glances
# Positions are in screen terms: "e" is the viewer's right, which is the body's left.
LOOKS = {"look_left": "e", "look_right": "w"}
EYES_MS = (100, 4000, 60000)  # an eyes command holds for this long: least, when it does not say, most
ANIMS = ("blink", "wink_left", "wink_right", "confused", "laugh")  # winks name the body's own left and right
SHAPE_LIMITS = (("width", 8, 60), ("height", 8, 64), ("radius", 0, 32), ("space", -20, 40))

Pose = namedtuple("Pose", "open mood look curious sweat shape squeeze")  # look None: wander

def damage_level(sense):
    """0 (fresh) to 4 (worn out) from the Pi's power flags and temperature, the nearest thing a body has to health."""
    try:
        flags = int(sense.get("throttled") or "0", 16)
    except ValueError:
        flags = 0
    hurts = (flags & 0x1,       # undervoltage right now
             flags & 0x6,       # CPU capped or throttled right now
             flags & 0x10000,   # undervoltage at some point since boot
             flags & 0x8 or sense.get("temp", 0) >= HOT_C)
    return sum(1 for h in hurts if h)

class Screen:
    """Picks a pose for the eyes from the body's state, highest claim first: asleep, startled, the mind's
    eyes command, a look gesture, talking, strain, and otherwise wandering. Time comes in as an argument, so
    tests move the clock."""
    def __init__(self, cfg=None, rng=random):
        cfg = cfg or {}
        self.eyes = RoboEyes(128, 64, rng)
        self.eyes.set_autoblinker(False, *BLINK_S)
        self.eyes.set_idle_mode(False, *IDLE_S)
        self.shape = tuple(cfg.get(k, v) for k, v in (
            ("eye_width", 36), ("eye_height", 36), ("eye_radius", 8), ("eye_space", 10)))
        self.strain = cfg.get("strain", True)
        self.talk_delay_s = cfg.get("talk_delay_s", 0)
        self.sense, self.online = {}, False
        self.near = False
        self.look = None
        self.startled = self.look_until = self.talk_from = self.talk_until = float("-inf")
        self.override, self.override_until = {}, float("-inf")
        self.posed = None

    # ---------- what happened ----------
    def on_gesture(self, now, name):
        if name in LOOKS:
            self.look, self.look_until = LOOKS[name], now + LOOK_S

    def on_say(self, now, text):
        self.talk_from = now + self.talk_delay_s
        self.talk_until = self.talk_from + min(TALK_MAX_S, max(1, len(text) * TALK_S_PER_CHAR))

    def on_sense(self, now, sense):
        """Takes a reading. True when it changes what the eyes should do."""
        before = (self.near, damage_level(self.sense))
        self.sense = sense
        # Startle at the approach, not for as long as the thing stays there: on a desk something always is.
        cm = sense.get("distance_cm")
        if cm is None or cm > FAR_CM:
            self.near = False
        elif cm < NEAR_CM and not self.near:
            self.near, self.startled = True, now + STARTLED_S
        return (self.near, damage_level(sense)) != before

    def on_eyes(self, now, cmd):
        """The mind's eyes command. Anything it does not understand is left out, never raised: a bad
        command must not stop the body."""
        if not isinstance(cmd, dict):
            return False
        if cmd.get("release") is True:
            return self.release(now)
        state = {k: cmd[k] for k, allowed in (("mood", MOODS), ("look", POSITIONS)) if cmd.get(k) in allowed}
        state.update({k: cmd[k] for k in ("open", "curious") if isinstance(cmd.get(k), bool)})
        if isinstance(cmd.get("shape"), dict):
            state["shape"] = self.fit(cmd["shape"])
        if state:  # an animation alone leaves what the eyes were told before in place
            least, usual, most = EYES_MS
            ms = cmd.get("ms")
            ms = usual if isinstance(ms, bool) or not isinstance(ms, (int, float)) else max(least, min(most, ms))
            self.override, self.override_until = state, now + ms / 1000
        anim = cmd.get("anim")
        if anim in ANIMS and self.pose(now).open:  # a blink would open eyes that are meant to be shut
            if anim == "confused":
                self.eyes.anim_confused(now)
            elif anim == "laugh":
                self.eyes.anim_laugh(now)
            else:  # the body's left eye is the one on the viewer's right
                self.eyes.blink(left=anim != "wink_left", right=anim != "wink_right")
        return bool(state) or anim in ANIMS

    def release(self, now):
        """Hand the eyes back to the reflexes."""
        self.override_until = float("-inf")

    def fit(self, shape):
        """A shape from a command laid over the configured one, kept to sizes that fit the screen."""
        values = list(self.shape)
        for i, (key, lo, hi) in enumerate(SHAPE_LIMITS):
            v = shape.get(key)
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                values[i] = max(lo, min(hi, round(v)))
        width, height, radius, space = values
        return (width, height, radius, min(space, 128 - 2 * width))

    # ---------- what to show ----------
    def pose(self, now):
        if not self.online:
            return Pose(False, "default", "center", False, 0, self.shape, 0)
        damage = damage_level(self.sense) if self.strain else 0
        mood, sweat = "tired" if damage >= 2 else "default", max(0, damage - 1)
        if now < self.startled:
            w, h, r, space = self.shape
            return Pose(True, "default", "center", False, sweat, (w + 4, min(64, h + 12), r, space), 0)
        look, squeeze = self.look if now < self.look_until else None, 0
        if self.talk_from <= now < self.talk_until:
            look = look or "center"
            squeeze = 0 if int((now - self.talk_from) * TALK_HZ * 2) % 2 else TALK_PX
        pose = Pose(True, mood, look, self.near, sweat, self.shape, squeeze)
        return pose._replace(**self.override) if now < self.override_until else pose

    def apply(self, pose, old):
        eyes = self.eyes
        if old is None or pose.shape != old.shape:
            w, h, r, space = pose.shape
            eyes.set_width(w, w)
            eyes.set_height(h, h)
            eyes.set_borderradius(r, r)
            eyes.set_spacebetween(space)
        if old is None or pose.open != old.open:
            (eyes.open if pose.open else eyes.close)()
            eyes.set_autoblinker(pose.open)
        eyes.set_mood(pose.mood)
        eyes.set_curiosity(pose.curious)
        eyes.set_sweat(pose.sweat)
        eyes.set_squeeze(pose.squeeze)
        eyes.set_idle_mode(pose.open and pose.look is None)

    def pose_eyes(self, now):
        pose = self.pose(now)
        if pose != self.posed:
            self.apply(pose, self.posed)
            self.posed = pose
        if pose.look:  # every frame: where "center" is moves while the eyes change size
            self.eyes.set_position(pose.look)

    def update(self, now):
        self.pose_eyes(now)
        self.eyes.update(now)

    def settle(self, now):
        """Jump to the pose's end, for a single still frame."""
        for _ in range(2):  # a position depends on the eyes' size, which the first pass settles
            self.pose_eyes(now)
            self.eyes.settle(now)

    def animating(self, now, sweat=True):
        return self.eyes.animating(now, sweat) or self.talk_from <= now < self.talk_until

    def next_event(self, now):
        """When the picture next changes by itself while nothing is animating, or None."""
        due = [t for t in (self.startled, self.look_until, self.talk_from, self.talk_until, self.override_until)
               if t > now]
        blink = self.eyes.next_event(now)
        return min(due + ([blink] if blink is not None else []), default=None)

    def draw(self, d):
        self.eyes.draw(d)
