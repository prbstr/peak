"""hands: the desk camera's hand tracker, run by vision.js in desk mode.

Reads the Pi camera's H264 stream through one long-lived ffmpeg (so a look costs no stream open), runs MediaPipe's
hand landmarker on a few frames a second, and keeps the latest frame with hands in it. On each "crop <path>" line on
stdin it writes the region around the hands, padded and turned upright, to <path> as a JPEG and answers with one JSON
line: {"hands": n, "age_ms": ms since that frame} or {"hands": 0} when no hands were seen lately.
Evidence for this design: mind/bakeoff/desk/README.md.

Set up once, from mind/:
    python3.13 -m venv senses/.venv && senses/.venv/bin/pip install mediapipe
    mkdir -p senses/models && curl -L -o senses/models/hand_landmarker.task \
      https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task

    PEAK_VISION_SOURCE  ffmpeg input (default udp://0.0.0.0:5000)
    PEAK_HANDS_FPS      frames a second given to the tracker (default 5)
    PEAK_HANDS_MAX_AGE  ms a frame with hands stays good for a crop (default 1500)
    PEAK_DESK_ROTATE    cw, ccw, 180 or none: how to turn the frame upright (default cw: the camera hangs turned)
"""
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions, RunningMode

SOURCE = os.environ.get('PEAK_VISION_SOURCE', 'udp://0.0.0.0:5000')
FPS = float(os.environ.get('PEAK_HANDS_FPS', '5'))
MAX_AGE_MS = float(os.environ.get('PEAK_HANDS_MAX_AGE', '1500'))
ROTATE = {'cw': cv2.ROTATE_90_CLOCKWISE, 'ccw': cv2.ROTATE_90_COUNTERCLOCKWISE, '180': cv2.ROTATE_180,
          'none': None}[os.environ.get('PEAK_DESK_ROTATE', 'cw')]
MODEL = Path(__file__).parent / 'models' / 'hand_landmarker.task'


def log(*a):
    print('[hands]', *a, file=sys.stderr, flush=True)


def probe_size():
    """The stream's width and height, from ffprobe; the Pi sends bare H264, so tell it the format."""
    args = ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0']
    if SOURCE.startswith('udp://'):
        args += ['-f', 'h264', '-probesize', '2000000', '-analyzeduration', '3000000']
    out = subprocess.run(args + [SOURCE], capture_output=True, text=True, timeout=30).stdout.strip().splitlines()
    w, h = (int(v) for v in out[0].split(',')[:2])
    return w, h


def crop_box(boxes, w, h):
    """The hands' joint box, padded to twice its size and at least 640x480, kept inside the frame."""
    x0, y0 = min(b[0] for b in boxes) * w, min(b[1] for b in boxes) * h
    x1, y1 = max(b[2] for b in boxes) * w, max(b[3] for b in boxes) * h
    cw, ch = min(w, max(640, (x1 - x0) * 2)), min(h, max(480, (y1 - y0) * 2))
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    x, y = min(max(0, cx - cw / 2), w - cw), min(max(0, cy - ch / 2), h - ch)
    return int(x), int(y), int(cw), int(ch)


class Tracker:
    def __init__(self):
        self.lock = threading.Lock()
        self.latest = None  # (monotonic s, frame, boxes) of the last frame that had hands
        self.frame = None  # the last frame read, for "snap"
        self.alive = True
        self.ff = None
        self.seen = self.with_hands = 0

    def run(self):
        while self.alive:
            try:
                self.read_stream()
            except Exception as e:  # a dropped stream or a bad frame: say so and open it again
                log('stream:', e)
            time.sleep(2)

    def read_stream(self):
        w, h = probe_size()
        log(f'reading {SOURCE} at {w}x{h}, {FPS:g} fps to the tracker')
        inp = ['-fflags', 'nobuffer', '-f', 'h264', '-probesize', '2000000', '-analyzeduration', '1000000'] \
            if SOURCE.startswith('udp://') else []
        ff = self.ff = subprocess.Popen(['ffmpeg', '-loglevel', 'fatal', *inp, '-i', SOURCE, '-vf', f'fps={FPS:g}',
                                         '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
        opts = HandLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(MODEL)),
                                     running_mode=RunningMode.VIDEO, num_hands=2,
                                     min_hand_detection_confidence=0.4, min_tracking_confidence=0.4)
        size = w * h * 3
        t0 = last_report = time.monotonic()
        try:
            with HandLandmarker.create_from_options(opts) as landmarker:
                while self.alive:
                    raw = ff.stdout.read(size)
                    if len(raw) < size:
                        raise RuntimeError('stream ended')
                    frame = np.frombuffer(raw, np.uint8).reshape(h, w, 3)
                    now = time.monotonic()
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    res = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb),
                                                      int((now - t0) * 1000))
                    boxes = [(min(p.x for p in lm), min(p.y for p in lm), max(p.x for p in lm), max(p.y for p in lm))
                             for lm in res.hand_landmarks]
                    self.seen += 1
                    with self.lock:
                        self.frame = frame
                        if boxes:
                            self.with_hands += 1
                            self.latest = (now, frame, boxes)
                    if now - last_report >= 60:
                        log(f'{self.seen} frames in the last minute, {self.with_hands} with hands')
                        self.seen = self.with_hands = 0
                        last_report = now
        finally:
            ff.kill()

    def crop(self, path):
        with self.lock:
            latest = self.latest
        if not latest:
            return {'hands': 0}
        at, frame, boxes = latest
        age = (time.monotonic() - at) * 1000
        if age > MAX_AGE_MS:
            return {'hands': 0}
        h, w = frame.shape[:2]
        x, y, cw, ch = crop_box(boxes, w, h)
        img = frame[y:y + ch, x:x + cw]
        if ROTATE is not None:
            img = cv2.rotate(img, ROTATE)
        cv2.imwrite(path, img, [cv2.IMWRITE_JPEG_QUALITY, 90])
        return {'hands': len(boxes), 'age_ms': round(age)}


    def snap(self, path):
        """The whole last frame, turned upright: for checking where the camera points."""
        with self.lock:
            frame = self.frame
        if frame is None:
            return {'frame': False}
        cv2.imwrite(path, frame if ROTATE is None else cv2.rotate(frame, ROTATE), [cv2.IMWRITE_JPEG_QUALITY, 85])
        return {'frame': True}


def main():
    tracker = Tracker()
    threading.Thread(target=tracker.run, daemon=True).start()
    for line in sys.stdin:
        cmd, _, arg = line.strip().partition(' ')
        if cmd == 'crop' and arg:
            print(json.dumps(tracker.crop(arg)), flush=True)
        elif cmd == 'snap' and arg:
            print(json.dumps(tracker.snap(arg)), flush=True)
    # stdin closed: the parent (vision.js) is gone
    tracker.alive = False
    if tracker.ff:
        tracker.ff.kill()


if __name__ == '__main__':
    main()
