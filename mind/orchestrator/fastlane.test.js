import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEGATION, buildTemplates, createFastLane, normalize } from './fastlane.js';

const all = {
  gestures: ['rest', 'wave', 'point', 'nod', 'shrug', 'look_left', 'look_right'],
  tricks: ['happy', 'angry', 'sleepy', 'confused', 'laugh', 'surprised', 'wink', 'peekaboo'],
  actions: ['light_on', 'light_off', 'light_bright', 'light_dim', 'light_warm', 'light_cool'],
  enabled: true,
};
const lane = createFastLane(all);
const kindName = text => { const m = lane.match(text); return m && `${m.kind}:${m.name}`; };

test('normalize strips the wake word, a greeting, politeness and punctuation', () => {
  assert.equal(normalize('Bro, lights off please.'), 'lights off');
  assert.equal(normalize('Hey Rho, can you wave at me?'), 'wave at me');
  assert.equal(normalize('Row. Stop!'), 'stop');
  assert.equal(normalize('Turn the lights on, Rho.'), 'turn the lights on');
  assert.equal(normalize('Okay, Roe, just dim the lights now.'), 'dim the lights');
});

test('stop in its spoken forms', () => {
  for (const t of ['Rho, stop!', 'Stop.', 'Bro stop', 'Freeze!', 'Rho, stop it.', 'Stop, stop!']) assert.equal(kindName(t), 'stop:stop', t);
});

test('exact commands map to their gesture, trick or action', () => {
  assert.equal(kindName('Rho, wave at me.'), 'gesture:wave');
  assert.equal(kindName('Row, look left.'), 'gesture:look_left');
  assert.equal(kindName('Rho, give me a wink.'), 'trick:wink');
  assert.equal(kindName("Rho, let's play peekaboo!"), 'trick:peekaboo');
  assert.equal(kindName('Bro, lights off.'), 'action:light_off');
  assert.equal(kindName('Switch the light on, Rho.'), 'action:light_on');
  assert.equal(kindName('Rho, dim the lights please.'), 'action:light_dim');
  assert.equal(kindName('Warmer.'), 'action:light_warm');
});

test('anything that is not a whole template goes to the brain', () => {
  for (const t of [
    "Rho, don't turn the light off.", 'No need to wave.', 'Never mind the lights.', 'Rho, wave at the postman.',
    'Lights off in an hour.', 'My kid waved at the bus.', 'I bought a new lamp today.', 'Can you stop the music?',
    "Don't stop.", 'Rho, what is two plus two?', 'Turn off the lights after the movie.', 'Is it cooler outside?',
    'Rho, how are you?',
  ]) assert.equal(lane.match(t), null, t);
});

test('a bare command word is enough', () => {
  assert.equal(kindName('Wave.'), 'gesture:wave');
  assert.equal(kindName('Nod.'), 'gesture:nod');
});

test('no template but stop contains a negating word, so a match is never a negated request', () => {
  for (const [phrase, hit] of buildTemplates(all)) if (hit.kind !== 'stop') assert.ok(!NEGATION.test(phrase), phrase);
});

test('the reply has the brain\'s fields and says nothing', () => {
  assert.deepEqual(lane.match('Rho, lights off').reply, { gesture: null, eyes: null, action: 'light_off', say: null });
  assert.deepEqual(lane.match('Rho, wink').reply, { gesture: null, eyes: 'wink', action: null, say: null });
  assert.deepEqual(lane.match('Rho, stop').reply, { gesture: null, eyes: null, action: null, say: null });
});

test('only what the mind has: without devices or tricks those commands go to the brain', () => {
  const bare = createFastLane({ gestures: all.gestures, enabled: true });
  assert.equal(bare.match('lights off'), null);
  assert.equal(bare.match('wink'), null);
  assert.deepEqual(bare.match('wave').reply, { gesture: 'wave', say: null });
  assert.equal(bare.match('stop').kind, 'stop');
});

test('PEAK_FAST_LANE=0 turns every match off, stop included', () => {
  assert.equal(createFastLane({ ...all, enabled: false }).match('Rho, stop'), null);
});
