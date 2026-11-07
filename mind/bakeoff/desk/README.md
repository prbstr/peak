# Desk camera bake-off

Can the Pi camera, hung over the desk, tell what the owner's hands are doing (wiring, looking at a part, on the phone)?
Measured 7 Nov 2026 on three 25 s recordings from the camera on the monitor arm, 1920x1080 at 15 fps, desk light only.

| File | Does |
| --- | --- |
| `record.sh` | Records the Pi's UDP stream to mp4 without re-encoding |
| `gate.py` | Per sampled frame: hands in view (MediaPipe hand landmarker) and today's 16x16 change score. Own venv: `python3.13 -m venv bakeoff/desk/.venv && bakeoff/desk/.venv/bin/pip install mediapipe`; model in `models/hand_landmarker.task` (Google's float16 `latest`) |
| `describe.js` | At chosen moments asks Qwen3-VL about the whole frame (1280 wide) and a crop around the hands. `PEAK_DESK_PROMPT`, `PEAK_DESK_MODES`, `PEAK_DESK_VF` (default `transpose=1`: the camera hangs turned) |
| `time.js` | Times the model on one frame vs several, at several widths, a new image each run |

## Results

**Model time per look** (fresh image, no prompt cache): one frame 5.5 s at 640, 5.7 s at 960, 6.5 s at 1280, 18.8 s at 1920;
three frames 16.8 s. Ollama scales small images up to about 1,100 tokens, so nothing under 640 is faster.
Three 1080p frames do not fit the brain's 4096 context. One frame per look, then.

**When to look.** Today's change gate (`vision.js`: 16x16 difference >= 12, 10 s cooldown) fired once after the
start in 75 s of activity (w1 at 14 s) and never during the wiring or the phone. The hand tracker took 6-7 ms a frame at
1080p, found hands in every second of real handling, and fired on none of the 8 idle moments (hands in the lap). It
missed hands resting in the shadow at the keyboard edge.

**What it says.** 19 moments with hands busy, labelled by hand from per-second contact sheets; half a point for a
partly right answer.

| Input | Prompt | Right | Invented soldering |
| --- | --- | --- | --- |
| Whole frame, 1280 | "workbench" | 6.5 / 19 (34%) | 4 |
| Hand crop | "workbench" | 10 / 19 (53%) | 0 |
| Hand crop | "desk with electronics parts ... say only what you can see" | 13 / 19 (68%) | 0 |

Got right: mouse use, a phone, a small circuit board with a yellow wire, a wire being picked up. Got wrong: the
HC-SR04 in its bag ("blue keycaps", "plastic bottle"), hands moving fast (blurred at this light), and once a phone
called a circuit board. The prompt change was one run on one evening; the timings in that run are cached and
not counted.

## A second, smaller model for the desk (7 Nov 2026, late)

Built in, the 8B describing the desk made the brain wait: Ollama 0.40.13 runs qwen3vl on one slot
("model architecture does not currently support parallel requests"), so a question asked during a look queues
behind the image. `contend.js` asks the brain a desk question at random moments while looks run back to back on
unique crops (204 = the 34 real crops at six offsets), 20 questions each:

| Looks by | Gesture median / p90 / max | Reply median / p90 / max |
| --- | --- | --- |
| nothing (quiet) | 0.24 / 0.27 / 0.46 s | 0.88 / 0.93 / 1.1 s |
| the 8B itself (one model) | 3.5 / 5.7 / 6.1 s | 4.1 / 6.4 / 6.7 s |
| `qwen3-vl:4b-instruct` beside it | **0.80 / 1.1 / 1.1 s** | 3.0 / 4.1 / 4.1 s |

The 4B never makes the brain queue; it only shares the GPU, which slows the spoken line. Accuracy on the same
19 labelled moments (`labels.json`, hand crops, the desk prompt), half a point for partly right:

| Model | Right | Notes |
| --- | --- | --- |
| 8B (brain's own) | 13 / 19 | |
| `qwen3-vl:4b-instruct` (3.3 GB) | 12.5 / 19 | named the bagged HC-SR04 "a small blue plastic package containing electronic components" |
| `qwen3-vl:2b-instruct` (1.9 GB) | 9 / 19 | scissors where there were wires; long sentences |
| `gemma3:4b` (3.4 GB) | not scored | never loaded: with `OLLAMA_MAX_LOADED_MODELS=2` and two busy models its requests hung past 5 minutes |

The 2B and gemma3 were deleted afterwards. Ollama starts these models with `--image-min-tokens 1024`, so a small
crop costs as much as a 640 frame.

## Not yet

A brighter room, a held-out recording, a tighter crop (the crop is 2x the hands and at least 640x480), and a
smaller model only for the desk.
