# Peak (Rho): architecture review, 9 Nov 2026

**Reviewer:** ARCH-FIVES, for the owner via Monday.
**Commit reviewed:** `349d07d` (`main`, 51 commits ahead of `origin/main`).
**How:** read-only. This file is the only thing written. Nothing was committed, nothing on the Pi was touched, and Peak's Ollama and models were left alone. No tests were run, so the test counts in `CLAUDE.md` are quoted, not re-checked. The only commands run outside reading files were `git status`/`log` and `tmutil destinationinfo`.

**Scope:**
- the safety chain;
- supervision and recovery;
- MQTT;
- hearing and the XVF3800 plan;
- readiness for more bodies and Lupin.

**Ranks:**
- **Blocker:** fix before `PEAK_SIM=1` comes off (real servos), or before relying on the recovery path it names.
- **Should:** fix soon.
- **Nice:** worth doing, not urgent.

## Summary

The 8 Nov review items landed well:
- `cmdcheck.py` and a motion thread that survives bad input;
- the dead-man hold;
- policy rails in code;
- launchd and systemd supervision with appended logs;
- per-role broker logins with ACLs;
- the brain on its own Ollama;
- an honest held-out set (`held1`);
- a real runbook.

**The core design is sound.** The findings below are about **stop paths that can still be dropped**, **commands the dead-man switch doesn't gate**, and **a recovery plan that depends on a repo state that exists only on this Mac**.

| # | Rank | Area | Finding |
|---|---|---|---|
| B1 | Blocker | Recovery | 51 commits unpushed and no Time Machine: a wiped Mac loses the runbook, ACL and launchd setup themselves |
| B2 | Blocker | Safety | The age check runs **before** the fast lane, so a spoken stop older than 5 s is dropped |
| B3 | Blocker | Safety | Hearing's latest-wins queue can replace a waiting "stop" with a later utterance (Rho's echo) |
| B4 | Blocker | Safety | While the dead-man switch is tripped, servod still runs new servo commands |
| B5 | Blocker | Safety | `{"stop":true}` makes every servo go limp; on a mech the arms drop |
| S1 | Should | MQTT | `senses` may write `peak/mind/+/status`, so it can fake "mind online" and defeat the dead-man switch |
| S2 | Should | Safety | A retained "mind online" can outlive a dead mind after a broker restart |
| S3 | Should | Safety | The fast-lane stop matches only exact phrases; "wait, stop", "stop moving" and "stop it now Rho" go to the brain |
| S4 | Should | Recovery | Mac recovery after a power cut needs a person (FileVault); acceptable, but make it visible |
| S5 | Should | Recovery | Both rebuild paths (sections 3 and 4) are unrehearsed; the SD path is cheap to drill |
| S6 | Should | Hearing | XVF3800: AEC only works on audio played through the same device, so the plan must move playback with it |
| S7 | Should | Hive | One global `thinking`/`waiting`/`history` for every body; a stop reaches only the body that heard it |
| N1 | Nice | MQTT | Passwords cross Wi-Fi in clear (no TLS) |
| N2 | Nice | MQTT | Use ACL `pattern … %u` so a new body needs a user, not new ACL lines |
| N3 | Nice | Supervision | `KeepAlive SuccessfulExit=false` leaves a part down after a clean exit 0 |
| N4 | Nice | Lupin | Stage C: the `rho` profile and contract are still to be written; Lupin's own backups sit on the same disk |

---

## 1. Safety chain

### B2. A stale check can drop a spoken stop
**Where:** `mind/orchestrator/index.js:98` runs `stale(event, at, …)` and returns, and only then does `:100` try `lane.match`.

**What happens:** a `heard` event older than `PEAK_EVENT_MAX_AGE_MS` (5 s, `policy.js:12`) is vetoed before anyone looks at whether it's a stop. A stop can arrive late when:
- whisper is busy;
- hearing's single slot is full (B3);
- the Mac is loaded.

**Why it matters:** a stop is the one command that's always safe to run late. This breaks the invariant the hearing code states ("a stop always passes", `senses/hearing.js:81`).

**Fix:** in `index.js`, match `isStop` / the lane's stop **before** the stale check, and make `think()`'s stale check (`:179`) skip stops too. Add a test to `policy.test.js` or an index-level test: a stop with `at` 30 s old still publishes `{"stop":true}`.

### B3. Hearing can replace a waiting stop
**Where:** `mind/senses/hearing.js:74`: `if (busy) { waiting = { pcm, … }; return; }`. One slot, latest wins, and it's raw audio, so whether it's a stop isn't known until it's transcribed.

**Scenario:** while Rho is talking, the owner says "stop" during a transcription. Rho's next echo segment then arrives and replaces the waiting stop. The stop is never transcribed. This is exactly the barge-in situation the half-duplex work targets.

**Fix:** keep a short FIFO (for example 3 utterances, each ~0.4-0.6 s to transcribe) instead of latest-wins. Drop by age only after transcription and the `isStop` check. Test with the existing 144-mix harness: a stop inside a stream of echo segments is published.

### B4. The dead-man switch holds but doesn't gate
**Where:** `node/servod.py:363-371` (`hold` cancels the current and waiting move), `:421-438` (`run_cmd`, no `deadman.alive` check), `deadman.py:7` ("the next command simply runs").

**What happens:** while the mind is offline, any client allowed to write `peak/mech/cmd` still moves servos, and nobody can stop them by voice. Today that's `mind` (the hand scripts, `npm run trick`) and `owner`, per `broker/peak.acl:6-7,38-39`.

**Fix:** in `run_cmd`, refuse `gesture`/`servo` while `not deadman.alive` (log one line), and allow `stop`, `say` and `eyes`. Add a `test_deadman.py` case. If hand control with the mind down is wanted, make it explicit: for example `PEAK_DEADMAN=off` in `peak.env`, logged at start.

### B5. Stop makes the servos go limp
**Where:** `servod.py:422-426` (`cancel_motion()` then `servos.release()`). This is already noted as "Stage B: stop will hold, release go limp" in the comment and in `docs/decisions.md`.

**Status:** fine in sim. With real servos, a spoken "stop" drops raised arms. The dead-man path already **holds** (`hold()`), so the two stop paths behave differently.

**Fix before real servos:** `stop` = cancel and hold. Add a separate `{"release":true}` (contract, `cmdcheck.kind`, servod) for limp.

### S1. `senses` can write the mind's status
**Where:** `broker/peak.acl:14`: `topic readwrite peak/mind/+/status` for `senses`. The `+` includes `peak/mind/mind/status`, the topic `deadman.py:14` trusts.

**Risk:** a buggy or compromised sense process can publish a retained "online" and keep the body "alive" after the mind dies, or publish "offline" and freeze it.

**Fix:** list each sense's own topic (`peak/mind/hearing/status`, `…/vision/status`, `…/presence/status`), or use `pattern readwrite peak/mind/%c/status` with matching client ids. Only `mind` writes `peak/mind/mind/status`.

### S2. A stale retained "online"
**Where:** `broker/mosquitto.conf:8` turns on persistence. The mind publishes `online` retained (`index.js:58`) and sets its will to `offline` (`index.js:23`).

**Gap:** if the broker goes down (crash, restart, power cut) and the mind dies or doesn't return before the broker comes back, no will is ever sent for that old connection. The persisted retained "online" is served to servod, so `deadman.alive` is true with no mind.

**Fix, either of:**
- (a) `health` publishes `peak/mind/mind/status = offline` at start when the mind's process isn't up;
- (b) a mind heartbeat (a retained `{at}` every 2 s), with servod treating more than 5 s of silence **during a move** as dead.

(b) also covers a hung mind, which a Last Will never catches.

### S3. Stop matching is exact
**Where:** `fastlane.js:45` (7 exact phrases), `:91` (exact map lookup).

**Rule:** fuzzy matching is right for everything that moves; it's the wrong rule for stop, because a false stop costs nothing.

**Fix:** after `normalize`, treat any utterance whose first or last word is `stop|freeze|halt` (or that contains `stop` and is at most 4 words) as a stop. Keep the `NEGATION` exemption as is. Unit-test "wait stop", "stop moving", "no no stop".

**What's good and must stay:**
- `cmdcheck.py`: a strict whitelist of servo and gesture names, finite `deg`, `ms` in 20-5000, and a stop never refused.
- The cancel counter under `motion_lock` (`servod.py:108-155`) closes the get/clear race.
- The worker catches exceptions and publishes `motion_alive`.
- The 5 s keepalive.
- QoS 0 with clean sessions, so nothing stale is replayed.
- The `stopEpoch` that drops an in-flight reply after a stop (`index.js:42-46,175-177`).
- The policy rails applied to the early gesture as well as the parsed reply.
- The trick action step re-checked in the fast lane (`index.js:144-147`).

## 2. Supervision and recovery

### B1. The recovery source of truth isn't backed up
**Evidence:**
- `git rev-list --count origin/main..main` = **51**, with `origin/main` last at 7 Nov 14:04.
- `tmutil destinationinfo`: "No destinations configured".
- `docs/runbook.md:41-43` restores by `git clone https://github.com/prbstr/peak`, and section 1 relies on "A Time Machine backup".

**Consequence:** a clone today would get a repo with none of:
- `docs/runbook.md` itself;
- `broker/`, `mind/launchd/`, `node/cmdcheck.py` or `deadman.py`;
- the fast lane, the half-duplex hearing;
- the taught lessons since 7 Nov.

**Fix:** this is the owner's call (`CLAUDE.md`: push only on his word).
- Push `main`, or mirror to a private remote if anything must stay private.
- Set up Time Machine; it covers `mind/.env`, the Pi's `peak.env` copies and the Ollama plist edits that git can't.
- Add "unpushed commits > 0" to `npm run status`.

### S4. A power cut needs the owner
**Where:** `docs/runbook.md:9-10,52-55`. This is correctly documented: with FileVault on, the Mac waits at the password, and the user LaunchAgents, Mosquitto (`sh.brew.mosquitto`) and both Ollamas don't start.

**Effect:** the Pi comes back and, with the broker unreachable, its dead-man switch holds. That's the safe state. The trade-off is acceptable for a home robot. Disabling FileVault isn't advised; Lupin's personal data relies on it.

**Fix:** make the down state visible.
- The OLED already shuts its eyes when the broker is gone. Document that "eyes shut after a power cut = log in to the Mac".
- Once the UPS is in (runbook section 6), test a 5-minute cut as written.

### S5. The rebuild paths are unrehearsed
The runbook says so plainly (`docs/runbook.md:186-190`). `pi-firstboot.sh` "has not run on a fresh card" (`scripts/pi-firstboot.sh:5`).

**Fix:** drill section 4 on a spare SD card: about 40 minutes, no risk to mech. Time it and fix what breaks. The Mac rebuild can wait for a real event or a spare user account.

Small items found while reading it:
- **Step 2** rsyncs `pi-firstboot.sh` into `~/peak/node/`. **Step 4's** `deploy-node.sh` then rsyncs `node/` with `--delete` (`scripts/deploy-node.sh:13`) and removes it. That's harmless, but the script then lives only in the repo; note it.
- **Watchdog:** `pi-firstboot.sh:17-20` enables the hardware watchdog with `RuntimeWatchdogSec=10`. Good.
- **SD wear:** logs append to the SD card, with logrotate installed by `deploy-node.sh`. Fine for now. If writes grow, consider `Storage=volatile` for the journal.

### N3. `KeepAlive` on clean exit
**Where:** `mind/launchd/peak.*.plist.template` (for example `peak.vision.plist.template:26-29`) use `SuccessfulExit=false`, so a part that exits 0 stays down until someone runs `npm run up`.

**Fix:** for long-running parts, use `KeepAlive=true`, or make sure every unexpected exit path exits non-zero (`vision.js` already does `exit(1)` when `hands.py` dies).

**What's good:**
- Appended logs with newsyslog.
- A retained status per part, plus `health`.
- systemd `Restart=always`, `StartLimitIntervalSec=0` and `EnvironmentFile` for secrets (`node/peak-servod.service`).
- The pid file for compatibility with the Mac-side commands.
- A runbook that names the machine and marks the owner-only lines.
- The UPS choice, including a step to test the stepped-sine behaviour.

## 3. MQTT security

**The state is good:**
- anonymous clients are refused (`broker/mosquitto.conf:4`);
- one user per role;
- write scopes are narrow for `senses`, `voice` and `mech` (`broker/peak.acl`);
- it was tested on a private broker before the switch (`docs/broker.md`);
- passwords are typed by the owner and live outside git.

What remains:
- **S1** above: the one ACL line that matters for safety.
- **`mind` is `readwrite peak/#`** (`peak.acl:6-7`), and the hand scripts share it. That's acceptable: the mind is the authority. But it means a leaked `mind/.env` is full control. Keep `mind/.env` at mode 600; I didn't check its mode.
- **N1, no TLS.** Passwords and commands are in clear on the Wi-Fi. WPA2 keeps outsiders out, not other devices on the LAN. Add a TLS listener on 8883 for the Pi and ESP32 nodes when a guest or IoT device shares the network. ESPHome and paho both support it.
- **N2.** With more bodies, `pattern read peak/%u/cmd`, `pattern write peak/%u/sense` and `pattern readwrite peak/%u/status` let a new body be added with just `broker-passwords.sh`, and no ACL edit for the common case.

## 4. Hearing

**The current design is right as a stopgap:**
- half-duplex judged by **words**, not by a fixed deaf time (`senses/halfDuplex.js:6-11`);
- a stop always passes (`hearing.js:81-84`);
- a stale "speaking" flag expires after 30 s (`halfDuplex.js:14,36`);
- Silero VAD.

The measured limit is honest: an echo and a request in one utterance, with three software fixes no better on 144 mixes (`CLAUDE.md` item 9).

B3 above is the hearing-side stop risk.

### S6. The XVF3800 plan
The XVF3800 is a good pick: on-chip AEC, 4 mics, beamforming, USB audio in and out. To make it work:

1. **The reference must be the device's own output.** AEC cancels only what the XVF3800 itself plays. Kokoro (`voice/local.py`) must play to the XVF3800's USB output, with its speaker on the JST connector, **not** the Mac speaker. The HomePod backend can never be echo-cancelled; either retire it or keep half-duplex on when it's selected.
2. **Mic and speaker move together.** On the Mac now, hearing reads the XVF3800 locally instead of the Pi's UDP stream, which also removes the uneven Pi→Mac lag that half-duplex fights. On the body later, both playback and capture must be on the Pi, which adds a Mac→Pi audio stream for Kokoro's output and its latency. Plan and measure that hop before moving it.
3. **Pick the processed channel.** The USB firmware exposes processed (AEC/beam) and raw channels. Select the processed one explicitly, by device name and channel index, as the current mic gotcha does (`CLAUDE.md`: "Select it by name, not card number"), and check the sample rate it offers.
4. **Keep half-duplex as a second layer at first.** Lower `ECHO_SHARE` only after measuring. Re-score with the 144-mix harness recorded **through the XVF3800**, plus a live barge-in window: the owner says "stop" over a long line.
5. **The Rho wake rule** may need retuning: beamformed audio transcribes differently.

## 5. Readiness for more bodies and Lupin

**The desk light** is the model for devices:
- data-only declaration (`mind/devices/devices.yaml`);
- its own broker user scoped to `peak/desk-light/#`;
- presence from its own LWT;
- no queuing for an offline device;
- the age and kind rails on actions;
- ESPHome firmware with `!secret`.

The second device is a new YAML block plus an ACL user. Good.

### S7. The mind is single-body in its state
**Where:**
- `index.js:36-40`: one `history`, one `thinking`, one `waiting` for every node. An event from body B replaces body A's waiting event, and the conversation history mixes bodies.
- `senses/lib.js:7`: senses publish as one `PEAK_NODE`.
- `index.js:133`: a spoken stop goes only to the node that heard it.

**Fix when the second body arrives:**
- per-node `waiting` and `history`; one brain call at a time is still fine;
- a spoken stop **broadcast** to every body (`peak/+/cmd` isn't publishable, so loop over `hive.keys()`);
- a per-body sense `NODE`;
- the S2 heartbeat, so each body can tell the mind is gone.

### N4. Lupin
- **The 8 Nov fixes are committed** (lupin `9de538e`..`8075b49`): the write gate on `remember`, fail-closed `LUPIN_PROFILE` (`packages/core-config/src/loadConfig.ts:22-29`), atomic writes, 0700/0600 (`~/.lupin` is `drwx------`) and daily backups.
- **Still to do for Stage C:** no `rho` profile exists yet. The error message lists `owner, monday, group`. There's no contract doc in `peak/docs/`.
- **Contract:** the one in the 8 Nov review (`~/.openclaw/shared/reviews/2026-11-08-peak-lupin-arch-review.md`, step 8) stands:
  - a read-only `rho` profile at sensitivity 0, because Rho speaks aloud;
  - a 300 ms keyword-only prefetch into the user turn, never the system prompt;
  - Rho must work with Lupin down.
- **Lupin's backups share a disk with the database** (`~/.lupin/backups`). The same single-disk risk as B1; Time Machine fixes both.

## Suggested order

1. **B1:** push, or set up a backup. That's minutes, and the owner's call.
2. **B2, B3, B4, S1:** about one session. Each is small, with a unit test, plus a live 60 s barge-in window.
3. **S3, S2.**
4. **B5:** before the servos arrive, together with Stage B.
5. **S5:** the SD drill.
6. **S6:** when the XVF3800 arrives.
7. **S7 and Lupin Stage C:** when a second body or the memory link is next.
