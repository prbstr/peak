#!/usr/bin/env python3
"""peak node — servo daemon.

Subscribes to peak/<node>/cmd and drives a PCA9685 with eased, clamped moves.
Publishes peak/<node>/sense every few seconds. Runs on a Raspberry Pi 3B.

Set PEAK_SIM=1 to run without hardware (prints moves instead).
"""
import json, os, subprocess, time, threading, math
from pathlib import Path
import yaml
import paho.mqtt.client as mqtt

HERE = Path(__file__).parent
CFG = yaml.safe_load((HERE / "config.yaml").read_text())
GESTURES = yaml.safe_load((HERE / "gestures.yaml").read_text())
NODE = os.environ.get("PEAK_NODE", CFG["node"])
BROKER = os.environ.get("PEAK_BROKER", "localhost")
SIM = os.environ.get("PEAK_SIM") == "1"

# ---------- hardware ----------
class Servos:
    def __init__(self):
        self.pos = {name: s["rest"] for name, s in CFG["servos"].items()}
        if SIM:
            self.kit = None
            return
        from adafruit_servokit import ServoKit
        self.kit = ServoKit(channels=16, address=CFG["i2c_address"], frequency=CFG["servo_hz"])
        lo, hi = CFG["pulse_us"]
        for name, s in CFG["servos"].items():
            self.kit.servo[s["ch"]].set_pulse_width_range(lo, hi)
            self.kit.servo[s["ch"]].actuation_range = CFG["actuation_range"]
        self.write_all()

    def write(self, name, deg):
        s = CFG["servos"][name]
        deg = max(s["min"], min(s["max"], deg))
        self.pos[name] = deg
        if self.kit:
            self.kit.servo[s["ch"]].angle = deg
        else:
            print(f"[sim] {name} -> {deg:.0f}")

    def write_all(self):
        for name, deg in self.pos.items():
            self.write(name, deg)

    def move(self, targets: dict, ms: int):
        """Ease all servos in `targets` from current to target over `ms` (smoothstep)."""
        start = {n: self.pos[n] for n in targets}
        steps = max(1, int(ms / 20))
        for i in range(1, steps + 1):
            t = i / steps
            e = t * t * (3 - 2 * t)
            for n, target in targets.items():
                self.write(n, start[n] + (target - start[n]) * e)
            time.sleep(0.02)

    def gesture(self, name):
        frames = GESTURES.get(name)
        if not frames:
            print(f"[servod] unknown gesture {name}")
            return
        for f in frames:
            ms = f.get("ms", 300)
            targets = {k: v for k, v in f.items() if k != "ms" and k in CFG["servos"]}
            if targets:
                self.move(targets, ms)
            else:
                time.sleep(ms / 1000)

servos = Servos()
lock = threading.Lock()

# ---------- sensors ----------
def read_sense():
    out = {"uptime": time.monotonic(), "pos": servos.pos}
    try:
        out["temp"] = float(Path("/sys/class/thermal/thermal_zone0/temp").read_text()) / 1000
    except Exception:
        pass
    return out

# ---------- speech ----------
MAX_SAY_CHARS = 200  # matches contracts/cmd.schema.json

def speak(text):
    """Placeholder until Piper audio lands. Text goes to espeak-ng as one argv entry, never through a shell."""
    text = text[:MAX_SAY_CHARS].lstrip("-")  # a leading '-' would be read as an option
    if not text.strip():
        return
    if SIM:
        print(f"[sim] say: {text}")
        return
    subprocess.Popen(["espeak-ng", "--", text], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# ---------- mqtt ----------
def on_connect(c, u, flags, rc, props=None):
    print(f"[servod] connected to {BROKER} as {NODE}")
    c.subscribe(f"peak/{NODE}/cmd")

def on_message(c, u, msg):
    try:
        cmd = json.loads(msg.payload)
    except Exception:
        return
    def run():
        with lock:
            if "gesture" in cmd:
                servos.gesture(cmd["gesture"])
            elif "servo" in cmd:
                servos.move({cmd["servo"]: float(cmd["deg"])}, int(cmd.get("ms", 300)))
            elif "say" in cmd:
                speak(str(cmd["say"]))
    threading.Thread(target=run, daemon=True).start()

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"peak-{NODE}")
client.on_connect = on_connect
client.on_message = on_message
client.connect(BROKER, 1883, 60)
client.loop_start()

try:
    while True:
        client.publish(f"peak/{NODE}/sense", json.dumps(read_sense()))
        time.sleep(CFG.get("sense_interval_s", 5))
except KeyboardInterrupt:
    pass
