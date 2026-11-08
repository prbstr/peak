// Half-duplex hearing: Rho does not answer itself. The Pi mic hears every line from the Mac speaker, and inside the
// 8 s attention window after a request the echo passed as a new request and the brain answered it (8 Nov 2026, 20:51).
// The voice (voice/local.py) publishes the line on peak/mind/said as it starts and holds a retained
// peak/mind/speaking, "true" while it plays and "false" after.
//
// The Pi-to-Mac stream is late by an uneven amount: on 8 Nov 21:13 an echo's last sound reached hearing from 0.5 s
// before to 0.9 s after "false", and one more than 0.8 s after. A deaf time long enough for every echo also swallowed
// the owner answering straight after a short line ("Rho, wave at me" after "Four.", 21:11). So the judge is the words:
// an utterance heard while a line plays or within ECHO_TAIL_MS after it is Rho's own when most of its words are words
// of that line. A stop is never an echo (hearing checks that first). A line whose text never came is judged by time
// alone: dropped when the loud part lies wholly inside the line and its tail.
//   PEAK_ECHO_TAIL_MS    how long after "false" the mic may still carry the line (default 2000)
//   PEAK_ECHO_SHARE      the share of an utterance's words found in the line that makes it an echo (default 0.5)
//   PEAK_SPEAKING_MAX_MS a "true" older than this is stale (a voice that died mid-line; default 30000)
export const ECHO_TAIL_MS = Number(process.env.PEAK_ECHO_TAIL_MS ?? 2000);
export const ECHO_SHARE = Number(process.env.PEAK_ECHO_SHARE ?? 0.5);
export const SPEAKING_MAX_MS = Number(process.env.PEAK_SPEAKING_MAX_MS ?? 30000);
const KEEP = 20; // spoken lines remembered

// whisper writes Rho as row, roe, bro...; and digits for number words
const SOUNDS_LIKE = new Set(['rho', 'row', 'roe', 'ro', 'roh', 'rowe', 'roll', 'bro', 'road']);
export const words = text => (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).map(w => (SOUNDS_LIKE.has(w) ? 'rho' : w));

/** The share of `heard`'s words that are words of `line` (0 to 1). */
export const share = (heard, line) => {
  const h = words(heard);
  if (!h.length) return 0;
  const l = new Set(words(line));
  return h.filter(w => l.has(w)).length / h.length;
};

export const createHalfDuplex = ({ now = Date.now, tailMs = ECHO_TAIL_MS, minShare = ECHO_SHARE, maxMs = SPEAKING_MAX_MS } = {}) => {
  const lines = []; // [{ from, to, text }] in ms; `to` is null while the line plays
  let nextText = null; // a said that came before its speaking "true"
  const open = () => (lines.at(-1)?.to === null ? lines.at(-1) : null);
  const end = l => l.to ?? Math.min(now(), l.from + maxMs);

  /** The voice's speaking flag changed. */
  const speaking = on => {
    const t = now();
    if (on && !open()) {
      lines.push({ from: t, to: null, text: nextText });
      nextText = null;
      if (lines.length > KEEP) lines.shift();
    }
    if (!on && open()) open().to = t;
  };

  /** The text of the line being spoken (or about to be). */
  const said = text => { if (open() && !open().text) open().text = text; else nextText = text; };

  /** The lines whose time, tail included, touches [from, to]. */
  const near = (from, to) => lines.filter(l => from <= end(l) + tailMs && to >= l.from);

  /**
   * Whether an utterance whose loud part spanned [from, to] and came back as `text` is Rho's own voice.
   * { echo, why } with why saying what decided it, for the log.
   */
  const judge = (from, to, text) => {
    const hits = near(from, to);
    if (!hits.length) return { echo: false };
    const known = hits.filter(l => l.text);
    if (known.length) {
      const best = Math.max(...known.map(l => share(text, l.text)));
      const lag = Math.round(to - end(hits.at(-1)));
      return { echo: best >= minShare, why: `${Math.round(best * 100)}% Rho's words, ended ${lag} ms after the line` };
    }
    const inside = hits.reduce((ms, l) => ms + Math.max(0, Math.min(to, end(l) + tailMs) - Math.max(from, l.from)), 0);
    return { echo: inside >= to - from, why: `no line text, ${Math.round(inside)} of ${Math.round(to - from)} ms inside` };
  };

  return { speaking, said, judge, voiceGone: () => speaking(false) };
};
