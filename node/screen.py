"""peak node — what the OLED shows.

A face in the manner of Doom's status bar: 24x29 one-bit pixels drawn double size, with the body's own
readings standing in for the game's. It glances about when idle, winces when something comes close, grins
at a gesture, moves its mouth while a line is spoken, bleeds as the Pi's power gets worse and dies when the
broker is gone. All of it is decided here on the body, so the face keeps going when the mind is away.

Pure Python: the only drawing calls are on the ImageDraw it is handed, so it runs in tests and on the Mac.
"""
import random, re, textwrap
from collections import namedtuple

# ---------- the face's state ----------
NEAR_CM = 30         # the same line the mind's presence filter draws for "close"
FAR_CM = 36          # and it must back off past this before it can come close again
OUCH_S = 1.5
GRIN_S = 2
LOOK_S = 3
GLANCE_S = 0.5       # Doom picks a new idle glance every half second
TALK_HZ = 4          # mouth movements a second
TALK_S_PER_CHAR = 0.07
TALK_MAX_S = 12
HOT_C = 70
MAX_DAMAGE = 4
# gaze is in screen terms: -1 is the viewer's left. The body's left is the viewer's right.
LOOKS = {"look_left": 1, "look_right": -1}

Frame = namedtuple("Frame", "mood gaze open damage")  # open: the mouth, while talking

def damage_level(sense):
    """0 (fresh) to 4 (bloodied) from the Pi's power flags and temperature, the nearest thing a body has to health."""
    try:
        flags = int(sense.get("throttled") or "0", 16)
    except ValueError:
        flags = 0
    hurts = (flags & 0x1,       # undervoltage right now
             flags & 0x6,       # CPU capped or throttled right now
             flags & 0x10000,   # undervoltage at some point since boot
             flags & 0x8 or sense.get("temp", 0) >= HOT_C)
    return sum(1 for h in hurts if h)

def health(frame):
    """The status bar's percentage for a frame."""
    return 0 if frame.mood == "dead" else 100 - 20 * frame.damage

class Face:
    """Picks the expression. Time comes in as an argument, so tests can move the clock."""
    def __init__(self, rng=random):
        self.rng = rng
        self.gaze, self.glanced = 0, float("-inf")
        self.look_gaze = 0
        self.ouch = self.grin = self.talk = self.look = float("-inf")  # each lasts until its time
        self.near = False

    def on_gesture(self, name, now):
        if name in LOOKS:
            self.look_gaze, self.look = LOOKS[name], now + LOOK_S
        else:
            self.grin = now + GRIN_S

    def on_say(self, text, now):
        self.talk = now + min(TALK_MAX_S, max(1, len(text) * TALK_S_PER_CHAR))

    def frame(self, now, sense, online):
        damage = damage_level(sense)
        if not online:
            return Frame("dead", 0, False, MAX_DAMAGE)
        # Wince at the approach, not for as long as the thing stays there: on a desk something always is.
        cm = sense.get("distance_cm")
        if cm is None or cm > FAR_CM:
            self.near = False
        elif cm < NEAR_CM and not self.near:
            self.near, self.ouch = True, now + OUCH_S
        if now < self.ouch:
            return Frame("ouch", 0, True, damage)
        if now - self.glanced >= GLANCE_S:
            self.gaze, self.glanced = self.rng.choice((-1, 0, 1)), now
        looking = now < self.look
        if now < self.talk:
            return Frame("talk", self.look_gaze if looking else 0, int(now * TALK_HZ) % 2 == 0, damage)
        if now < self.grin:
            return Frame("grin", 0, False, damage)
        return Frame("idle", self.look_gaze if looking else self.gaze, False, damage)

# ---------- the sprite ----------
W, H, SCALE = 24, 29, 2

# '#' skin, ':' hair (drawn as a checkerboard, the one-bit way to say "darker"), ' ' nothing.
HEAD = [
    "     ::::::::::::::     ",
    "    ::::::::::::::::    ",
    "   ::::::::::::::::::   ",
    "   ::::::::::::::::::   ",
    "   ::::::::::::::::::   ",
    "   :::############:::   ",
    "   ::##############::   ",
    "   :################:   ",
    "   :################:   ",
    "   ##################   ",
    "  ####################  ",
    " ###################### ",
    " ###################### ",
    " ###################### ",
    "  ####################  ",
    "   ##################   ",
    "   ##################   ",
    "   ##################   ",
    "   ##################   ",
    "   ##################   ",
    "   ##################   ",
    "   ##################   ",
    "   ##################   ",
    "    ################    ",
    "    ################    ",
    "     ##############     ",
    "      ############      ",
    "       ##########       ",
    "         ######         ",
]

def rect(x0, y0, x1, y1):
    return [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]

def both(cells):
    """The cells and their mirror image: the face is symmetric about its middle."""
    return cells + [(W - 1 - x, y) for x, y in cells]

def checker(cells):
    return [(x, y) for x, y in cells if (x + y) % 2]

# Everything below is dark pixels cut into the lit head.
EYES_X = (4, 14)  # left edge of each eye; an eye is 6 wide, rows 11 and 12
BROWS = both(rect(3, 8, 7, 8) + rect(6, 9, 10, 9))  # slanting in: the scowl
RAISED = both(rect(4, 7, 9, 7))
CROSSES = both([(5, 10), (6, 11), (7, 12), (8, 13), (8, 10), (7, 11), (6, 12), (5, 13)])
NOSE = rect(12, 14, 12, 16) + rect(10, 17, 12, 17)
MOUTHS = {
    "shut": rect(8, 21, 15, 21) + both([(7, 22)]),
    "flat": rect(8, 21, 15, 21),
    "open": rect(9, 20, 14, 22),
    "wide": rect(9, 19, 14, 23),
    "grin": rect(7, 20, 16, 20) + rect(8, 22, 15, 22) + [(x, 21) for x in (7, 10, 13, 16)] + both([(6, 19)]),
    "slack": rect(8, 21, 15, 21) + rect(10, 22, 13, 22),
}
BLOOD = [  # one more entry shows with each level of damage
    rect(11, 18, 11, 20),                                                     # nosebleed
    [(12, 5), (13, 5), (14, 6), (15, 6), (15, 7)],                            # cut on the forehead
    rect(16, 23, 16, 25) + checker(rect(4, 15, 6, 18)),                       # split lip, bruised cheek
    rect(12, 18, 12, 19) + checker(rect(17, 15, 19, 19) + rect(7, 5, 10, 6)), # and the rest
]

def sprite(frame):
    """The face for a frame as H strings of W characters: '#' lit, ' ' dark."""
    mood, gaze = frame.mood, frame.gaze
    cut = list(NOSE)
    if mood == "dead":
        cut += CROSSES
    else:
        cut += RAISED if mood == "ouch" else BROWS
        for x in EYES_X:
            cut += rect(x + 2 + 2 * gaze, 11, x + 3 + 2 * gaze, 12)
    cut += MOUTHS[{"dead": "slack", "ouch": "wide", "grin": "grin", "idle": "shut"}.get(mood)
                  or ("open" if frame.open else "flat")]
    for wound in BLOOD[:frame.damage]:
        cut += wound
    cut = set(cut)
    return ["".join("#" if (c == "#" or c == ":" and (x + y) % 2 == 0) and (x, y) not in cut else " "
                    for x, c in enumerate(row)) for y, row in enumerate(HEAD)]

def paint_face(d, frame, x, y):
    for row, line in enumerate(sprite(frame)):
        top = y + row * SCALE
        for run in re.finditer("#+", line):
            d.rectangle((x + run.start() * SCALE, top, x + run.end() * SCALE - 1, top + SCALE - 1), fill="white")

# ---------- the whole picture ----------
REPLY_WINDOW_S = 2   # the mind sends one reply as two commands, gesture then line; farther apart is a new reply
REPLY_HOLD_S = 6
PAGE_S = 3           # a line longer than the text column turns its pages this fast
FACE_Y = (64 - H * SCALE) // 2

class Screen:
    """The 128x64 picture. Idle it is a status bar: distance on the left, the face, health on the right.
    A reply from the mind moves the face aside for the gesture and the spoken line, a page at a time."""
    COLS, ROWS, LINE_PX, TEXT_X = 12, 4, 12, 52  # the default font beside the face, under a one-line header

    def __init__(self, node, rng=random):
        self.node = node
        self.face = Face(rng)
        self.gesture = self.say = None
        self.at = self.until = float("-inf")
        self.sense, self.online = {}, False

    def reply(self, now, gesture=None, say=None):
        if now - self.at > REPLY_WINDOW_S:
            self.gesture = self.say = None
            self.at = now
        if gesture:
            self.gesture = gesture
            self.face.on_gesture(gesture, now)
        if say:
            self.say = say
            self.face.on_say(say, now)
        self.until = self.at + max(REPLY_HOLD_S, len(self.pages()) * PAGE_S)

    def pages(self):
        lines = textwrap.wrap(self.say or "", self.COLS)
        return [lines[i:i + self.ROWS] for i in range(0, len(lines), self.ROWS)] or [[]]

    def scene(self, now):
        """Everything on the glass as one tuple: what paint() draws, and equal while nothing would change."""
        frame = self.face.frame(now, self.sense, self.online)
        if now < self.until:
            pages = self.pages()
            return ("reply", frame, self.gesture, tuple(pages[int((now - self.at) / PAGE_S) % len(pages)]))
        cm = self.sense.get("distance_cm")
        return ("hud", frame, None if cm is None else round(cm), health(frame))

    def paint(self, d, scene):
        layout, frame, *rest = scene
        if layout == "reply":
            gesture, lines = rest
            paint_face(d, frame, 0, FACE_Y)
            d.text((self.TEXT_X, 0), f"*{gesture}*" if gesture else self.node, fill="white")
            for i, line in enumerate(lines):
                d.text((self.TEXT_X, 14 + i * self.LINE_PX), line, fill="white")
        else:
            cm, hp = rest
            paint_face(d, frame, (128 - W * SCALE) // 2, FACE_Y)
            d.text((2, 20), "DIST", fill="white")
            d.text((2, 34), "--" if cm is None else f"{cm}cm", fill="white")
            d.text((98, 20), "HP", fill="white")
            d.text((98, 34), f"{hp}%", fill="white")
