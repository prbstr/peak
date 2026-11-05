#!/usr/bin/env python3
"""Draw the eyes in every state into one PNG, and a short film of them into a GIF, to see a change
without the Pi.

    ../.venv/bin/python eyes_preview.py [out.png] [zoom]      (needs Pillow; the GIF lands beside the PNG)
"""
import random, sys
from pathlib import Path
from PIL import Image, ImageDraw
from eyes import RoboEyes
from screen import Screen

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "eyes_preview.png")
ZOOM = int(sys.argv[2]) if len(sys.argv) > 2 else 2
COLS, GAP, FPS = 4, 4, 15
FINE = {"throttled": "0x0", "temp": 45.0}
WORN = {"throttled": "0x50005", "temp": 47.0}

def glass(thing):
    img = Image.new("1", (128, 64))
    thing.draw(ImageDraw.Draw(img))
    return img

def eyes(setup, t=0.0):
    e = RoboEyes(rng=random.Random(1))
    e.settle(0)
    setup(e)
    if t:
        for i in range(1, round(t * FPS) + 1):
            e.update(i / FPS)
    else:
        e.settle(0)
    return glass(e)

def body(sense, online=True, then=lambda s: None, t=0.0):
    s = Screen({}, random.Random(1))
    s.online = online
    s.on_sense(0, sense)
    s.settle(0)
    then(s)
    for i in range(1, round(t * FPS) + 1):
        s.update(i / FPS)
    if not t:
        s.settle(0.01)
    return glass(s)

def look(position, curious=False):
    def setup(e):
        e.set_curiosity(curious)
        e.set_position(position)
    return setup

STILLS = [
    eyes(lambda e: None), eyes(lambda e: e.set_mood("tired")), eyes(lambda e: e.set_mood("angry")),
    eyes(lambda e: e.set_mood("happy")),
    eyes(look("e", curious=True)), eyes(look("nw")), eyes(lambda e: e.set_cyclops(True)), eyes(lambda e: e.close()),
    body({**FINE, "distance_cm": 80}, then=lambda s: s.on_sense(0, {**FINE, "distance_cm": 9})),
    body(WORN, t=0.6), body(WORN, online=False), body(FINE, then=lambda s: s.on_say(0, "Hello there!"), t=0.1),
] + [eyes(lambda e: e.blink(), t=n / FPS) for n in (1, 2, 4, 6)]

rows = -(-len(STILLS) // COLS)
sheet = Image.new("L", (COLS * (128 + GAP) * ZOOM, rows * (64 + GAP) * ZOOM), 60)
for i, img in enumerate(STILLS):
    sheet.paste(img.convert("L").resize((128 * ZOOM, 64 * ZOOM), Image.NEAREST),
                ((i % COLS) * (128 + GAP) * ZOOM + GAP * ZOOM // 2, (i // COLS) * (64 + GAP) * ZOOM + GAP * ZOOM // 2))
sheet.save(OUT)

# The film: wake, wander, look left, something comes close, a line is spoken, the power sags, the broker goes.
s = Screen({}, random.Random(2))
script = {0.5: lambda: setattr(s, "online", True), 5: lambda: s.on_gesture(5, "look_left"),
          9: lambda: s.on_sense(9, {**FINE, "distance_cm": 9}), 11: lambda: s.on_sense(11, FINE),
          12: lambda: s.on_say(12, "Careful, that is close."), 15: lambda: s.on_sense(15, WORN),
          21: lambda: setattr(s, "online", False)}
frames = []
for i in range(23 * FPS):
    t = i / FPS
    for at in [at for at in script if at <= t]:
        script.pop(at)()
    s.update(t)
    frames.append(glass(s).convert("L").resize((128 * ZOOM, 64 * ZOOM), Image.NEAREST))
film = OUT.with_suffix(".gif")
frames[0].save(film, save_all=True, append_images=frames[1:], duration=round(1000 / FPS), loop=0)
print(f"saved {OUT} and {film}")
