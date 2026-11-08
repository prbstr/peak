# Supervision, logs and health

How Rho's parts are kept running, where they log, and how to see that they are up. Built 8 Nov 2026 (step 1 of the
merged review plan, findings P3 and P9). The dated tests are in `docs/log.md`, "Supervision".

## The picture

```
Mac (launchd, your login)                                      Pi (systemd, at boot)
 sh.peak.whisper  ─┐   sh.peak.ollama-brain: the brain's own Ollama on :11435 (8 Nov), no MQTT status; health probes it                                            peak-servod  ── servod.py (PEAK_SIM=1)
 sh.peak.mind      │  each: /bin/sh run-part.sh <part>          peak-camd    ── camd.sh   ── UDP :5000 ──> vision
 sh.peak.hearing   │        → reads mind/.env                   peak-audiod  ── audiod.sh ── UDP :5001 ──> hearing
 sh.peak.vision    │        → exec the part (same pid)           Restart=always, 3 s; logs appended to ~/peak/<d>.log
 sh.peak.presence  │  KeepAlive unless it exits 0, at most        and rotated by /etc/logrotate.d/peak
 sh.peak.voice     │  once every 10 s; RunAtLoad at login
 sh.peak.health   ─┘  logs appended to ~/Library/Logs/peak/<part>.log, rotated by /etc/newsyslog.d/peak.conf

MQTT, retained
 peak/mind/<part>/status   online on connect, offline by Last Will      (hearing vision presence voice mind health)
 peak/mind/whisper/status  set by health from an HTTP probe            (whisper-server has no MQTT)
 peak/<node>/status        the bodies and devices, as before           (mech, desk-light)
 peak/mind/health          every 30 s: {ok, down[], parts{}, bodies{}, ollama{ok,ms,models}, whisper{ok,ms}, at}
```

Before: `npm run up` started each part with `nohup … > run/<part>.log`, which emptied the log on every start, nothing
restarted a part that died, and `npm run status` guessed with `pgrep`.

## Everyday commands (Mac, from `mind/`)

| Task | Command |
| --- | --- |
| Start what is not running | `npm run up` (or `-- mind vision` for some parts, `-- body` for the Pi) |
| Stop | `npm run down` (or `-- <parts>`); lasts until the next login or `npm run up` |
| What is up | `npm run status`: launchd state, pid and restarts per part, its MQTT status, last log line; bodies; health; the mind's settings line |
| Read a log | `tail -f ~/Library/Logs/peak/mind.log` (every start adds a `[run-part] … starting` line) |
| Restart one part now | `launchctl kickstart -k gui/$(id -u)/sh.peak.vision` |
| Is launchd happy with it | `launchctl print gui/$(id -u)/sh.peak.mind` (`state`, `runs`, `last exit code`) |
| Rewrite the plists (after a node upgrade under nvm) | `sh scripts/install-agents.sh`, then `npm run down -- <part>` and `npm run up -- <part>` |
| Remove a part for good | `sh scripts/install-agents.sh --uninstall <part>` |
| Prove KeepAlive without touching Rho | `sh scripts/install-agents.sh --selftest x`, watch `~/Library/Logs/peak/selftest.log`, then `--uninstall --selftest x` |

A part run by hand (`npm run vision`) has no status topic unless `PEAK_PART=vision` is set, so a one-shot test never
marks a running part offline. `npm run up` refuses to start a part that already runs outside launchd and names its pid.

## What the owner runs with sudo

Nothing here is done by a session: each line needs a password.

1. **Mac, log rotation** (on the Mac, in `mind/`):

   ```bash
   sh scripts/install-agents.sh --newsyslog | sudo tee /etc/newsyslog.d/peak.conf
   ```

   One line per part: rotate at 10 MB, keep 7, bzip2. After the rename newsyslog sends the part signal 31 (SIGUSR2),
   which no part handles, so the part ends as if killed and launchd starts it on a fresh log within 10 s. Restarting
   is the only way: newsyslog cannot copy-and-truncate, and a part that exits cleanly is not restarted. At today's
   rates (about 1 MB a day for the busiest log) that is one restart per part every week or two. Check it with
   `sudo newsyslog -nvf /etc/newsyslog.d/peak.conf`.

2. **Pi, the three units and log rotation** (on the Mac, from the repo root; asks for the Pi's `lupin` password):

   ```bash
   scripts/deploy-node.sh
   ```

   It copies `node/` to the Pi, stops the daemons `npm run up` started by hand (by their pid files), copies
   `peak-servod.service`, `peak-camd.service` and `peak-audiod.service` to `/etc/systemd/system/`, installs
   `node/peak.logrotate` as `/etc/logrotate.d/peak`, then `daemon-reload`, `enable` and `restart`. The same by hand,
   on the Pi after an `rsync` of `node/`:

   ```bash
   sudo cp ~/peak/node/peak-servod.service ~/peak/node/peak-camd.service ~/peak/node/peak-audiod.service /etc/systemd/system/
   ```

   ```bash
   sudo install -m 644 ~/peak/node/peak.logrotate /etc/logrotate.d/peak
   ```

   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now peak-servod peak-camd peak-audiod
   ```

   `peak-servod` carries `Environment=PEAK_SIM=1` until the PCA9685 is wired; remove that line then and run
   `scripts/deploy-node.sh` again. The Mac's address for the streams is `PEAK_MIND=192.168.0.139` in the camd and
   audiod units; to change it without sudo put `PEAK_MIND=…` in `~/peak/peak.env` on the Pi and restart the unit.

3. **Pi, stopping a unit** (on the Pi): `sudo systemctl stop peak-servod`. `npm run down -- body` prints this line for
   each daemon a unit runs, because stopping a system unit needs root.

## Cutover from the nohup parts (once, after this branch is merged)

On the Mac, in `mind/` of the main checkout, with the owner's word, since it restarts every part:

1. `npm run down` stops the old nohup copies by their `run/<part>.pid`.
2. `npm run up` writes the seven plists and bootstraps them. `npm run status` should show every part `running` and
   `online`.
3. Kill `-9` one part (`kill -9 $(cat ~/Library/Logs/peak/vision.pid)`): `npm run status` shows it back within 15 s
   with `runs` one higher, and the log keeps its earlier lines.
4. The owner runs the two sudo steps above. Then a Mac reboot and a Pi reboot, and a 60 s live window ("Rho, wave at
   me") to close the acceptance list in the review.

## Not covered

- Ollama itself is a Homebrew service, not one of these agents; health reports it, nothing here restarts it.
- The broker (Mosquitto, Homebrew service) likewise. Hearing, vision, presence, voice and health retry it with
  backoff from 1 s to 30 s instead of exiting (tested: back 31 s into an outage after 5 attempts); the mind keeps
  mqtt.js's fixed 1 s retry (`index.js` is not part of this change).
- From reading the code, not run: `hearing.js` starts its recorder on every broker connect, with no guard like
  vision's. After a broker outage the second ffmpeg cannot bind UDP :5001 and hearing exits 1; launchd starts it
  again within 10 s. A one-line guard in `hearing.js` would avoid the restart.
- whisper-server dying on SIGUSR2 at rotation is assumed (it installs no handler), not tested: testing it would load a
  second 1.5 GB model beside the live one.
