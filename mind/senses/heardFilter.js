// Decides which whisper transcripts become {"heard": ...} events.
//
// A cheap mic in a quiet room gives whisper mostly noise, and it dutifully invents words for it:
// "[BURP]", a bare "Hey.", "Thanks for watching.", whole fluent sentences nobody said. The brain
// answers every one. So the body only listens after its name, like a person does:
//   - an utterance containing the wake word passes, and opens an attention window
//   - inside the window, anything with real words passes (so "Hey Peak" ... "wave at me" works)
//   - outside it, everything is dropped
// Set PEAK_WAKE=off to publish every clean utterance (bench testing).

const WAKE_WINDOW_MS = Number(process.env.PEAK_WAKE_WINDOW_MS ?? 8000);
const WAKE_GATE = (process.env.PEAK_WAKE ?? 'on') !== 'off';

// whisper small hears "Peak" as all of these on this mic
const WAKE = /\b(peak|peek|pete|pique|peke|beak)\b/i;
// stage directions and sound tags, with or without the words around them
const TAGS = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;
// invented on near-silence, or echoes of the server's own prompt hint
const HALLUCINATIONS = /^(thanks? for watching|thank you( so much)?|you|bye|okay|so|the end|subtitles? by.*|\.+)[\s.!,]*$/i;
// a single interjection is a cough or a chair, not a request
const FILLER = /^(hey|oh|yo|huh|hmm+|uh+|um+|ah+|mm+|ok|yeah|yes|no|what|hello|hi)[\s.!,?]*$/i;

export const createHeardFilter = ({ now = Date.now, windowMs = WAKE_WINDOW_MS, gate = WAKE_GATE } = {}) => {
  let attentiveUntil = 0;

  /** Returns the text to publish, or null with a reason in `why`. */
  const consider = raw => {
    const text = raw.replace(TAGS, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return { text: null, why: 'only a sound tag' };
    if (HALLUCINATIONS.test(text)) return { text: null, why: 'hallucination' };
    if (FILLER.test(text)) return { text: null, why: 'lone interjection' };

    const woke = WAKE.test(text);
    const t = now();
    if (woke) attentiveUntil = t + windowMs;
    if (gate && !woke && t >= attentiveUntil) return { text: null, why: 'no wake word' };
    if (!woke && text.split(' ').length < 2) return { text: null, why: 'one word' };
    return { text, why: woke ? 'wake word' : gate ? 'in attention window' : 'gate off' };
  };

  return { consider };
};
