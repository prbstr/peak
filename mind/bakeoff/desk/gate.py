"""Desk camera gate: per sampled frame, are hands in view (MediaPipe) and how much did the frame change
(the 16x16 grayscale difference vision.js uses today). Writes JSON lines for score.js.

    bakeoff/desk/.venv/bin/python -u bakeoff/desk/gate.py <video> [fps] > gate.jsonl
"""
import json, sys, time
import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions, RunningMode
from pathlib import Path

video, fps = sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 5.0
model = Path(__file__).parent / 'models' / 'hand_landmarker.task'
opts = HandLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(model)), running_mode=RunningMode.VIDEO,
                             num_hands=2, min_hand_detection_confidence=0.4, min_tracking_confidence=0.4)
cap = cv2.VideoCapture(video)
src_fps = cap.get(cv2.CAP_PROP_FPS) or 15
step = max(1, round(src_fps / fps))
prev, n, ms_total, sampled, width = None, 0, 0.0, 0, 0
with HandLandmarker.create_from_options(opts) as hands:
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        n += 1
        if (n - 1) % step:
            continue
        t = (n - 1) / src_fps
        thumb = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (16, 16), interpolation=cv2.INTER_AREA).astype(int)
        diff = 255.0 if prev is None else float(abs(thumb - prev).mean())
        prev = thumb
        width = frame.shape[1]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        t0 = time.perf_counter()
        res = hands.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(t * 1000))
        ms = (time.perf_counter() - t0) * 1000
        ms_total += ms; sampled += 1
        boxes = []
        for lm, hd in zip(res.hand_landmarks, res.handedness):
            xs, ys = [p.x for p in lm], [p.y for p in lm]
            boxes.append({'box': [round(min(xs), 3), round(min(ys), 3), round(max(xs), 3), round(max(ys), 3)],
                          'score': round(hd[0].score, 2)})
        print(json.dumps({'t': round(t, 2), 'hands': boxes, 'diff': round(diff, 1), 'ms': round(ms, 1)}))
print(f'# {sampled} frames, hand tracker {ms_total / max(sampled, 1):.1f} ms per frame at '
      f'{width}px', file=sys.stderr)
