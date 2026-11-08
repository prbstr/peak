"""peak node: the check every command passes before servod acts on it.

Import-safe: no GPIO, no MQTT, no files read, so it runs in the unit tests on the Mac's Python 3.9 as well as on
the Pi. It follows contracts/cmd.schema.json and the rule in screen.py's on_eyes: a bad command must not stop the
body. servod drops what this refuses, with one log line, and carries on. ARCH review 8 Nov 2026, P1.
"""
import math

MS_MIN, MS_MAX = 20, 5000  # contracts/cmd.schema.json; a huge ms would hold the one-deep motion queue for ever


def kind(cmd):
    """Which command this is, in the order servod dispatches them, or None when it is none of them.
    Any truthy stop is a stop, as servod has always read it: a stop is never refused."""
    if cmd.get("stop"):
        return "stop"
    for k in ("say", "eyes", "gesture", "servo"):
        if k in cmd:
            return k
    return None


def _number(v):
    # bool is an int in Python; JSON true is not an angle
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate_cmd(cmd, servos, gestures):
    """The reason servod must refuse `cmd`, or None when it may run it.

    `servos` and `gestures` are the known names (config.yaml `servos`, gestures.yaml). Checked: a servo it knows,
    a finite `deg`, an integer `ms` from 20 to 5000 when given, a gesture it knows, `say` a string. `say` longer than
    200 characters is cut by servod rather than refused, and the eyes are checked field by field by screen.py.
    Fields a command does not use are ignored, never an error."""
    if not isinstance(cmd, dict):
        return "not a JSON object"
    k = kind(cmd)
    if k is None:
        return "no stop, say, eyes, gesture or servo"
    if k == "stop":
        return None
    if k == "say":
        return None if isinstance(cmd["say"], str) else "say must be a string"
    if k == "eyes":
        return None if isinstance(cmd["eyes"], dict) else "eyes must be an object"
    if k == "gesture":
        g = cmd["gesture"]
        if not isinstance(g, str):
            return "gesture must be a string"
        return None if g in gestures else "unknown gesture %r" % g
    s = cmd["servo"]
    if not isinstance(s, str) or s not in servos:
        return "unknown servo %r" % (s,)
    if "deg" not in cmd:
        return "servo command without deg"
    deg = cmd["deg"]
    if not _number(deg) or not math.isfinite(deg):
        return "deg must be a finite number, not %r" % (deg,)
    if "ms" in cmd:
        ms = cmd["ms"]
        if not isinstance(ms, int) or isinstance(ms, bool) or not MS_MIN <= ms <= MS_MAX:
            return "ms must be an integer from %d to %d, not %r" % (MS_MIN, MS_MAX, ms)
    return None
