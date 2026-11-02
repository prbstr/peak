# Brain bake-off

Compares candidate brain models on the same events, through the exact prompt path the orchestrator uses (`orchestrator/brain.js`). Reports gesture accuracy, JSON validity, latency, tokens/s, resident size, and whether the model stays on the GPU next to the vision model.

## Run

Stop the mind and the senses first (`pgrep -f orchestrator/index.js`); anything else talking to Ollama skews the timings and may evict models.

```sh
npm run bakeoff:brain                                                      # every model in models.json, 3 runs per case
npm run bakeoff:brain -- --pair qwen2.5vl:3b                               # also check each brain stays resident next to the eyes
npm run bakeoff:brain -- --models huihui_ai/qwen3-vl-abliterated:8b-instruct --pair huihui_ai/qwen3-vl-abliterated:8b-instruct   # one model as brain and eyes
npm run bakeoff:brain -- --models huihui_ai/qwen3-abliterated:8b --only direct --runs 1   # quick check, under a minute
```

Missing models are pulled (about 6-8 GB each; `--no-pull` to refuse). Each model is unloaded afterwards unless it is the production brain or the `--pair` model. Results land in `results/<timestamp>.md` and `.json` (gitignored), and the table is printed.

Time: 34 cases x 3 runs = 102 calls per model. About 3-4 minutes for an 8B, 5-7 for a 12B or 14B, plus pulls.

## Results, 2 Nov 2026 (M4 Pro, 24 GB, Ollama 0.24.0)

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
| `huihui_ai/gemma-4-abliterated:12b`, `:12b-qat` | - | - | - | - | - | `unknown model architecture: 'gemma4'` on Ollama 0.24.0 |

Systematic misses (same every run): Qwen3-VL: "don't wave at me" → wave, "where did I leave my keys" → point, "hmm, let me think" → shrug, "did you see me come in" → words only. 9B: "stay still and tell me 2+2" → rest, "how many bodies" → shrug, "person at the left edge of the frame" → look_right. Old 8B: "where did I leave my keys" → look_right, "how many bodies" → rest, greetings sometimes silent.

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

Append to `cases.json`: `{ "id": "group.name", "event": { "heard": "..." } | { "see": "..." }, "expect": { "gesture": ["wave", null], "sayRequired": false } }`. `gesture` lists every acceptable answer (`null` = no gesture). The runner refuses a name that is not in `node/gestures.yaml`. Ids are prefixed by group so `--only group` works.

## Eyes

For a model that could be brain and eyes at once, compare its descriptions with the current vision model on real photos, using the same prompt and 640 px size as `vision.js`:

```sh
node bakeoff/brain/eyes.js --models qwen2.5vl:3b,huihui_ai/qwen3-vl-abliterated:8b-instruct --images a.jpg,b.jpg
```

Use photos with and without people: the prompt asks about people, and the small models invent them.

## Pitfalls seen

- Ollama 0.24.0 cannot load Gemma 4 (`unknown model architecture: 'gemma4'`); the live log is `/opt/homebrew/var/log/ollama.log`, not `~/.ollama/logs`. Homebrew has 0.40.x.
- `qwen2.5vl:3b` is 3.2 GB on disk but 10.4 GB resident (vision encoder plus image KV), so "brain + 3B eyes" costs about 16 GB of the roughly 17.8 GB the GPU gets. That is what evicts models here, not the brain size.
- Another program loads `qwen3:14b` (12 GB) into the same server. If it shows up under "Other models loaded during pair checks", the reload counts and p95 of that run are contaminated; rerun.
- Failures are systematic at temperature 0.3: the same case fails every run. More runs do not change the ranking; more cases do.

## Ceiling test

`huihui_ai/qwen3.5-abliterated:27b` (17 GB) exceeds the roughly 16 GB the GPU gets on this 24 GB Mac and partly offloads to the CPU. Run it alone, without `--pair`, only to see how much the size class costs: `npm run bakeoff:brain -- --models huihui_ai/qwen3.5-abliterated:27b --runs 1`.
