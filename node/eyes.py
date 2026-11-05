"""peak node — robot eyes.

A Python port of FluxGarage RoboEyes for OLED Displays V 1.1.1 (https://github.com/FluxGarage/RoboEyes),
which draws smoothly animated robot eyes from rounded rectangles and triangles.

Copyright (C) 2024-2025 Dennis Hoelscher, www.fluxgarage.com
Ported and modified for peak (https://github.com/prbstr/peak), 5 November 2026. What changed in the port:
- drawn on a PIL ImageDraw instead of an Adafruit GFX display, with the time passed in instead of read
  from millis(), so the same code runs in tests and on a Mac;
- the original halves each distance once a frame at up to 50 frames a second. An I2C OLED on a Pi gets far
  fewer, so every tween here is eased by elapsed time and keeps its speed at any frame rate;
- flicker, laughing and confusion are offsets at draw time, sweat is a number of drops (0 to 3), and
  `squeeze`, `settle`, `animating` and `next_event` are additions for peak's display loop.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the
implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License
for more details.

You should have received a copy of the GNU General Public License along with this program. If not, see
<https://www.gnu.org/licenses/>.
"""
import random

HALF_LIFE_S = 0.04   # a tween covers half its remaining distance in this long: the original at 25 frames a second
SNAP_PX = 0.5        # closer than this to the target is there
CURIOUS_PX = 8       # how much taller the outer eye gets when looking sideways with curiosity on
ANIM_S = 0.5         # one-shot laugh and confusion
LAUGH_PX, CONFUSED_PX = 5, 20
FLICKER_S = 0.08     # a flicker changes side this often
FLICKER_GAIN = 2 / 3 # the original adds the amplitude and then halves back toward the target: it settles at 2/3
SWEAT_FPS = 25       # the original moves a drop by fixed steps per frame; this is the frame rate they stand for
SWEAT_RADIUS = 3

MOODS = ("default", "tired", "angry", "happy")
# Where the left eye goes, as fractions of the room there is to move in. East is the right of the screen.
POSITIONS = {"center": (0.5, 0.5), "n": (0.5, 0), "ne": (1, 0), "e": (1, 0.5), "se": (1, 1),
             "s": (0.5, 1), "sw": (0, 1), "w": (0, 0.5), "nw": (0, 0)}

def ease(cur, target, k):
    return target if abs(target - cur) < SNAP_PX else cur + (target - cur) * k

class Eye:
    def __init__(self, w, h, r):
        self.w_default = self.w = self.w_next = w
        self.h_default = self.h_next = h
        self.h = 1.0  # eyes start shut and open on the first frames, as the original's do
        self.r_default = self.r = self.r_next = r
        self.x = self.y = self.x_next = self.y_next = 0.0
        self.h_offset = 0
        self.open = False  # asked to open: update() does it once the eye has shut

    def h_target(self, squeeze):
        return self.h_next + self.h_offset - (squeeze if self.h_next > 1 else 0)

    def moving(self, squeeze):
        return (self.h, self.w, self.r, self.x, self.y) != (self.h_target(squeeze), self.w_next, self.r_next,
                                                             self.x_next, self.y_next)

class RoboEyes:
    def __init__(self, width=128, height=64, rng=random):
        self.width, self.height, self.rng = width, height, rng
        self.left, self.right = Eye(36, 36, 8), Eye(36, 36, 8)
        self.space_default = self.space = self.space_next = 10
        self.tired = self.angry = self.happy = self.curious = self.cyclops = False
        self.lid_tired = self.lid_angry = self.lid_happy = 0.0
        self.squeeze = 0
        self.h_flicker = self.v_flicker = 0  # amplitude in pixels, 0 is off
        self.autoblinker, self.blink_interval, self.blink_variation, self.blink_at = False, 1, 4, float("-inf")
        self.idle, self.idle_interval, self.idle_variation, self.idle_at = False, 1, 3, float("-inf")
        self.confused_until = self.laugh_until = float("-inf")
        self.sweat = 0
        self.drops = [None, None, None]  # each (born, x, y_max)
        self.at = None
        self.set_position("center")
        self.settle_position()

    # ---------- setters ----------
    def set_width(self, left, right):
        self.left.w_next = self.left.w_default = left
        self.right.w_next = self.right.w_default = right

    def set_height(self, left, right):
        for eye, h in ((self.left, left), (self.right, right)):
            eye.h_default = h
            if eye.h_next > 1:  # the original also opens a shut eye here; a sleeping body should stay asleep
                eye.h_next = h

    def set_borderradius(self, left, right):
        self.left.r_next = self.left.r_default = left
        self.right.r_next = self.right.r_default = right

    def set_spacebetween(self, space):
        self.space_next = self.space_default = space

    def set_mood(self, mood):
        self.tired, self.angry, self.happy = mood == "tired", mood == "angry", mood == "happy"

    def set_position(self, position):
        fx, fy = POSITIONS.get(position, POSITIONS["center"])
        self.left.x_next, self.left.y_next = self.constraint_x() * fx, self.constraint_y() * fy

    def set_autoblinker(self, active, interval=None, variation=None):
        self.autoblinker = active
        if interval is not None:
            self.blink_interval, self.blink_variation = interval, variation or 0

    def set_idle_mode(self, active, interval=None, variation=None):
        self.idle = active
        if interval is not None:
            self.idle_interval, self.idle_variation = interval, variation or 0

    def set_curiosity(self, curious):
        self.curious = curious

    def set_cyclops(self, cyclops):
        self.cyclops = cyclops

    def set_h_flicker(self, active, amplitude=2):
        self.h_flicker = amplitude if active else 0

    def set_v_flicker(self, active, amplitude=10):
        self.v_flicker = amplitude if active else 0

    def set_sweat(self, drops):
        """0 to 3 drops: the left corner, then the right corner, then the middle."""
        self.sweat = max(0, min(3, int(drops)))

    def set_squeeze(self, px):
        """Open eyes this much less tall, for a pulse while speaking."""
        self.squeeze = px

    # ---------- getters ----------
    def constraint_x(self):
        """The largest x the left eye can take."""
        return self.width - self.left.w - self.space_now() - self.right_w()

    def constraint_y(self):
        return self.height - self.left.h_default  # the default height: the real one changes with every blink

    def space_now(self):
        return 0 if self.cyclops else self.space

    def right_w(self):
        return 0 if self.cyclops else self.right.w

    # ---------- basic animations ----------
    def close(self, left=True, right=True):
        for eye, chosen in ((self.left, left), (self.right, right)):
            if chosen:
                eye.h_next, eye.open = 1, False

    def open(self, left=True, right=True):
        for eye, chosen in ((self.left, left), (self.right, right)):
            if chosen:
                eye.open = True

    def blink(self, left=True, right=True):
        self.close(left, right)
        self.open(left, right)

    def anim_confused(self, now):
        """Shake left and right once."""
        self.confused_until = now + ANIM_S

    def anim_laugh(self, now):
        """Shake up and down once."""
        self.laugh_until = now + ANIM_S

    # ---------- per frame ----------
    def update(self, now):
        dt = 0.0 if self.at is None else max(0.0, now - self.at)
        self.at = now
        self.step(now, 1 - 0.5 ** (dt / HALF_LIFE_S))

    def settle(self, now):
        """Jump to where everything is heading, for a single still frame."""
        self.at = now
        for _ in range(3):  # a blink in flight needs a pass to shut and a pass to open
            self.step(now, 1.0)

    def settle_position(self):
        left, right = self.left, self.right
        left.x, left.y = left.x_next, left.y_next
        right.x = right.x_next = left.x + left.w + self.space_now()
        right.y = right.y_next = left.y

    def step(self, now, k):
        left, right = self.left, self.right
        if self.curious:
            left.h_offset = CURIOUS_PX if left.x_next <= 10 or (
                self.cyclops and left.x_next >= self.constraint_x() - 10) else 0
            right.h_offset = CURIOUS_PX if right.x_next >= self.width - self.right_w() - 10 else 0
        else:
            left.h_offset = right.h_offset = 0
        for eye in (left, right):
            eye.h = ease(eye.h, eye.h_target(self.squeeze), k)
            if eye.open and eye.h <= 1 + eye.h_offset:  # shut: this frame shows it, the next starts to open
                eye.h_next = eye.h_default
            eye.w = ease(eye.w, eye.w_next, k)
            eye.r = ease(eye.r, eye.r_next, k)
        self.space = ease(self.space, self.space_next, k)
        left.x, left.y = ease(left.x, left.x_next, k), ease(left.y, left.y_next, k)
        right.x_next, right.y_next = left.x_next + left.w + self.space_now(), left.y_next
        right.x, right.y = ease(right.x, right.x_next, k), ease(right.y, right.y_next, k)

        if self.autoblinker and now >= self.blink_at:
            self.blink()
            self.blink_at = now + self.blink_interval + self.rng.uniform(0, self.blink_variation)
        if self.idle and now >= self.idle_at:
            left.x_next = self.rng.uniform(0, self.constraint_x())
            left.y_next = self.rng.uniform(0, self.constraint_y())
            self.idle_at = now + self.idle_interval + self.rng.uniform(0, self.idle_variation)

        self.lid_tired = ease(self.lid_tired, self.lid_target(self.tired), k)
        self.lid_angry = ease(self.lid_angry, self.lid_target(self.angry), k)
        self.lid_happy = ease(self.lid_happy, self.lid_target(self.happy), k)

        for i in range(3):
            if i >= self.sweat:
                self.drops[i] = None
            elif self.drops[i] is None or (now - self.drops[i][0]) * SWEAT_FPS > 2 * (self.drops[i][2] - 2):
                lo, hi = ((0, 30), (self.width - 30, self.width), (30, self.width - 30))[i]
                self.drops[i] = (now, self.rng.uniform(lo, hi), self.rng.uniform(10, 20))

    def lid_target(self, on):
        return self.left.h / 2 if on else 0

    def animating(self, now, sweat=True):
        """True while the next frame would differ from this one without anything new being asked.
        sweat=False leaves the drops out: they are the one thing that never stops, and can be drawn slower."""
        return (self.left.moving(self.squeeze) or self.right.moving(self.squeeze) or self.space != self.space_next
                or (self.lid_tired, self.lid_angry, self.lid_happy) != tuple(map(self.lid_target, (
                    self.tired, self.angry, self.happy)))
                or bool(sweat and self.sweat or self.h_flicker or self.v_flicker)
                or now < max(self.confused_until, self.laugh_until))

    def next_event(self, now):
        """When the next blink or idle glance is due, or None."""
        due = [t for on, t in ((self.autoblinker, self.blink_at), (self.idle, self.idle_at)) if on]
        return max(now, min(due)) if due else None

    # ---------- drawing ----------
    def draw(self, d, on="white", off="black"):
        now = self.at or 0.0
        side = FLICKER_GAIN * (1 if int(now / FLICKER_S) % 2 else -1)
        dx = side * (CONFUSED_PX if now < self.confused_until else self.h_flicker)
        dy = side * (LAUGH_PX if now < self.laugh_until else self.v_flicker)
        eyes = [(self.left, False)] if self.cyclops else [(self.left, False), (self.right, True)]
        for eye, is_right in eyes:
            x, w, h, r = round(eye.x + dx), round(eye.w), round(eye.h), round(eye.r)
            y = round(eye.y + (eye.h_default - eye.h) / 2 - eye.h_offset / 2 + dy)  # centred while it shuts
            if w < 1 or h < 1:
                continue
            d.rounded_rectangle((x, y, x + w - 1, y + h - 1), radius=min(r, w // 2, h // 2), fill=on)
            # Moods are lids drawn over the eye in the background colour.
            tired, angry, happy = round(self.lid_tired), round(self.lid_angry), round(self.lid_happy)
            halves = [(x, x + w // 2, False), (x + w // 2, x + w, True)] if self.cyclops else [(x, x + w, is_right)]
            for x0, x1, inner_left in halves:  # inner_left: the eye's inner corner is its left one
                inner, outer = (x0, x1) if inner_left else (x1, x0)
                if tired:  # a wedge that is deepest at the outer corner
                    d.polygon([(x0, y - 1), (x1, y - 1), (outer, y + tired - 1)], fill=off)
                if angry:  # and one deepest at the inner corner
                    d.polygon([(x0, y - 1), (x1, y - 1), (inner, y + angry - 1)], fill=off)
            if happy:  # a rounded bite out of the bottom
                top = y + h - happy + 1
                d.rounded_rectangle((x - 1, top, x + w, top + round(eye.h_default) - 1),
                                    radius=min(r, (w + 2) // 2, round(eye.h_default) // 2), fill=off)
        for drop in self.drops:
            if drop:
                self.draw_drop(d, now, drop, on)

    @staticmethod
    def draw_drop(d, now, drop, on):
        born, x0, y_max = drop
        frames = (now - born) * SWEAT_FPS      # the original's steps: down half a pixel a frame,
        growing = min(frames, y_max - 4)       # growing until halfway down,
        shrinking = max(0.0, frames - growing) # then thinning out
        w = 1 + 0.5 * growing - 0.1 * shrinking
        h = 2 + 0.5 * growing - 0.5 * shrinking
        if w >= 1 and h >= 1:
            x, y = round(x0 - w / 2), round(2 + 0.5 * frames)
            d.rounded_rectangle((x, y, x + round(w) - 1, y + round(h) - 1),
                                radius=min(SWEAT_RADIUS, round(w) // 2, round(h) // 2), fill=on)
