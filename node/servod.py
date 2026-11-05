#!/usr/bin/env python3
"""peak node — servo daemon.

Subscribes to peak/<node>/cmd and drives a PCA9685 with eased, clamped moves.
Publishes peak/<node>/sense every few seconds and peak/<node>/status (retained,
with a Last Will) so the mind knows which bodies are alive. Runs on a Raspberry Pi 3B.

Set PEAK_SIM=1 to run without hardware (prints moves instead).
"""
import json, os, queue, subprocess, time, threading
from pathlib import Path
import yaml
import paho.mqtt.client as mqtt
from screen import Screen

HERE = Path(__file__).parent
CFG = yaml.safe_load((HERE / "config.yaml").read_text())
GESTURES = yaml.safe_load((HERE / "gestures.yaml").read_text())
NODE = os.environ.get("PEAK_NODE", CFG["node"])
BROKER = os.environ.get("PEAK_BROKER", "localhost")
SIM = os.environ.get("PEAK_SIM") == "1"
STATUS_TOPIC = f"peak/{NODE}/status"
BOOT_SETTLE_MS = 1000  # ease to rest on boot: six servos snapping at once browns out the rail

# ---------- hardware ----------
class Servos:
    def __init__(self):
        self.pos = {name: s["rest"] for name, s in CFG["servos"].items()}
        self.stop_flag = threading.Event()
        self.moving = threading.Event()
        self.kit = None
        if SIM:
            return
        from pca9685 import PCA9685
        self.kit = PCA9685(address=CFG["i2c_address"], frequency=CFG["servo_hz"])
        self.settle()

    def settle(self):
        """Bring every servo to rest gently, one at a time, so startup current stays low."""
        for name, s in CFG["servos"].items():
            self.pos[name] = s["rest"]  # unknown real position; easing from rest is the safest assumption
            self.write(name, s["rest"])
            time.sleep(BOOT_SETTLE_MS / 1000 / len(CFG["servos"]))

    def pulse_us(self, deg):
        """Map an angle to a pulse width across the servo's full actuation range."""
        lo, hi = CFG["pulse_us"]
        return lo + (deg / CFG["actuation_range"]) * (hi - lo)

    def write(self, name, deg):
        s = CFG["servos"][name]
        deg = max(s["min"], min(s["max"], deg))
        self.pos[name] = deg
        if self.kit:
            self.kit.set_pulse_us(s["ch"], self.pulse_us(deg))
        else:
            print(f"[sim] {name} -> {deg:.0f}")

    def move(self, targets: dict, ms: int):
        """Ease all servos in `targets` from current to target over `ms` (smoothstep). Stops early on stop()."""
        start = {n: self.pos[n] for n in targets}
        steps = max(1, int(ms / 20))
        for i in range(1, steps + 1):
            if self.stop_flag.is_set():
                return
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
            if self.stop_flag.is_set():
                return
            ms = f.get("ms", 300)
            targets = {k: v for k, v in f.items() if k != "ms" and k in CFG["servos"]}
            if targets:
                self.move(targets, ms)
            else:
                time.sleep(ms / 1000)

    def stop(self):
        """Abort the current move and let every servo go limp."""
        self.stop_flag.set()
        for s in CFG["servos"].values():
            if self.kit:
                self.kit.release(s["ch"])
        if not self.kit:
            print("[sim] stop: all servos released")

servos = Servos()

# ---------- motion queue ----------
# One move at a time, at most one waiting. A newer command replaces the waiting one:
# a robot should do the latest thing it was told, not catch up on a backlog.
motion = queue.Queue(maxsize=1)

def enqueue_motion(cmd):
    try:
        motion.put_nowait(cmd)
    except queue.Full:
        try:
            motion.get_nowait()
        except queue.Empty:
            pass
        motion.put_nowait(cmd)

def motion_worker():
    while True:
        cmd = motion.get()
        servos.stop_flag.clear()
        servos.moving.set()
        try:
            if "gesture" in cmd:
                servos.gesture(cmd["gesture"])
            elif "servo" in cmd:
                servos.move({cmd["servo"]: float(cmd["deg"])}, int(cmd.get("ms", 300)))
        finally:
            servos.moving.clear()

threading.Thread(target=motion_worker, daemon=True).start()

# ---------- sensors ----------
class Sensors:
    """GPIO sensors from config.yaml `sensors`. Real whenever the pins exist, even with PEAK_SIM=1:
    a body with no servos wired yet can still sense. On a machine without GPIO (the Mac) each stays None."""
    def __init__(self):
        cfg = CFG.get("sensors") or {}
        self.ultrasonic = self.open("ultrasonic", cfg, lambda g, c: g.DistanceSensor(
            echo=c["echo"], trigger=c["trig"], max_distance=c.get("max_cm", 400) / 100))
        self.pir = self.open("pir", cfg, lambda g, c: g.MotionSensor(c["out"]))

    @staticmethod
    def open(name, cfg, make):
        if name not in cfg:
            return None
        try:
            import gpiozero, warnings
            # no echo is normal with nothing in range; it would fill the log
            warnings.simplefilter("ignore", gpiozero.DistanceSensorNoEcho)
            return make(gpiozero, cfg[name])
        except Exception as e:
            print(f"[servod] no {name} sensor: {e}")
            return None

    def read(self):
        out = {}
        if self.ultrasonic and self.ultrasonic.value < 1:  # 1.0 is "no echo", not a distance
            out["distance_cm"] = round(self.ultrasonic.distance * 100, 1)
        if self.pir:
            out["motion"] = bool(self.pir.motion_detected)
        return out

sensors = Sensors()

THROTTLED_EVERY_S = 5  # it costs a subprocess, and power does not change as fast as distance does
throttled = {"at": float("-inf"), "value": None}

def read_throttled():
    """Pi firmware power flags as hex, e.g. 0x50005. Bit 0 set means undervoltage right now."""
    if time.monotonic() - throttled["at"] < THROTTLED_EVERY_S:
        return throttled["value"]
    throttled["at"] = time.monotonic()
    try:
        r = subprocess.run(["vcgencmd", "get_throttled"], capture_output=True, text=True, timeout=2)
        throttled["value"] = r.stdout.strip().split("=")[1]
    except Exception:
        throttled["value"] = None
    return throttled["value"]

def read_sense():
    out = {"uptime": time.monotonic(), "pos": servos.pos, **sensors.read()}
    try:
        out["temp"] = float(Path("/sys/class/thermal/thermal_zone0/temp").read_text()) / 1000
    except Exception:
        pass
    flags = read_throttled()
    if flags:
        out["throttled"] = flags
    return out

# ---------- display ----------
HEAL_EVERY_S = 5
FULL_EVERY_S = 60   # the panel cannot be read back, so now and then it is sent everything
FPS_CAP = 15
SWEAT_FPS = 8       # with nothing else moving, falling drops get by on fewer frames
STATS = os.environ.get("PEAK_FACE_STATS")  # "1" logs the cost of drawing; "full" also sends whole frames, to compare
STATS_EVERY_S = 10

class Display:
    """SSD1306 OLED from config.yaml `display`: shows screen.py's eyes. One thread does all the drawing; the
    mqtt thread and the sense loop only tell the screen what happened and wake it. Real whenever it answers
    on I2C, like the sensors. A display that is missing or unplugged mid-run (on the bench it shares its
    pins with the MPU6050) never stops servod."""
    def __init__(self):
        cfg = CFG.get("display") or {}
        self.address = cfg.get("i2c_address")
        self.screen = Screen(cfg)
        self.dev = None
        self.shadow = None  # the panel's memory as we last wrote it; None when we cannot know
        self.full_at = self.checked = float("-inf")
        self.problem = None
        self.held = False
        self.lock = threading.Lock()  # guards the screen
        self.wake = threading.Event()
        self.tally = {"at": time.monotonic(), "frames": 0, "bytes": 0, "send_s": 0.0, "cpu_s": 0.0}
        if self.address is not None:
            threading.Thread(target=self.run, daemon=True).start()

    def tell(self, what, *args):
        """From the other threads: on_gesture, on_say or on_sense, which answers False when nothing changed."""
        with self.lock:
            changed = getattr(self.screen, what)(time.monotonic(), *args)
        if changed is not False:
            self.wake.set()

    def online(self, online):
        with self.lock:
            self.screen.online = online
        self.wake.set()

    def dark(self):
        """True when the panel is switched off. It forgets its setup on a power dip, and any other program that
        drew on it switches it off on the way out, while our frames keep landing in its memory unseen. Bit 6 of
        the SSD1306 status byte is "display off"."""
        from smbus2 import SMBus
        with SMBus(1) as bus:
            return bool(bus.read_byte(self.address) & 0x40)

    def run(self):
        while True:
            wait = HEAL_EVERY_S
            try:
                wait = self.frame(time.monotonic())
                self.problem = None
            except Exception as e:
                if str(e) != self.problem:  # once per problem, not once per frame
                    print(f"[servod] display: {e}")
                self.problem = str(e)
                self.dev = None
            self.wake.wait(wait)
            self.wake.clear()

    def frame(self, now):
        """Draw what changed. Returns how long the picture will keep without being asked again."""
        from luma.core.interface.serial import i2c
        from luma.oled.device import ssd1306
        from PIL import Image, ImageDraw
        import oled
        cpu = time.thread_time()
        check = now - self.checked >= HEAL_EVERY_S
        if check:
            self.checked = now
        if self.dev is None or (check and self.dark()):
            self.dev = ssd1306(i2c(port=1, address=self.address))  # the full setup, which switches it on
            self.shadow = None
            print("[servod] display on")
        # A frame can hold the I2C bus for longer than a servo step lasts, so during a move on real servos
        # the eyes jump to where they were heading and keep still.
        moving = bool(servos.kit) and servos.moving.is_set()
        if moving and self.held:
            return 0.25
        self.held = moving
        img = Image.new("1", (128, 64))
        with self.lock:
            (self.screen.settle if moving else self.screen.update)(now)
            self.screen.draw(ImageDraw.Draw(img))
            fps = FPS_CAP if self.screen.animating(now, sweat=False) else SWEAT_FPS if self.screen.animating(now) else 0
            due = self.screen.next_event(now)
        pages = oled.pack(img)
        if self.shadow is None or now - self.full_at >= FULL_EVERY_S or STATS == "full":
            self.shadow, self.full_at = None, now
        started = time.monotonic()
        sent = oled.send(self.dev, pages, oled.diff(self.shadow, pages))
        send_s = time.monotonic() - started
        self.shadow = pages
        if STATS:
            self.count(now, sent, send_s, time.thread_time() - cpu)
        if moving:
            return 0.25
        if fps:  # leave the bus free a third of the time, whatever its speed
            wait = max(0.005, max(1 / fps, 1.5 * send_s) - (time.monotonic() - now))
            return wait if due is None else min(wait, max(0.0, due - now))
        return HEAL_EVERY_S if due is None else min(HEAL_EVERY_S, max(0.0, due - now))

    def count(self, now, sent, send_s, cpu_s):
        t = self.tally
        t["frames"] += 1
        t["bytes"] += sent
        t["send_s"] += send_s
        t["cpu_s"] += cpu_s
        if now - t["at"] >= STATS_EVERY_S:
            print(f"[servod] face: {t['frames']} frames, {t['bytes']} bytes, {t['send_s']:.2f} s sending, "
                  f"{t['cpu_s']:.2f} s cpu in {now - t['at']:.0f} s")
            self.tally = {"at": now, "frames": 0, "bytes": 0, "send_s": 0.0, "cpu_s": 0.0}

display = Display()

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
    c.publish(STATUS_TOPIC, "online", retain=True)
    display.online(True)

def on_disconnect(c, u, flags, rc, props=None):
    display.online(False)

def on_message(c, u, msg):
    try:
        cmd = json.loads(msg.payload)
    except Exception:
        return
    if not isinstance(cmd, dict):
        return
    if cmd.get("stop"):
        # Drain anything waiting, then abort what is running. Speech is left alone.
        try:
            motion.get_nowait()
        except queue.Empty:
            pass
        servos.stop()
    elif "say" in cmd:
        speak(str(cmd["say"]))  # independent of motion, so a line is never held up by a wave
        display.tell("on_say", str(cmd["say"])[:MAX_SAY_CHARS])
    elif "gesture" in cmd or "servo" in cmd:
        enqueue_motion(cmd)
        if "gesture" in cmd:
            display.tell("on_gesture", str(cmd["gesture"]))

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"peak-{NODE}")
client.will_set(STATUS_TOPIC, "offline", retain=True)
client.on_connect = on_connect
client.on_disconnect = on_disconnect
client.on_message = on_message
client.connect(BROKER, 1883, 60)
client.loop_start()

try:
    while True:
        sense = read_sense()
        display.tell("on_sense", sense)
        client.publish(f"peak/{NODE}/sense", json.dumps(sense))
        time.sleep(CFG.get("sense_interval_s", 5))
except KeyboardInterrupt:
    pass
finally:
    client.publish(STATUS_TOPIC, "offline", retain=True)
    client.disconnect()
