# Brain bake-off

Compares candidate brain models on the same events, through the exact prompt path the orchestrator uses (`orchestrator/brain.js`). Reports gesture accuracy, JSON validity, latency, tokens/s, resident size, and whether the model stays on the GPU next to the vision model.

## Run

Stop the mind and the senses first (`pgrep -f orchestrator/index.js`); anything else talking to Ollama skews the timings and may evict models.

```sh
npm run bakeoff:brain                                                      # every model in models.json, 3 runs per case
npm run bakeoff:brain -- --pair qwen2.5vl:3b                               # also check each brain stays resident next to the eyes
npm run bakeoff:brain -- --models huihui_ai/qwen3-vl-abliterated:8b-instruct --pair huihui_ai/qwen3-vl-abliterated:8b-instruct   # one model as brain and eyes
npm run bakeoff:brain -- --stream                                          # also report time-to-gesture (the orchestrator streams)
npm run bakeoff:brain -- --models huihui_ai/qwen3-abliterated:8b --only direct --runs 1   # quick check, under a minute
```

Missing models are pulled (about 6-8 GB each; `--no-pull` to refuse). Each model is unloaded afterwards unless it is the production brain or the `--pair` model. Results land in `results/<timestamp>.md` and `.json` (gitignored), and the table is printed.

Time: 34 cases x 3 runs = 102 calls per model. About 3-4 minutes for an 8B, 5-7 for a 12B or 14B, plus pulls.

## Results, 2 Nov 2026 (M4 Pro, 24 GB, Ollama 0.24.0)

See the 3 Nov table below for the same models on Ollama 0.40.13, which changed the footprints.

52 cases + 20 sequence steps, 5 runs (pair rows 1-3 runs). Strict = right gesture and a spoken line where required.

| Brain | Eyes | Strict | p50 / p95 s | tok/s | Resident total | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `huihui_ai/qwen3-abliterated:8b` (old default) | `qwen2.5vl:3b` | 93% | 0.5 / 0.8 | 43 | 15.5-16 GB | the eyes alone are 10.4 GB; evicted by the other program's 12 GB model |
| **`huihui_ai/qwen3-vl-abliterated:8b-instruct`** | **same model** | **94-96%** | **0.5 / 0.8** | **42** | **7.0 GB** | new default; only model that did not invent a person in an empty street photo |
| `huihui_ai/qwen3.5-abliterated:9b` | same model | 98% | 1.3 / 2.0 | 26 | 8.5 GB | best brain; eyes hallucinated a person, 3.4 s per description; accuracy option |
| `huihui_ai/qwen3.5-abliterated:9b` | Qwen3-VL 8B | 96% | 1.3 / 2.0 | 26 | 14.5 GB | fits alone, no room for the foreign model |
| `huihui_ai/qwen3.5-abliterated:9b` | `qwen2.5vl:3b` | 96% | 1.3 / 1.9 | 26 | over budget | evicted during the pair check |
| `huihui_ai/qwen3-abliterated:8b` | Qwen3-VL 8B | 94% | 0.5 / 0.7 | 44 | 11.6 GB | |
| `richardyoung/qwen3-14b-abliterated:q4_K_M` | - | 84% | 1.1 / 1.6 | 24 | 8.9 GB | shrugs at everything; no thinking capability |

## Results, 3 Nov 2026 (Ollama 0.40.13, after the upgrade that made Gemma 4 loadable)

Same 72 steps, 5 runs, unified pair check per row. Resident sizes shrank on the new engine, so do not compare GB with the table above.

| Brain | Eyes | Strict | p50 / p95 s | tok/s | Resident | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **`huihui_ai/qwen3-vl-abliterated:8b-instruct`** | **same model** | **95%** | **0.4 / 0.7** | **42** | **5.3 GB** | still the default |
| `huihui_ai/qwen3.5-abliterated:9b` | same model | 96% | 1.9 / 2.3 | 39 | 5.1 GB | 98% on 0.24; one reload mid-run |
| `huihui_ai/gemma-4-abliterated:12b` | same model | 94% | 3.0 / 3.4 | 26 | 7.3 GB | re-evaluates the whole 660-token prompt every call (2.4 s of the 3.0); invented a person in the empty car interior |
| `huihui_ai/gemma-4-abliterated:12b-qat` | same model | 94% | 3.0 / 3.4 | 26 | 7.7 GB (`/api/ps` says 0.4) | identical answers to the non-qat build |
| `huihui_ai/gemma-4-abliterated:12b` | Qwen3-VL 8B | 71% (4 cases) | 3.1 | 26 | evicted | 0.40's scheduler refused to hold both with 4 GB of system RAM free |

Gemma 4 misses: "are you there" → words without a nod, "hmm, let me think" → shrug, "don't wave at me" → wave, "did you see me come in" → words only. Its latency is structural: Qwen3-VL reuses the cached system prompt (0.1 s prompt eval), Gemma 4's sliding-window attention makes llama.cpp re-process it (2.4 s), so it misses the 3 s budget on every reply.

Systematic misses (same every run): Qwen3-VL: "don't wave at me" → wave, "where did I leave my keys" → point, "hmm, let me think" → shrug, "did you see me come in" → words only. 9B: "stay still and tell me 2+2" → rest, "how many bodies" → shrug, "person at the left edge of the frame" → look_right. Old 8B: "where did I leave my keys" → look_right, "how many bodies" → rest, greetings sometimes silent.

## Prompt tuning, 3 Nov 2026 (Qwen3-VL 8B, Ollama 0.40.13, 97 steps x 5 runs unless noted)

The 2 Nov prompt was tuned one rule at a time against its own failures, with five held-out groups (`stt`, `neg2`,
`ind2`, `multi`, `vision2`, 25 cases) written before tuning started and a sixth (`fresh`, 22 cases) written after
it ended. Each row is a full run; "new" marks a miss the previous row did not have.

| Prompt | Strict | Misses (every run unless noted) |
| --- | --- | --- |
| v1, the 2 Nov prompt | 94% | keys → point, "hmm, let me think" → shrug, "don't wave" → wave 2/5, "never mind" → wave, kitchen → look_right, "did you see me come in" → no nod |
| v2: five rules (negation, filler, questions in words, yes → nod, STT noise) | 97% | "cheers, see you tomorrow" → no wave (new), kitchen 3/5, no nod |
| v3: goodbye rule, yes-answer example instead of the rule alone | 98% | "stay still and tell me 2+2" → nod (new), kitchen 4/5, one wave at p=0.54 |
| v4: v3 + "stay still" rule + head-turn rule | 98% | "a man pointing" → point (new), kitchen |
| **v5: v3 + "stay still" + "never guess a direction"** | **100%** | none, every group 100% |
| v5 on the 22 `fresh` cases written afterwards | 95% | "pete can you not your head" → no nod (91% before "Freeze" was allowed to answer with rest, like "don't move") |
| v5 at temperature 0, 3 runs | 98% | the same fresh miss only |
| v5 on `huihui_ai/qwen3.5-abliterated:9b`, 3 runs | 97% | "what is your name" → wave, "where's my car" → point, "freeze" → wave; p50 2.0 s |

What the ladder taught: the model follows examples more reliably than rules (the yes → nod rule did nothing until an
example carried it); each new rule can break a neighbour (v2 lost goodbyes, v4 started pointing at pointers), so a
full run after every change is the only way to know; and the rules that stuck are the narrow ones.

Time-to-gesture with `--stream`: 0.24 s p50 against 0.4 s for the full reply, 0 early mismatches in 485 calls. The
orchestrator fires the gesture at that moment and speaks when the line arrives.

Confidence (joint probability of the gesture tokens, from logprobs): on Qwen3-VL it is 0.97-0.99 when right and
0.85-0.99 when wrong, so a veto changes nothing. On the 9B it is 0.94 when right and 0.47 when wrong;
`PEAK_MIN_CONFIDENCE=0.6` would fix five of its six misses and break one (98.3%). Off by default.

## Sensed events, 5 Nov 2026 (Qwen3-VL 8B, Ollama 0.40.13, 3 runs)

The body's PIR and ultrasonic sensor now reach the brain as `{"sensed": "..."}` events (`senses/presence.js`). New
groups, written before the prompt changed: `sense` (the two lines presence.js publishes), `sense2` (held out, other
wordings) and `seq.sensed`. Cases can now carry `"silent": true`: strict then also needs no spoken line.

| Prompt | Strict | Misses |
| --- | --- | --- |
| v5, unchanged (133 steps) | 96% | "something came close, 3 cm in front of you" → wave "Hello there!" (`sense` 25%), "blocking the way" → point |
| v6: sensed explained, two examples, rule "one short line and no gesture" | 99% | `sense`, `sense2` 100%; but camera scenes got narrated ("I see a dog sitting on the floor."), unscored until `silent` existed |
| v6 + rule "a see event is never narrated ... gesture null and say null" (143 steps) | 98% | "Thanks Peak, good job" → silent 3/3 (new), "Peak, what are you?" → wave 2/3 (new) |
| v6 + silent example only, no rule | - | dog and dark room still narrated, "a man pointing" → point |
| **v7: v6 + no-narration wording inside the sentence that explains `see`, + one silent example** | **99%** | only the old `fresh.stt_not_head`; every other group 100%, held-out `sense2` and `quiet` included |

The `quiet` group (held out) holds real descriptions from the Pi camera on 5 Nov. Same lesson as the 3 Nov ladder: a
rule that says "say null" spreads; wording placed where the event type is explained stays put.

## Read the table

| Column | Meaning |
| --- | --- |
| Gesture acc | reply gesture was one of the accepted ones for the case |
| Strict | gesture correct and a spoken line present when the case requires one; this is the number to rank by |
| JSON ok | the reply parsed; structured outputs should make this 100%, anything less means a broken template |
| say>200, unknown | lines over the Pi's 200-char limit, gesture names not in gestures.yaml |
| think leak | thinking text leaked into the content (Qwen3.5 and Gemma 4 templates emit it); fix the template with a Modelfile, not the prompt |
| reloads | calls after warm-up with load time over 1 s: the model was evicted mid-run |
| p50 / p95 | wall time per reply as Ollama reports it; the mind budget is about 3 s |
| Resident GB | size from `/api/ps`; "(offloaded)" means part of it ran on the CPU |
| Pair | with `--pair`: both models loaded, both fully on the GPU, brain not reloaded after a vision call; total GB loaded |

The Failures section lists each missed case with what the model answered, per run.

## Add a case

New cases go in a new group written **before** the next round of tuning, so the report's per-group table shows whether a prompt change generalised. Append to `cases.json`: `{ "id": "group.name", "event": { "heard": "..." } | { "see": "..." }, "expect": { "gesture": ["wave", null], "sayRequired": false } }`. `gesture` lists every acceptable answer (`null` = no gesture). The runner refuses a name that is not in `node/gestures.yaml`. Ids are prefixed by group so `--only group` works.

## Eyes

For a model that could be brain and eyes at once, compare its descriptions with the current vision model on real photos, using the same prompt and 640 px size as `vision.js`:

```sh
node bakeoff/brain/eyes.js --models qwen2.5vl:3b,huihui_ai/qwen3-vl-abliterated:8b-instruct --images a.jpg,b.jpg
```

Use photos with and without people: the prompt asks about people, and the small models invent them.

## Pitfalls seen

- The live Ollama log is `/opt/homebrew/var/log/ollama.log`, not `~/.ollama/logs`. Ollama 0.24.0 could not load Gemma 4 (`unknown model architecture: 'gemma4'`); 0.40.13 can.
- Ollama 0.40 runs Qwen3-VL on llama-server instead of its own engine: the brain got faster and smaller (0.4 s, 5.3 GB) but a fresh photo takes 5.6 s to describe instead of 1.8 s (1103 image tokens at 230 tok/s versus 506 at 320). Frame size does not help (same at 448 px); the encoder is on Metal. A repeated image is cached (0.6 s).
- Ollama 0.40's scheduler also counts free *system* memory ("predicted to exceed available memory, evicting" with `system_free` in the log). With a few GB free it will not hold a second 7 GB model even when the GPU has room, so split brain/eyes pairs that passed on 0.24 now evict. Unified mode is unaffected.
- `/api/ps` reports 0.4 GB for `gemma-4-abliterated:12b-qat`; the runner process is really 7.7 GB (`ps -o rss`).
- `qwen2.5vl:3b` is 3.2 GB on disk but 10.4 GB resident (vision encoder plus image KV), so "brain + 3B eyes" costs about 16 GB of the roughly 17.8 GB the GPU gets. That is what evicts models here, not the brain size.
- Another program loads `qwen3:14b` (12 GB) into the same server. If it shows up under "Other models loaded during pair checks", the reload counts and p95 of that run are contaminated; rerun.
- Failures are systematic at temperature 0.3: the same case fails every run. More runs do not change the ranking; more cases do.

## Ceiling test

`huihui_ai/qwen3.5-abliterated:27b` (17 GB) exceeds the roughly 16 GB the GPU gets on this 24 GB Mac and partly offloads to the CPU. Run it alone, without `--pair`, only to see how much the size class costs: `npm run bakeoff:brain -- --models huihui_ai/qwen3.5-abliterated:27b --runs 1`.

## Eyes field, 5 Nov 2026 (Qwen3-VL 8B, 157 cases + 35 sequence steps x 3 runs)

The reply shape grows to `{gesture, eyes, say}`, where `eyes` names a trick from `tricks/tricks.yaml` or is null.
44 cases and the `seq.eyes` sequence were written and committed before the prompt changed: tuning groups `eyes`
and `trick`, held-out `eyes2`, `trick2`, `eyesneg` and `cross`. A case's `"eyes"` list counts toward strict; the
"eyes unasked" column counts eyes moved in cases that say nothing about them. Run with `PEAK_BRAIN_EYES=1` in front,
or the prompt has no eyes in it.

The mind and vision were left running during all four runs, so the timings are noisier than the tables above
(the 3.4 s p95 is calls queued behind a camera description). Accuracy is not affected.

| Prompt | Strict | Old 143 steps | Eyes right | p50 / p95 ms | Gesture p50 ms | What changed |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline, no eyes field | 474/576 | 426/429 | 48/147 | 457 / 821 | 251 | only the old `fresh.stt_not_head`; the new cases fail for having no eyes |
| v1: an Eyes section listing the tricks, three rules, four examples | 564/576 (98%) | 424/429 | 147/147 | 565 / 1070 | 249 | old: `fresh.night` ("night night") loses its wave 2/3, with sleepy eyes and "Sweet dreams!". New cases: `eyes.fact` nods while answering 2+2 (3/3), `cross.still_angry` look_left (3/3, as in the baseline), `trick.goodnight` rest 1/3 |
| v2: v1 with "Nod and give me a wink" swapped for "Point at the door and look surprised", plus a goodnight example | 561/576 (97%) | 423/429 | 147/147 | 577 / 3388 | 254 | `fresh.night` fixed; new: `seq.chat.1` waves 3/3 (an old sequence), `eyes.surprised` look_left 3/3 (the new example's doing) |
| v3: v1 plus only the goodnight example | 564/576 (98%) | 423/429 | 147/147 | 575 / 1274 | 251 | `fresh.night` fixed and `eyes.surprised` right again, so that miss was the point-and-surprised example; but `seq.chat.1` ("Rho, what are you?") still waves 3/3, so that one is the goodnight example, whose gesture is a wave |

The eyes themselves were never wrong: 147 of 147 in all three versions, held-out groups included, 0 early-gesture
mismatches, and the gesture still fires at 0.25 s. The extra 430 prompt tokens cost about 110 ms per reply. Eyes
moved unasked 10 to 13 times in 429 old calls, all of them thanks (happy), a joke (laugh) or goodnight (sleepy).

The gate was "every old group equals the baseline". All three versions missed it by one old case each: v1 loses a
wave ("night night", 2 of 3), and the example that brings it back (v2, v3) adds one ("what are you", 3 of 3), the
pattern this file has recorded twice before. Both misses are a wave more or a wave less, with the right words and
the right eyes. So the field is **off by default** and the code carries v1, which loses the fewest calls.
`PEAK_BRAIN_EYES=1` turns it on. Not tried: a goodnight example whose gesture is null, or a rule instead of an
example.
