# Lessons from "System One" models, applied to Peak

TypeSafe's Jev (Sep 2026) is a hosted model that takes a state and a list of narrow typed questions and returns
typed answers with calibrated probabilities, in 70-500 ms, with no free text. Peak will not use it (hosted, closed,
not abliterated, and the brain must also talk), but the design behind it maps onto the mind. Each lesson below says
what it means here and what it measured. Numbers come from `mind/bakeoff/brain` (97 steps, 5 runs, Qwen3-VL 8B).

## 1. Decide first, talk second

Jev never generates prose, so its answer is ready after one forward pass. Our reply is one JSON object whose first
field is the gesture and whose last is the spoken line, so the decision is complete after roughly ten tokens while
the sentence takes another twenty to thirty. Streaming the reply and acting on the gesture the moment its field
closes cuts time-to-gesture from 0.4 s (the full reply) to 0.24 s, with the spoken line following as before.

- Where: `askBrain({ onGesture })` in `brain.js`, used by the orchestrator; `--stream` in the bake-off.
- Guard: the early gesture must equal the parsed one ("early mismatches" column); the grammar makes this exact.

## 2. A decision has a probability; use it

Jev returns a confidence with every choice so code can route low-confidence answers to review. Ollama 0.40 returns
token logprobs even under a JSON grammar, so the joint probability of the gesture tokens is a free confidence score
on every local reply. The bake-off reports mean confidence when right and when wrong. Measured: Qwen3-VL is as confident when wrong
(0.85-0.99) as when right (0.97-0.99), so a veto does nothing for it; the 9B's misses sit at 0.3-0.5 against 0.94
when right, so `PEAK_MIN_CONFIDENCE=0.6` turns most of them into "no gesture", the safer failure for a robot.
Whether a model's confidence means anything is itself something to measure per model.

- Where: `gestureConfidence()` in `brain.js`; `confidence` on every `askBrain` result.
- Caveat: it is the model's confidence in its own choice, not calibrated. Only use it to veto, never to rank models.

## 3. Narrow questions, combined in code

Jev's guidance is to ask several small questions ("is this addressed to me", "does it ask for a gesture") and combine
them in code rather than one broad question. For a small local model the same holds: the failures were not knowledge
gaps but a single wide decision ("what should the whole reply be") swallowing a narrow one ("is this a negation").
Putting the narrow decisions into the prompt as rules, one per failure, took the brain from 94% to 100% strict on
97 steps and 95% on 22 cases written afterwards. The schema-field version (a typed "intent" the model fills before
the gesture) was not needed and stays untested.

## 4. Typed outputs cannot be wrong by type, only by content

Jev's "no type errors" is a grammar guarantee, and Ollama's structured outputs give the same one: 100% valid JSON and
0 unknown gestures across every model scored. So the bake-off's JSON and unknown columns are health checks for a
broken template, not a quality signal. Quality lives in the strict column.

## 5. Evaluate on held-out inputs before trusting a prompt change

Tuning a prompt against the cases you read the failures from overfits. The bake-off now has five held-out groups
(`stt`, `neg2`, `ind2`, `multi`, `vision2`: 25 cases) written before any tuning, and the report scores every group
separately. A prompt change counts only if the held-out groups do not drop. The ladder in the bake-off README shows why:
three of the five prompt versions fixed one case and broke another.

## 6. Speed comes from not re-reading, not from a smaller model

Jev's speed is architectural. Locally the equivalent is the prompt cache: a static system prompt is read once and
every later reply costs only its new tokens (0.1 s prompt time for 630 tokens). Gemma 4 lost the bake-off because
its attention makes llama.cpp re-read the prompt every call (2.4 s), not because it is bigger. Keep the system prompt
static, put anything that changes (bodies online, the event) in the user turn, and watch `prompt ... ms` in the
mind's log.

## 7. The input is noisy; say so in the prompt

System One models are fed program state, not speech. Peak's state comes through speech-to-text that writes "nod" as
"not", "Peak" as "Peek" or "Pete", and drops punctuation. The `stt` group covers this; the prompt names the common
substitutions so the brain treats them as transcription noise rather than negation. It holds for "not if you can
hear me" and fails for "can you not your head", so the STT bake-off's engine choice still matters more.

## What did not transfer

- Hosted inference. The brain stays local and abliterated; Jev's 70-500 ms plus a 250 ms round trip from here is no
  faster than the local 0.4 s anyway.
- Bounding boxes for `look_at`. Jev 1.14 offers them, but a local detector on the Mac will do that without an account.
- Pure classification without text. Peak has to speak, so the reply keeps its `say` field.
