#!/usr/bin/env python3
"""Draw every face and both layouts of screen.py into one PNG, to see a change without the Pi.

    ../.venv/bin/python screen_preview.py [out.png] [zoom]      (needs Pillow)
"""
import sys
from PIL import Image, ImageDraw
from screen import Frame, Screen

OUT = sys.argv[1] if len(sys.argv) > 1 else "screen_preview.png"
ZOOM = int(sys.argv[2]) if len(sys.argv) > 2 else 3
COLS, GAP = 3, 4

SCENES = [
    ("hud", Frame("idle", -1, False, 0), 23, 100),
    ("hud", Frame("idle", 0, False, 0), 112, 100),
    ("hud", Frame("idle", 1, False, 1), None, 80),
    ("hud", Frame("idle", 0, False, 2), 37, 60),
    ("hud", Frame("idle", 0, False, 3), 37, 40),
    ("hud", Frame("idle", 0, False, 4), 37, 20),
    ("hud", Frame("ouch", 0, True, 0), 7, 100),
    ("hud", Frame("grin", 0, False, 0), 45, 100),
    ("hud", Frame("dead", 0, False, 4), 45, 0),
    ("reply", Frame("talk", 0, True, 3), "wave", ("Hello there!",)),
    ("reply", Frame("talk", 0, False, 3), None, ("Careful,", "that's quite", "close.")),
    ("reply", Frame("grin", 0, False, 0), "look_right", ("I can move,", "see, hear,", "and speak. I", "can wave,")),
]

screen = Screen("mech")
rows = -(-len(SCENES) // COLS)
sheet = Image.new("L", (COLS * (128 + GAP) * ZOOM, rows * (64 + GAP) * ZOOM), 60)
for i, scene in enumerate(SCENES):
    glass = Image.new("1", (128, 64))
    screen.paint(ImageDraw.Draw(glass), scene)
    sheet.paste(glass.convert("L").resize((128 * ZOOM, 64 * ZOOM), Image.NEAREST),
                ((i % COLS) * (128 + GAP) * ZOOM + GAP * ZOOM // 2, (i // COLS) * (64 + GAP) * ZOOM + GAP * ZOOM // 2))
sheet.save(OUT)
print(f"saved {OUT}")
