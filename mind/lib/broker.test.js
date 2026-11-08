import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brokerAuth, roleOf } from './broker.js';

test('no password set: no login, the anonymous broker still works', () => {
  assert.deepEqual(brokerAuth('mind', {}), {});
});

test('the role password from .env logs in as the role', () => {
  assert.deepEqual(brokerAuth('senses', { PEAK_MQTT_PASSWORD_SENSES: 's3' }), { username: 'senses', password: 's3' });
  assert.deepEqual(brokerAuth('senses', { PEAK_MQTT_PASSWORD_MIND: 'm' }), {});
});

test('a user and password set for the part win over the role', () => {
  const env = { PEAK_MQTT_USER: 'voice', PEAK_MQTT_PASSWORD: 'v', PEAK_MQTT_PASSWORD_MIND: 'm' };
  assert.deepEqual(brokerAuth('mind', env), { username: 'voice', password: 'v' });
});

test('each Mac part has its broker user', () => {
  assert.deepEqual(['mind', 'health', 'hearing', 'vision', 'presence', 'voice'].map(roleOf),
    ['mind', 'mind', 'senses', 'senses', 'senses', 'voice']);
});
