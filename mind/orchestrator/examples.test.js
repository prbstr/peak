// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { EXAMPLES_PATH, SAY_MAX, appendExample, cosine, createBank, exampleProblem, kindOf, lexicalScore, loadExamples, nearest, textOf, words } from './examples.js';

const nowhere = pathToFileURL('/nonexistent/learned.yaml');
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'peak-examples-'));
  const builtin = pathToFileURL(join(dir, 'examples.yaml'));
  writeFileSync(builtin, readFileSync(EXAMPLES_PATH));
  return { builtin, learned: pathToFileURL(join(dir, 'learned.yaml')) };
};
const ok = { event: { heard: 'Wave at me' }, reply: { gesture: 'wave', say: 'Hi.' } };

test('the built-in bank loads 18 examples and every one passes the check', () => {
  const all = loadExamples({ learned: nowhere });
  assert.equal(all.length, 18);
  for (const ex of all) assert.equal(exampleProblem(ex), null, textOf(ex.event));
  assert.equal(all.filter(ex => 'eyes' in ex.reply).length, 4);
  assert.equal(all.filter(ex => 'action' in ex.reply).length, 4);
  assert.ok(all.every(ex => ex.learned === false));
});

test('exampleProblem names what is wrong', () => {
  assert.equal(exampleProblem(ok), null);
  assert.equal(exampleProblem({ event: { sensed: 'a bump' }, reply: { gesture: null, eyes: null, action: null, say: null } }), null);
  assert.match(exampleProblem({ event: { heard: 'a', see: 'b' }, reply: ok.reply }), /exactly one/);
  assert.match(exampleProblem({ event: { felt: 'a' }, reply: ok.reply }), /one of heard, see, sensed/);
  assert.match(exampleProblem({ event: { heard: '' }, reply: ok.reply }), /one line/);
  assert.match(exampleProblem({ event: ok.event, reply: { gesture: 'moonwalk', say: null } }), /gesture must be/);
  assert.match(exampleProblem({ event: ok.event, reply: { gesture: null, eyes: 'grin', say: null } }), /eyes must be/);
  assert.match(exampleProblem({ event: ok.event, reply: { gesture: null, action: 'nuke', say: null } }), /action must be/);
  assert.match(exampleProblem({ event: ok.event, reply: { gesture: null, say: 'x'.repeat(SAY_MAX + 1) } }), /say must be/);
  assert.match(exampleProblem({ event: ok.event, reply: { gesture: null } }), /needs gesture and say/);
  assert.match(exampleProblem({ event: ok.event, reply: { gesture: null, say: null, mood: 'x' } }), /unknown fields/);
  assert.match(exampleProblem('wave'), /must be a map/);
});

test('textOf, kindOf and the word scorer', () => {
  assert.equal(textOf({ heard: 'hi' }), 'heard: hi');
  assert.equal(kindOf({ see: 'x' }), 'see');
  assert.equal(kindOf({ nope: 'x' }), null);
  assert.deepEqual([...words('heard: Rho, wave at me please')], ['wave']);
  assert.equal(lexicalScore('heard: wave at me', 'heard: Rho, wave at me'), 1);
  assert.equal(lexicalScore('heard: wave at me', 'heard: look left'), 0);
  assert.ok(lexicalScore('heard: turn the light on', 'heard: Rho, turn the light on') > lexicalScore('heard: turn the light on', 'heard: dim the light'));
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test('nearest keeps the same kind of event first and returns bank order', () => {
  const ex = [{ event: { heard: 'a' } }, { event: { see: 'b' } }, { event: { heard: 'c' } }, { event: { sensed: 'd' } }, { event: { heard: 'e' } }];
  const scores = [0.1, 0.9, 0.5, 0.9, 0.2];
  assert.deepEqual(nearest(ex, { heard: 'x' }, scores, 3).map(e => textOf(e.event)), ['heard: a', 'heard: c', 'heard: e']);
  assert.deepEqual(nearest(ex, { heard: 'x' }, scores, 2).map(e => textOf(e.event)), ['heard: c', 'heard: e']);
  assert.deepEqual(nearest(ex, { see: 'x' }, scores, 2).map(e => textOf(e.event)), ['see: b', 'sensed: d']);
});

test('a bank picks by embedding, remembers vectors, filters, and falls back to words when the embedding fails', async () => {
  const { builtin, learned } = fresh();
  let calls = 0;
  const embed = async texts => { calls++; return texts.map(t => [t.includes('light') ? 1 : 0, t.includes('wave') ? 1 : 0, 1]); };
  const bank = createBank({ builtin, learned, embed, warn: () => {} });
  assert.equal(bank.examples.length, 18);
  const all = await bank.pick({ heard: 'x' }, { k: 0 });
  assert.equal(all.how, 'all');
  assert.equal(all.examples.length, 18);
  const two = await bank.pick({ heard: 'light please' }, { k: 2, pick: 'embed' });
  assert.equal(two.how, 'embed');
  assert.deepEqual(two.examples.map(e => textOf(e.event)), ['heard: Rho, turn the light on', "heard: Don't touch the light"]);
  assert.equal(calls, 1);
  await bank.pick({ heard: 'light please' }, { k: 2, pick: 'embed' });
  assert.equal(calls, 1, 'nothing new to embed');
  const onlySee = await bank.pick({ see: 'x' }, { k: 2, pick: 'lexical', filter: ex => 'see' in ex.event });
  assert.equal(onlySee.examples.length, 2);
  assert.ok(onlySee.examples.every(e => 'see' in e.event));
  let opts = null, n = 0;
  const warmed = createBank({ builtin, learned, embed: async (texts, o) => { n++; opts = o; return texts.map(() => [1, 1, 1]); }, warn: () => {} });
  await Promise.all([warmed.warm(), warmed.warm()]);
  assert.equal(n, 1, 'one call embeds the whole bank');
  assert.equal(opts.timeoutMs, 0);
  assert.equal(warmed.vectors.size, 18);
  await warmed.pick({ heard: 'new words' }, { k: 2, pick: 'embed' });
  assert.equal(n, 2, 'only the event was new');
  await warmed.warm();
  assert.equal(n, 2, 'nothing left to embed');
  const warnings = [];
  const down = createBank({ builtin, learned, embed: async () => { throw new Error('down'); }, warn: w => warnings.push(w) });
  const r = await down.pick({ heard: 'wave at me' }, { k: 1, pick: 'embed' });
  assert.equal(r.how, 'lexical');
  assert.equal(textOf(r.examples[0].event), 'heard: Rho, wave at me');
  assert.match(warnings[0], /embedding failed \(down\)/);
});

test('a lesson is checked, saved with its date, refused twice, and seen by a running bank at once', async () => {
  const { builtin, learned } = fresh();
  const bank = createBank({ builtin, learned, embed: async () => { throw new Error('no'); }, warn: () => {} });
  assert.equal(bank.examples.length, 18);
  assert.equal(appendExample({ heard: 'Off to bed' }, { gesture: 'wave', eyes: 'sleepy', say: 'Sleep well.' }, { learned, builtin, note: 'test', now: () => new Date('2026-11-07T22:00:00Z') }), null);
  assert.equal(bank.examples.length, 19);
  assert.equal(bank.examples.at(-1).learned, true);
  assert.equal(bank.examples.at(-1).taught, '2026-11-07T22:00:00Z');
  const saved = parse(readFileSync(learned, 'utf8'));
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].reply, { gesture: 'wave', eyes: 'sleepy', say: 'Sleep well.' });
  assert.equal(saved[0].note, 'test');
  assert.match(appendExample({ heard: 'Off to bed' }, { gesture: null, say: null }, { learned, builtin }), /already in the bank/);
  assert.match(appendExample({ heard: 'Rho, wave at me' }, { gesture: null, say: null }, { learned, builtin }), /already in the bank/);
  assert.match(appendExample({ heard: 'x' }, { gesture: 'moonwalk', say: null }, { learned, builtin }), /gesture must be/);
  const picked = await bank.pick({ heard: 'off to bed now' }, { k: 1, pick: 'lexical' });
  assert.equal(textOf(picked.examples[0].event), 'heard: Off to bed');
});

test('a damaged lesson is left out with a warning and the rest still load', () => {
  const { builtin, learned } = fresh();
  writeFileSync(learned, '- event: {heard: fine}\n  reply: {gesture: nod, say: null}\n- event: {heard: bad}\n  reply: {gesture: moonwalk, say: null}\n');
  const warnings = [];
  const all = loadExamples({ builtin, learned, warn: w => warnings.push(w) });
  assert.equal(all.length, 19);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /learned example 2 ignored: gesture must be/);
  writeFileSync(learned, 'not: a list\n');
  assert.equal(loadExamples({ builtin, learned, warn: () => {} }).length, 18);
});
