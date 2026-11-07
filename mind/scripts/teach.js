// Teach Rho by example, without the brain: one event and the reply it deserves, appended to examples/learned.yaml.
// The running mind picks it up on its next event, no restart. Usage:
//   npm run teach                                                        lists what has been taught
//   npm run teach -- "Off to bed, see you tomorrow" --gesture wave --eyes sleepy --say "Sleep well."
//   npm run teach -- --see "a person holding up a mug" --gesture nod --say "Cheers."
//   npm run teach -- "It's fine to leave the light on" --action null --say "It stays on." --note "permission, not a request"
// A bare first argument is something heard; --see and --sensed name the other kinds of event. --gesture and --say
// default to null. Leave --eyes or --action out and the example shows whatever the brain can do; write null to teach
// "nothing there". Afterwards it prints which examples the bank would now pick for that event.
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { K, PICK, appendExample, createBank, textOf } from '../orchestrator/examples.js';
import { visibleExample } from '../orchestrator/brain.js';

const { values: f, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    heard: { type: 'string' }, see: { type: 'string' }, sensed: { type: 'string' },
    gesture: { type: 'string' }, eyes: { type: 'string' }, action: { type: 'string' }, say: { type: 'string' }, note: { type: 'string' },
  },
});
const bank = createBank();
const kinds = ['heard', 'see', 'sensed'].filter(k => f[k] !== undefined);
const text = positionals[0] ?? (kinds.length === 1 ? f[kinds[0]] : undefined);

if (text === undefined) {
  const taught = bank.examples.filter(ex => ex.learned);
  if (!taught.length) console.log('nothing taught yet; the usage is at the top of scripts/teach.js');
  for (const ex of taught) console.log(`${(ex.taught ?? '').padEnd(20)} ${textOf(ex.event)} -> ${JSON.stringify(ex.reply)}${ex.note ? `   # ${ex.note}` : ''}`);
  process.exit(0);
}
if (kinds.length > 1 || (positionals[0] !== undefined && kinds.length)) {
  console.error('one event only: a bare text, or one of --heard, --see, --sensed');
  process.exit(1);
}
const event = { [kinds[0] ?? 'heard']: text };
const val = v => (v === undefined || v === 'null' ? null : v);
const reply = {
  gesture: val(f.gesture),
  ...(f.eyes !== undefined ? { eyes: val(f.eyes) } : {}),
  ...(f.action !== undefined ? { action: val(f.action) } : {}),
  say: val(f.say),
};
const bad = appendExample(event, reply, { note: f.note ?? null });
if (bad) {
  console.error(`not taught: ${bad}`);
  process.exit(1);
}
console.log(`taught: ${textOf(event)} -> ${JSON.stringify(reply)}`);
const how = K > 0 && PICK === 'embed' ? 'embed' : 'lexical'; // by words unless the mind itself picks by embedding
if (how === 'embed') await bank.warm();
const picked = await bank.pick(event, { k: K || 6, pick: how, filter: visibleExample });
console.log(`the bank would now show these ${picked.examples.length} for it (${picked.how}${picked.ms ? `, ${picked.ms} ms` : ''}):`);
for (const ex of picked.examples) console.log(`  ${textOf(ex.event) === textOf(event) ? '*' : ' '} ${textOf(ex.event)} -> ${JSON.stringify(ex.reply)}`);
