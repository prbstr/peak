#!/usr/bin/env python3
"""peak voice — speaks the mind's lines through an AirPlay speaker (a HomePod).

Listens for {"say": "..."} on peak/+/cmd, turns the text into speech with the macOS `say` command and streams
it to the speaker. The Mac's own sound output is not touched. Run from mind/: npm run voice
  PEAK_SPEAKER       AirPlay name of the speaker, as the Home app shows it (required)
  PEAK_SPEAKER_HOST  its IP address; skips the multicast search (optional)
  PEAK_VOICE         macOS voice, see `say -v '?'` (default Daniel)
  PEAK_BROKER        mqtt://host:port (default mqtt://localhost:1883)
"""
import asyncio, json, os, signal, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.parse import urlparse

import paho.mqtt.client as mqtt
import pyatv
from pyatv.const import Protocol

SPEAKER = os.environ.get("PEAK_SPEAKER")
HOST = os.environ.get("PEAK_SPEAKER_HOST")
VOICE = os.environ.get("PEAK_VOICE", "Daniel")
BROKER = urlparse(os.environ.get("PEAK_BROKER", "mqtt://localhost:1883"))
MAX_SAY_CHARS = 200  # matches contracts/cmd.schema.json
CLIP = Path(tempfile.mkdtemp(prefix="peak-voice-")) / "line.wav"


def synthesize(text):
    """Text to a WAV file. The text goes in on stdin, never as an argument, so a line starting with '-' is not an option."""
    subprocess.run(["say", "-v", VOICE, "-o", str(CLIP), "--data-format=LEI16@44100"],
                   input=text.encode(), check=True, timeout=30)


class Speaker:
    """One AirPlay speaker, connected on first use and reconnected when a stream fails."""
    def __init__(self, loop):
        self.loop = loop
        self.atv = None

    async def connect(self):
        # RAOP (audio) only. Asked for everything, pyatv also opens the AirPlay remote-control channel, which a
        # HomePod refuses without credentials ("Failed to set up remote control channel") and nothing connects.
        found = await pyatv.scan(self.loop, hosts=[HOST] if HOST else None, protocol={Protocol.RAOP}, timeout=3)
        conf = next((c for c in found if c.name == SPEAKER), None)
        if not conf:
            raise RuntimeError(f"no AirPlay speaker named {SPEAKER!r}; found {[c.name for c in found]}")
        self.atv = await pyatv.connect(conf, self.loop)
        print(f"[voice] connected to {conf.name} ({conf.address})")

    async def play(self, path):
        for attempt in (1, 2):
            try:
                if not self.atv:
                    await self.connect()
                await self.atv.stream.stream_file(str(path))
                return
            except Exception as e:
                print(f"[voice] {'retrying after' if attempt == 1 else 'gave up:'} {e}")
                if self.atv:
                    self.atv.close()
                self.atv = None


async def main():
    if not SPEAKER:
        raise SystemExit("set PEAK_SPEAKER to the speaker's AirPlay name (mind/.env)")
    loop = asyncio.get_running_loop()
    speaker = Speaker(loop)
    # One line is spoken at a time and one more may wait; a newer line replaces it, like every queue in peak.
    waiting, wake = [], asyncio.Event()

    def hear(text):
        waiting[:] = [text]
        wake.set()

    def on_message(c, u, msg):
        try:
            say = json.loads(msg.payload).get("say")
        except Exception:
            return
        if isinstance(say, str) and say.strip():
            loop.call_soon_threadsafe(hear, say[:MAX_SAY_CHARS])

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = lambda c, u, flags, rc, props=None: c.subscribe("peak/+/cmd")
    client.on_message = on_message
    client.connect(BROKER.hostname or "localhost", BROKER.port or 1883, 60)
    client.loop_start()
    print(f"[voice] speaking peak/+/cmd lines on {SPEAKER!r} as {VOICE}")

    while True:
        await wake.wait()
        wake.clear()
        if not waiting:
            continue
        text = waiting.pop()
        t0 = time.monotonic()
        try:
            await asyncio.to_thread(synthesize, text)
        except Exception as e:
            print(f"[voice] say failed: {e}")
            continue
        made = time.monotonic() - t0
        await speaker.play(CLIP)
        print(f"[voice] {text!r}: speech {made:.1f}s, done at {time.monotonic() - t0:.1f}s")


def _exit_on(sig, _frame):
    # a silent death once cost a night's evidence (7 Nov): every way out leaves a line
    print(f"[voice] exiting on {signal.Signals(sig).name}", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    for s in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(s, _exit_on)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[voice] exiting on SIGINT", flush=True)
    except Exception as e:
        print(f"[voice] crashed: {e!r}", flush=True)
        raise
