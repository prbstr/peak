// What hearing and the mind share about a transcript: the name's sound-alikes, the tags whisper adds, and the
// normal form the fast lane and the stop matcher read. One copy, so the wake gate and the fast lane cannot drift.

/** What whisper writes for "Rho". bro added 7 Nov 2026 at the owner's word (whisper wrote every Rho that evening as
 *  Bro); road 8 Nov ("Road, tell me a long story"). */
export const SOUNDS_LIKE = 'row|roe|ro|roh|rowe|roll|bro|road';
/** Stage directions and sound tags: [Music], (laughs), *burp*. */
export const TAGS = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;

const WAKE = `rho|${SOUNDS_LIKE}`;
const LEAD = new RegExp(`^(?:(?:hey|hi|hello|okay|ok|yo)[\\s,!.]+)?(?:${WAKE})(?:[\\s,.!?]+|$)`, 'i');
const TAIL = new RegExp(`[\\s,]+(?:${WAKE})[\\s.!?]*$`, 'i');
const POLITE_HEAD = /^(?:please|can you|could you|will you|would you|just|now|okay|ok)\s+/;
const POLITE_TAIL = /\s+(?:please|now|for me|thanks|thank you)$/;

/** Lower case, wake word and politeness gone, punctuation gone: "Bro, lights off please." -> "lights off". */
export function normalize(text) {
  let s = String(text).replace(TAGS, ' ').replace(/[‘’]/g, "'").trim();
  s = s.replace(LEAD, '').replace(TAIL, '');
  s = s.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (let before = ''; before !== s;) {
    before = s;
    s = s.replace(POLITE_HEAD, '').replace(POLITE_TAIL, '').trim();
  }
  return s;
}
