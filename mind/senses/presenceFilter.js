// Decides which sense readings become {"sensed": ...} events.
//
// A body reports its PIR and ultrasonic sensor twice a second. The brain must not think on every reading, only
// on the two moments a person would notice:
//   - movement after the room has been quiet for a while (someone arrived)
//   - something coming close in front, compared with what is normally there
// "Close" is relative on purpose: a sensor resting 8 cm from a wall is not being approached, a hand at 3 cm is.

const QUIET_MS = Number(process.env.PEAK_QUIET_S ?? 60) * 1000;
const NEAR_CM = Number(process.env.PEAK_NEAR_CM ?? 30);
const NEAR_COOLDOWN_MS = Number(process.env.PEAK_NEAR_COOLDOWN_S ?? 10) * 1000;

const NEAR_RATIO = 0.6;      // close means under 60% of the usual distance, and under NEAR_CM
const NEAR_READINGS = 2;     // in a row, so one bad echo is not an approach
const BASELINE_READINGS = 10;
const SETTLE_MS = 30_000;    // something that stays close this long is the new normal

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

export const createPresenceFilter = ({ now = Date.now, quietMs = QUIET_MS, nearCm = NEAR_CM, cooldownMs = NEAR_COOLDOWN_MS } = {}) => {
  let lastMotionAt = null;   // null: nothing seen yet, which counts as quiet
  const usual = [];          // recent distances while nothing was close; Infinity when nothing echoed
  let streak = 0, near = false, nearSince = 0, lastNearAt = -Infinity;

  const motion = (moving, t) => {
    if (!moving) return null;
    const arrived = lastMotionAt === null || t - lastMotionAt >= quietMs;
    lastMotionAt = t;
    return arrived ? 'movement nearby after a quiet spell' : null;
  };

  const distance = (cm, t) => {
    const d = cm ?? Infinity;
    if (!usual.length) { usual.push(d); return null; } // the first reading is what is normally there, not an approach
    const limit = Math.min(nearCm, NEAR_RATIO * median(usual));
    if (d >= limit) {
      streak = 0; near = false;
      usual.push(d);
      if (usual.length > BASELINE_READINGS) usual.shift();
      return null;
    }
    if (near) {
      if (t - nearSince >= SETTLE_MS) { usual.length = 0; usual.push(d); near = false; streak = 0; }
      return null;
    }
    if (++streak < NEAR_READINGS) return null;
    near = true; nearSince = t;
    if (t - lastNearAt < cooldownMs) return null;
    lastNearAt = t;
    return `something came close, ${Math.round(d)} cm in front of you`;
  };

  /** One sense message in, the texts worth an event out (usually none). */
  const consider = sense => {
    const t = now();
    return [motion(sense.motion === true, t), distance(sense.distance_cm, t)].filter(Boolean);
  };

  return { consider };
};
