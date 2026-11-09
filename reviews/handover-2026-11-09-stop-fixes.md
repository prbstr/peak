You're picking up Peak (~/.openclaw/dev/peak). Read CLAUDE.md first.

## State
Three local commits on top of 349d07d, nothing pushed, `cd mind && npm test` passes (125 tests):
- c61d19c: mind/lib/stop.js. isStrictStop (old isStop, still guards the half-duplex bypass) and isStopIntent (broad; used by the fast lane and by hearing's wake-word gate).
- 91c8353: policy.js route(). A stop is sent up to 60 s late; everything else still drops at 5 s.
- b8ee18c: senses/utteranceQueue.js. Up to 3 utterances wait for whisper, those of 1.5 s or less go first, and when full the longest is dropped and logged.
Brief: reviews/fix-brief-2026-11-09.md. Where the build departed from it: reviews/fix-brief-2026-11-09.claude-review.md.
Leave the uncommitted SHOPPING.md, shopping/, desk-camera-mockup.jpg and devices/desk-light/.gitignore alone.

## Your job: help me live-test it
1. Run `cd mind && npm test` and confirm it passes.
2. Restart mind and hearing so they load the new code:
   launchctl kickstart -k gui/$(id -u)/sh.peak.mind
   launchctl kickstart -k gui/$(id -u)/sh.peak.hearing
   Tail ~/Library/Logs/peak/mind.log and hearing.log and confirm both came up clean.
3. I'll say "Rho, tell me a long story" and say "stop" over it 5 times. Pass = 5/5 stops.
4. In a new story, about 10 s in, I'll say "wait, stop" without the name. Pass = it stops.
5. False-stop checks: "Where is the bus stop?" and "Is that enough?" must NOT stop Rho.
6. After each test, read the logs: stop timings in mind.log, any "queue full" lines in hearing.log. Report pass/fail per test with the log lines as evidence.

## Rules
- Don't touch Ollama models, don't push, don't ssh to the Pi.
- If a test fails, diagnose from the logs and propose a fix before changing code.
- If `claude` reports "Credit balance is too low", unset ANTHROPIC_API_KEY. It's an old key.
- Rollback if needed: git reset to 349d07d (ask me first), then restart both services.
