import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDefinition } from './server.js';

test('buildDefinition returns a structured response for known words', () => {
  const result = buildDefinition('hello');

  assert.equal(result.word, 'hello');
  assert.match(result.definition, /greeting/i);
  assert.ok(result.example.length > 0);
});

test('buildDefinition falls back gracefully for unknown words', () => {
  const result = buildDefinition('zzzzunknownword');

  assert.equal(result.word, 'zzzzunknownword');
  assert.equal(result.definition, 'Word not found');
  assert.equal(result.example, 'No example');
});
