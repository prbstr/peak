// The spoken stop, in two strengths. A stop is the one command that is always safe, so anything that drops or
// narrows it is a bug; but where Rho's own voice can be heard, a broad rule would let Rho stop itself.
//   isStrictStop  the whole utterance is a stop: "Bro stop", "Rho, stop!", "Stop, stop." Hearing uses it to let a
//                 stop through over Rho's own line (half-duplex), where echo is the risk.
//   isStopIntent  anything that plainly asks for a stop: "wait, stop", "stop moving", "no no stop", "ok enough".
//                 Used after the echo filter: the wake gate and the fast lane.
// Fix brief 9 Nov 2026, item 1 (ARCH B2, S3).
import { SOUNDS_LIKE, TAGS, normalize } from './utterance.js';

const STOPS = 'stop|freeze|halt';
/** A name next to a stop word, set off by anything or nothing: on 8 Nov whisper wrote "Bro stop" with no comma. */
export const STOP_CALL = new RegExp(`^(?:rho|${SOUNDS_LIKE})[\\s,.!?]+(?:${STOPS})(?:[\\s,.!?]+(?:${STOPS}|it|that|now))*[\\s.!?]*$|^(?:${STOPS})[\\s,.!?]+(?:rho|${SOUNDS_LIKE})[\\s.!?]*$`, 'i');
const BARE_STOP = new RegExp(`^(?:${STOPS})(?:[\\s,.!?]+(?:${STOPS}|it|that|now))*[\\s.!?]*$`, 'i');

/** True when the whole utterance is a stop: "Bro stop", "Rho, stop!", "Stop, stop." */
export const isStrictStop = raw => {
  const text = String(raw).replace(TAGS, ' ').replace(/\s+/g, ' ').trim();
  return STOP_CALL.test(text) || BARE_STOP.test(text);
};

const STOP_WORD = /^(?:stop|freeze|halt)$/;
/** The stop itself negated: "don't stop", "don't ever stop", "I can't stop laughing". Not the fast lane's NEGATION,
 *  which holds "no" and would turn away "no no stop". */
const NEGATED = /\b(?:don't|dont|do not|never|not|can't|cant|won't|wont|didn't|shouldn't)\s+(?:\w+\s+)?(?:stop|freeze|halt)\b/;
/** "stop" as part of a noun: "where is the bus stop". */
const NOUN_STOP = /\b(?:bus|full|pit|truck|non|door)\s+stop\b/;
const ENOUGH = /^(?:enough\b|that's enough$|thats enough$|that is enough$)/;
const MAX_SHORT_WORDS = 4;

/** True when the utterance asks for a stop: the first or last word is stop, freeze or halt; or it says stop in at
 *  most four words; or it opens with "enough" or is "that's enough". Never when the stop is negated. */
export const isStopIntent = raw => {
  const phrase = normalize(raw);
  if (!phrase || NEGATED.test(phrase)) return false;
  if (ENOUGH.test(phrase)) return true;
  const words = phrase.replace(NOUN_STOP, 'noun').split(' ');
  if (STOP_WORD.test(words[0]) || STOP_WORD.test(words.at(-1))) return true;
  return words.length <= MAX_SHORT_WORDS && words.includes('stop');
};
