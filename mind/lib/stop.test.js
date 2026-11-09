import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStopIntent, isStrictStop } from './stop.js';

test('isStopIntent: the brief\'s cases and the old exact phrases are stops', () => {
  for (const t of [
    'wait stop', 'Wait, stop!', 'stop moving', 'No, no, stop.', 'Stop it now, Rho.', 'Ok, enough.',
    'Stop.', 'Rho, stop!', 'Bro stop', 'Freeze!', 'Halt.', 'Stop, stop!', 'stop that', 'emergency stop',
    "That's enough.", 'Enough already.', 'Rho, stop the dance.', 'Please stop now.', 'Hey Rho, freeze.',
    'Okay Rho stop', 'I said stop', 'Stop the car.', 'Bro stop being so dramatic.',
  ]) assert.equal(isStopIntent(t), true, t);
});

test('isStopIntent: a negated stop, a noun, or a stop word deep in a sentence is not a stop', () => {
  for (const t of [
    "Don't stop.", "Rho, don't stop.", "Don't ever stop.", 'Never stop learning.', "I can't stop laughing.",
    'Where is the bus stop?', 'That was a pit stop.', 'Is that enough?', "I've had enough.", 'Good enough.',
    'Rho, how do I get to the next stop on the train line?', 'Once there was a robot.', 'Rho, wave at me.',
    'Lights off.', '', '[Music]', 'I need to stop at the shops later today.',
  ]) assert.equal(isStopIntent(t), false, t);
});

test('isStrictStop is the old half-duplex isStop, unchanged', () => {
  for (const t of ['Bro stop.', 'Rho, stop!', 'Stop.', 'Stop, stop!', 'Freeze!', 'Stop it.', 'Stop, Bro!']) assert.equal(isStrictStop(t), true, t);
  for (const t of ['Once there was a robot.', 'Stop the car.', 'and solve puzzles.', 'Bro stop being so dramatic.', 'wait stop']) assert.equal(isStrictStop(t), false, t);
});
