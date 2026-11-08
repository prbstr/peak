// peak mind — the safety rails between the brain's reply and the room.
// The prompt asks the brain for the same things, but a prompt is a request, not a guarantee: these run in code,
// after askBrain, so the bake-off scores the brain exactly as before and the rails hold whatever it says.
// Pure functions; index.js applies them and logs each veto. ARCH review 8 Nov 2026, P2 and P8.

const ms = (value, fallback) => {
  const n = Number(value);
  return value != null && value !== '' && Number.isFinite(n) && n > 0 ? n : fallback;
};

/** An event older than this when the mind takes it up is dropped before the brain sees it. */
export const EVENT_MAX_AGE_MS = ms(process.env.PEAK_EVENT_MAX_AGE_MS, 5000);
/** A device action runs only if the brain answered within this long of the event being published. */
export const ACTION_MAX_AGE_MS = ms(process.env.PEAK_ACTION_MAX_AGE_MS, 8000);
/** Desk-camera `doing` text is pasted into the next heard turn; it may read text off a screen, so it is kept short. */
export const DOING_MAX = 200;

/** Age of an event in ms, or null when it carries no `at` (a hand mosquitto_pub, an older sense). */
export function age(at, now) {
  return Number.isFinite(at) ? now - at : null;
}

/** True when the event is too old to answer. No `at` counts as fresh, so a hand-sent event still works. */
export function stale(event, at, now, max = EVENT_MAX_AGE_MS) {
  const a = age(at, now);
  return a != null && a > max;
}

/** The kind of event: heard, see, sensed, or other. */
export function kindOf(event) {
  return ['heard', 'see', 'sensed'].find(k => event && k in event) ?? 'other';
}

/** The vetoes for a reply (or part of one: the early gesture is checked as { gesture }), each { field, why }:
 *  - action only for a heard event, and only within ACTION_MAX_AGE_MS of `at` when the brain is done;
 *  - no gesture for a sensed event (something a few cm from the body: no arm swings at it).
 *  An empty list means everything in the reply may go out. */
export function allowed(event, at, reply, now, { actionMaxAge = ACTION_MAX_AGE_MS } = {}) {
  const vetoes = [];
  const kind = kindOf(event);
  if (reply?.action) {
    const a = age(at, now);
    if (kind !== 'heard') vetoes.push({ field: 'action', why: `${reply.action} from a ${kind} event (actions only follow speech)` });
    else if (a != null && a > actionMaxAge) vetoes.push({ field: 'action', why: `${reply.action} ${(a / 1000).toFixed(1)} s after the words (limit ${actionMaxAge / 1000} s)` });
  }
  if (reply?.gesture && kind === 'sensed') vetoes.push({ field: 'gesture', why: `${reply.gesture} for a sensed event` });
  return vetoes;
}

/** The reply with every vetoed field set to null. */
export function apply(reply, vetoes) {
  const out = { ...reply };
  for (const v of vetoes) out[v.field] = null;
  return out;
}

/** The desk camera's text as the mind keeps it. */
export function capDoing(text) {
  return String(text).slice(0, DOING_MAX);
}
