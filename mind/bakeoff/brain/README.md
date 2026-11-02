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

## Ceiling test

`huihui_ai/qwen3.5-abliterated:27b` (17 GB) exceeds the roughly 16 GB the GPU gets on this 24 GB Mac and partly offloads to the CPU. Run it alone, without `--pair`, only to see how much the size class costs: `npm run bakeoff:brain -- --models huihui_ai/qwen3.5-abliterated:27b --runs 1`.
