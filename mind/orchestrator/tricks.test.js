import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gestureNames } from './gestures.js';
import { MAX_MS, MAX_STEPS, appendTrick, createTrickPlayer, loadTricks, trickProblem } from './tricks.js';

const ok = { describe: 'a test trick.', steps: [{ eyes: { mood: 'happy' } }] };
const withSteps = (...steps) => ({ describe: 'a test trick.', steps });
const scratch = () => join(mkdtempSync(join(tmpdir(), 'peak-tricks-')), 'learned.yaml');
const fakeClient = () => {
  const sent = [];
  return { sent, publish: (topic, payload) => sent.push([topic, JSON.parse(payload)]) };
};

test('the shipped tricks load, and none is named like a gesture', () => {
  const tricks = loadTricks({ learned: scratch() });
  assert.deepEqual(Object.keys(tricks), ['happy', 'angry', 'sleepy', 'confused', 'laugh', 'surprised', 'wink', 'peekaboo']);
  for (const [name, trick] of Object.entries(tricks)) {
    assert.equal(trickProblem(name, trick), null, name);
    assert.equal(trick.learned, false);
    assert.ok(!gestureNames.includes(name));
  }
});

test('a trick is checked against the body\'s command contract', () => {
  assert.equal(trickProblem('ok_1', ok), null);
  const bad = [
    ['Happy', ok, /name must be/],
    ['x', ok, /name must be/],
    ['wave', ok, /already a gesture/],
    ['t', null, /name must be/],
    ['trick', { steps: ok.steps }, /describe must be/],
    ['trick', { describe: 'two\nlines', steps: ok.steps }, /describe must be/],
    ['trick', { describe: 'x'.repeat(161), steps: ok.steps }, /describe must be/],
    ['trick', { describe: 'no steps', steps: [] }, /needs 1 to 16 steps/],
    ['trick', withSteps(...Array(MAX_STEPS + 1).fill({ wait: 10 })), /needs 1 to 16 steps/],
    ['trick', withSteps({ wait: MAX_MS }, { wait: 1 }), /waits add up/],
    ['trick', withSteps({ wait: 0 }), /step 1: wait must be/],
    ['trick', withSteps({ wait: 1.5 }), /wait must be/],
    ['trick', withSteps({ dance: true }), /unknown step "dance"/],
    ['trick', withSteps({ eyes: { mood: 'happy' }, wait: 5 }), /exactly one of/],
    ['trick', withSteps({ eyes: {} }), /eyes needs at least one key/],
    ['trick', withSteps({ eyes: { mood: 'ecstatic' } }), /eyes mood must be one of default, tired, angry, happy/],
    ['trick', withSteps({ eyes: { look: 'left' } }), /eyes look must be one of/],
    ['trick', withSteps({ eyes: { anim: 'moonwalk' } }), /eyes anim must be one of/],
    ['trick', withSteps({ eyes: { open: 'yes' } }), /eyes open must be true or false/],
    ['trick', withSteps({ eyes: { colour: 'red' } }), /eyes has no "colour"/],
    ['trick', withSteps({ eyes: { ms: 50 } }), /eyes ms must be a whole number from 100 to 60000/],
    ['trick', withSteps({ eyes: { shape: { height: 99 } } }), /eyes shape height must be a whole number from 8 to 64/],
    ['trick', withSteps({ eyes: { shape: { depth: 3 } } }), /eyes shape has no "depth"/],
    ['trick', withSteps({ eyes: { release: false } }), /eyes release must be true/],
    ['trick', withSteps({ gesture: 'moonwalk' }), /gesture "moonwalk" is not in gestures.yaml/],
    ['trick', withSteps({ say: '' }), /say must be/],
    ['trick', withSteps({ say: 'x'.repeat(201) }), /say must be 1 to 200/],
    ['trick', withSteps('blink'), /exactly one of/],
  ];
  for (const [name, trick, why] of bad) assert.match(trickProblem(name, trick) ?? 'no problem found', why, JSON.stringify(trick));
  assert.equal(trickProblem('trick', withSteps({ gesture: 'wave' }, { wait: 500 }, { say: 'Hi.' }, { eyes: { release: true } })), null);
});

test('a broken built-in trick stops the load', () => {
  const builtin = scratch();
  writeFileSync(builtin, 'grin:\n  describe: "x"\n  steps: [{ eyes: { mood: ecstatic } }]\n');
  assert.throws(() => loadTricks({ builtin, learned: scratch() }), /tricks.yaml: grin: step 1: eyes mood/);
});

test('learned tricks join the built-in ones; bad ones and name clashes are left out with a warning', () => {
  const learned = scratch();
  writeFileSync(learned, [
    'bow:', '  describe: "a small bow."', '  steps: [{ eyes: { look: s } }, { gesture: nod }]',
    'broken:', '  describe: "nope."', '  steps: [{ eyes: { mood: ecstatic } }]',
    'happy:', '  describe: "an impostor."', '  steps: [{ eyes: { mood: angry } }]',
  ].join('\n'));
  const warnings = [];
  const tricks = loadTricks({ learned, warn: w => warnings.push(w) });
  assert.equal(tricks.bow.learned, true);
  assert.deepEqual(tricks.bow.steps, [{ eyes: { look: 's' } }, { gesture: 'nod' }]);
  assert.ok(!('broken' in tricks));
  assert.equal(tricks.happy.steps[0].eyes.mood, 'happy');
  assert.equal(warnings.length, 2);
  assert.match(warnings.join('\n'), /broken ignored: step 1: eyes mood[^]*happy ignored: a built-in trick has that name/);
});

test('an unreadable learned file does not stop the mind', () => {
  const learned = scratch();
  writeFileSync(learned, 'bow: [unclosed');
  const warnings = [];
  assert.equal(Object.keys(loadTricks({ learned, warn: w => warnings.push(w) })).length, 8);
  assert.match(warnings[0], /learned.yaml unreadable/);
});

test('appendTrick remembers a checked trick and refuses a bad or a taken name', () => {
  const learned = scratch();
  assert.equal(appendTrick('bow', 'a small bow.', [{ eyes: { look: 's' } }, { wait: 400 }, { gesture: 'nod' }], { learned }), null);
  assert.equal(appendTrick('salute', 'a salute.', [{ gesture: 'point' }], { learned }), null);
  const tricks = loadTricks({ learned });
  assert.deepEqual(Object.keys(tricks).slice(-2), ['bow', 'salute']);
  assert.deepEqual(tricks.bow, { describe: 'a small bow.', steps: [{ eyes: { look: 's' } }, { wait: 400 }, { gesture: 'nod' }], learned: true });
  assert.match(appendTrick('bow', 'again.', [{ gesture: 'nod' }], { learned }), /has that name already/);
  assert.match(appendTrick('happy', 'again.', [{ gesture: 'nod' }], { learned }), /has that name already/);
  assert.match(appendTrick('spin', 'a spin.', [{ gesture: 'pirouette' }], { learned }), /not in gestures.yaml/);
  assert.equal(Object.keys(loadTricks({ learned })).length, 10);
});

test('the player sends each step to the body in order and waits where told', async () => {
  const client = fakeClient();
  const waits = [];
  const player = createTrickPlayer(client, { tricks: loadTricks({ learned: scratch() }), sleep: async ms => { waits.push([ms, client.sent.length]); } });
  assert.equal(await player.play('mech', 'peekaboo'), true);
  assert.deepEqual(client.sent, [
    ['peak/mech/cmd', { eyes: { open: false, ms: 5000 } }],
    ['peak/mech/cmd', { eyes: { open: true, mood: 'default', shape: { height: 46 }, ms: 1500 } }],
    ['peak/mech/cmd', { say: 'Boo!' }],
  ]);
  assert.deepEqual(waits, [[1200, 1]]);
});

test('the player can leave out a trick\'s own gesture and words, and ignores an unknown trick', async () => {
  const client = fakeClient();
  const tricks = { bow: { describe: 'x', steps: [{ gesture: 'nod' }, { eyes: { look: 's' } }, { say: 'Hi.' }] } };
  const player = createTrickPlayer(client, { tricks, sleep: async () => {} });
  assert.equal(await player.play('rover', 'bow', { skip: ['gesture', 'say'] }), true);
  assert.deepEqual(client.sent, [['peak/rover/cmd', { eyes: { look: 's' } }]]);
  assert.equal(await player.play('rover', 'moonwalk'), false);
  assert.equal(client.sent.length, 1);
});

test('a newer trick takes the body from the one that is playing; other bodies are left alone', async () => {
  const client = fakeClient();
  const gates = [];
  const sleep = () => new Promise(resolve => gates.push(resolve));
  const tricks = {
    slow: { describe: 'x', steps: [{ eyes: { mood: 'tired' } }, { wait: 1000 }, { eyes: { open: false } }] },
    quick: { describe: 'x', steps: [{ eyes: { mood: 'happy' } }] },
  };
  const player = createTrickPlayer(client, { tricks, sleep });
  const first = player.play('mech', 'slow');
  const other = player.play('rover', 'slow');
  assert.equal(await player.play('mech', 'quick'), true);
  gates.forEach(open => open());
  assert.equal(await first, false);
  assert.equal(await other, true);
  assert.deepEqual(client.sent.filter(([topic]) => topic === 'peak/mech/cmd').map(([, cmd]) => cmd),
    [{ eyes: { mood: 'tired' } }, { eyes: { mood: 'happy' } }]);
  assert.equal(client.sent.filter(([topic]) => topic === 'peak/rover/cmd').length, 2);
});

test('stop drops the trick and hands the eyes back', async () => {
  const client = fakeClient();
  const gates = [];
  const tricks = { slow: { describe: 'x', steps: [{ eyes: { mood: 'tired' } }, { wait: 1000 }, { eyes: { open: false } }] } };
  const player = createTrickPlayer(client, { tricks, sleep: () => new Promise(resolve => gates.push(resolve)) });
  const playing = player.play('mech', 'slow');
  player.stop('mech');
  gates.forEach(open => open());
  assert.equal(await playing, false);
  assert.deepEqual(client.sent.map(([, cmd]) => cmd), [{ eyes: { mood: 'tired' } }, { eyes: { release: true } }]);
});
