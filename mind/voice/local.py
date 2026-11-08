#!/usr/bin/env python3
"""peak voice, local: speaks the mind's lines with Kokoro on the Mac's own speaker.

Listens for {"say": "..."} on peak/+/cmd like homepod.py, makes speech with Kokoro (82M, on the GPU through mlx-audio)
one sentence at a time and plays each sentence as soon as it is made, so the first sound does not wait for the whole
line (a long first sentence is cut in two). Publishes a retained peak/mind/speaking, "true" while a line plays and "false" after, for a half-duplex
hearing gate. Run from mind/ with PEAK_VOICE_BACKEND=kokoro: npm run voice
  PEAK_KOKORO_VOICE    Kokoro voice; the first letter is the accent, a US, b UK (default bm_george)
  PEAK_KOKORO_SPEED    speaking rate (default 1.0)
  PEAK_KOKORO_MODEL    Hugging Face repo or folder (default mlx-community/Kokoro-82M-bf16)
  PEAK_BROKER          mqtt://host:port (default mqtt://localhost:1883)
  PEAK_MQTT_USER, PEAK_MQTT_PASSWORD   broker login, when the broker asks for one (unset = anonymous)
"""
import collections, json, os, re, signal, sys, threading, time
from urllib.parse import urlparse

import numpy as np

VOICE = os.environ.get("PEAK_KOKORO_VOICE", "bm_george")
SPEED = float(os.environ.get("PEAK_KOKORO_SPEED", "1.0"))
MODEL = os.environ.get("PEAK_KOKORO_MODEL", "mlx-community/Kokoro-82M-bf16")
BROKER = urlparse(os.environ.get("PEAK_BROKER", "mqtt://localhost:1883"))
MQTT_USER = os.environ.get("PEAK_MQTT_USER") or None
MQTT_PASSWORD = os.environ.get("PEAK_MQTT_PASSWORD") or None
MAX_SAY_CHARS = 200  # matches contracts/cmd.schema.json
STATUS_TOPIC = "peak/mind/voice/status"
SPEAKING_TOPIC = "peak/mind/speaking"
# The line is made in pieces and each piece plays as soon as it is made, so the first sound waits only for the first
# piece: one piece per sentence, and a first sentence longer than FIRST_PIECE_CHARS is cut in two (cut()) (a
# 92-character sentence took 0.65 s to its first sound in one piece on 8 Nov; kokoro_bench.py has the table)
SENTENCES = r"(?<=[.!?])\s+"
FIRST_PIECE_CHARS = 60
BREAKS = r"(?<=[,;:])\s+|\s+(?=(?:and|but|so|or|because|until|when|while|which|if)\b)"


def espeak_from_wheel():
    """Point phonemizer at the espeak-ng inside the espeakng-loader wheel. misaki looks only in one Homebrew folder;
    without espeak a word missing from its dictionary (a name, "Rho") has no sounds and the line fails."""
    import espeakng_loader
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
    EspeakWrapper.set_library(espeakng_loader.get_library_path())
    EspeakWrapper.set_data_path(espeakng_loader.get_data_path())


def model_path():
    """The model's folder: the cached copy when there is one, so a start with no internet still speaks. mlx-audio
    guesses the model type from the name, which a cache folder does not carry, so load_model is told "kokoro"."""
    if os.path.isdir(MODEL):
        return MODEL
    from huggingface_hub import snapshot_download
    try:
        return snapshot_download(MODEL, local_files_only=True)
    except Exception:
        return snapshot_download(MODEL)


def load_kokoro(voice=VOICE):
    """Kokoro loaded and warmed: the first line pays for the phoneme dictionary, the voice pack and the GPU kernels."""
    espeak_from_wheel()
    from mlx_audio.tts.utils import load_model
    model = load_model(model_path(), model_type="kokoro")
    list(model.generate("Ready.", voice=voice, lang_code=voice[0], speed=SPEED))
    return model


def cut(text):
    """The pieces a line is made in: one per sentence, and a first sentence longer than FIRST_PIECE_CHARS cut once,
    after a comma or before a joining word, at the first such break 20 characters in (the first break anywhere when
    none is that far in)."""
    parts = [p for p in re.split(SENTENCES, text.strip()) if p]
    if parts and len(parts[0]) > FIRST_PIECE_CHARS:
        breaks = list(re.finditer(BREAKS, parts[0]))
        brk = next((b for b in breaks if b.start() >= 20), breaks[0] if breaks else None)
        if brk:
            parts[0:1] = [parts[0][:brk.start()], parts[0][brk.end():]]
    return parts


def trim(audio, rate, trail_s, lead_s=0.03, floor=0.01):
    """Kokoro pads each piece with about 0.27 s of silence before and 0.52 s after (kokoro_bench.py, 8 Nov). The pad
    in front would delay the first sound, and two pads between pieces make a 0.8 s gap: keep 30 ms in front and
    trail_s after."""
    loud = np.flatnonzero(np.abs(audio) > floor)
    if not len(loud):
        return audio[:0]
    return audio[max(0, loud[0] - int(lead_s * rate)):loud[-1] + 1 + int(trail_s * rate)]


def pieces(model, text, voice=VOICE, cutter=cut):
    """Float32 audio at model.sample_rate, one trimmed array per piece, each as soon as it is made. A sentence ends
    in a 0.2 s pause, a cut at a comma in 0.1 s, a cut before a joining word in 0.05 s."""
    for part in cutter(text):
        trail = 0.2 if part[-1] in ".!?" else 0.1 if part[-1] in ",;:" else 0.05
        for r in model.generate(part, voice=voice, lang_code=voice[0], speed=SPEED, split_pattern=None):
            yield trim(np.asarray(r.audio, dtype=np.float32).reshape(-1), model.sample_rate, trail)


class Player:
    """One output stream on the default device, open for the life of the process (opening one per line costs time).
    The audio callback plays what has been added and silence when there is nothing; it notes when the first sample
    of a line reaches the speaker."""
    def __init__(self, rate):
        import sounddevice as sd
        self.rate = rate
        self.buf = collections.deque()
        self.lock = threading.Lock()
        self.drained = threading.Event()
        self.drained.set()
        self.first_sound_at = None  # time.monotonic() when the first sample of the current line is heard
        self.stream = sd.OutputStream(samplerate=rate, channels=1, dtype="float32", latency="low",
                                      callback=self._fill)
        self.stream.start()
        self.device = sd.query_devices(self.stream.device)["name"]

    def _fill(self, out, frames, when, status):
        n = 0
        with self.lock:
            if self.buf and self.first_sound_at is None:
                ahead = when.outputBufferDacTime - when.currentTime
                if not 0 <= ahead < 1:  # a host that does not report the times: assume the stream's latency
                    ahead = self.stream.latency
                self.first_sound_at = time.monotonic() + ahead
            while n < frames and self.buf:
                chunk = self.buf[0]
                take = min(frames - n, len(chunk))
                out[n:n + take, 0] = chunk[:take]
                if take == len(chunk):
                    self.buf.popleft()
                else:
                    self.buf[0] = chunk[take:]
                n += take
            out[n:, 0] = 0
            if not self.buf:
                self.drained.set()

    def start_line(self):
        with self.lock:
            self.first_sound_at = None

    def add(self, audio):
        with self.lock:
            self.buf.append(audio)
            self.drained.clear()

    def wait_heard(self):
        """Block until everything added has left the speaker."""
        self.drained.wait()
        time.sleep(self.stream.latency + 0.05)


def main():
    import paho.mqtt.client as mqtt
    t = time.monotonic()
    model = load_kokoro()
    player = Player(model.sample_rate)
    print(f"[voice] kokoro {VOICE} loaded and warm in {time.monotonic() - t:.1f}s; output {player.device!r}, "
          f"latency {player.stream.latency * 1000:.0f} ms", flush=True)

    # One line is spoken at a time and one more may wait; a newer line replaces it, like every queue in peak.
    waiting, wake = [], threading.Condition()

    def on_message(c, u, msg):
        try:
            say = json.loads(msg.payload).get("say")
        except Exception:
            return
        if isinstance(say, str) and say.strip():
            with wake:
                waiting[:] = [(say[:MAX_SAY_CHARS], time.monotonic())]
                wake.notify()

    # Presence like a body's (node/servod.py): retained "online" on every connect, "offline" by the broker's Last Will
    # when this process dies. A broker that is down or goes away is retried, 1 s doubling to 30 s, never fatal.
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    if MQTT_USER:
        client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    client.will_set(STATUS_TOPIC, "offline", qos=1, retain=True)

    def on_connect(c, u, flags, rc, props=None):
        if rc.is_failure:
            print(f"[voice] broker refused: {rc}", flush=True)
            return
        c.subscribe("peak/+/cmd")
        c.publish(STATUS_TOPIC, "online", qos=1, retain=True)
        c.publish(SPEAKING_TOPIC, "false", qos=1, retain=True)

    def speaking(on):
        client.publish(SPEAKING_TOPIC, "true" if on else "false", qos=1, retain=True)

    client.on_connect = on_connect
    client.on_message = on_message
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    # connect_async: the first attempt is made by the loop thread and retried like any later one, so a broker that
    # is not up yet at login does not end the voice
    client.connect_async(BROKER.hostname or "localhost", BROKER.port or 1883, 60)
    client.loop_start()
    print(f"[voice] speaking peak/+/cmd lines on the Mac's {player.device!r} as kokoro {VOICE}", flush=True)

    while True:
        with wake:
            while not waiting:
                wake.wait()
            text, heard_at = waiting.pop()
        t0 = time.monotonic()
        player.start_line()
        started, gaps = False, 0
        try:
            for audio in pieces(model, text):
                if not started:
                    speaking(True)
                    started = True
                elif player.drained.is_set():  # the speaker ran dry before this piece was made: a pause was heard
                    gaps += 1
                player.add(audio)
        except Exception as e:
            print(f"[voice] kokoro failed on {text!r}: {e!r}", flush=True)
        made = time.monotonic() - t0
        if started:
            player.wait_heard()
            speaking(False)
        first = f"{player.first_sound_at - t0:.2f}s" if player.first_sound_at else "none"
        waited = t0 - heard_at
        print(f"[voice] {text!r}: first sound {first}, speech {made:.2f}s, done at {time.monotonic() - t0:.1f}s"
              + (f", {gaps} gap(s) between pieces" if gaps else "")
              + (f", waited {waited:.1f}s behind the line before" if waited > 0.05 else ""), flush=True)


def _exit_on(sig, _frame):
    # a silent death once cost a night's evidence (7 Nov): every way out leaves a line
    print(f"[voice] exiting on {signal.Signals(sig).name}", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    for s in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(s, _exit_on)
    try:
        main()
    except KeyboardInterrupt:
        print("[voice] exiting on SIGINT", flush=True)
    except Exception as e:
        print(f"[voice] crashed: {e!r}", flush=True)
        raise
