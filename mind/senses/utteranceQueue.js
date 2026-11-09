// The utterances waiting while whisper transcribes another. Whether one is a stop is not known until it is
// transcribed, but a spoken stop is short (under about 1.2 s) and Rho's echo is usually long, so:
//   - short ones (<= SHORT_MS of audio) go first, then first come, first served;
//   - at most MAX_WAITING wait; when one more comes, the longest goes, so a short one is never dropped while a
//     long one waits;
//   - nothing is dropped for its age here: the age rule runs in the mind, after the stop check.
// Before 9 Nov one slot held the newest utterance, and Rho's echo could replace a waiting stop (fix brief 9 Nov,
// item 3; ARCH B3). Pure functions over an array of { ms, seq, ... }; hearing.js keeps the state.

export const MAX_WAITING = 3;
export const SHORT_MS = 1500;

/** Add an item; returns { queue, dropped } where dropped is the evicted item or null. */
export function push(queue, item, { max = MAX_WAITING } = {}) {
  const all = [...queue, item];
  if (all.length <= max) return { queue: all, dropped: null };
  // the longest; between equals, the newest, so the earlier one keeps its place
  const victim = all.reduce((a, b) => (b.ms >= a.ms ? b : a));
  return { queue: all.filter(x => x !== victim), dropped: victim };
}

/** Take the next item: the earliest short one, else the earliest. Returns { item, queue }; item is null when empty. */
export function next(queue, { shortMs = SHORT_MS } = {}) {
  if (!queue.length) return { item: null, queue };
  const item = queue.find(x => x.ms <= shortMs) ?? queue[0];
  return { item, queue: queue.filter(x => x !== item) };
}
