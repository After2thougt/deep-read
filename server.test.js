import test from 'node:test';
import assert from 'node:assert/strict';

const backend = await import('./backend/server.js');
const { splitTranslationChunks, splitAtBoundaries } = backend;

test('translation chunking preserves text and order', () => {
  const source = 'First sentence. Second sentence; with a clause.\n\nThird paragraph.';
  const chunks = splitTranslationChunks(source, 25);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), source);
});

test('character fallback preserves an overlong sentence', () => {
  const source = 'a'.repeat(101);
  const chunks = splitAtBoundaries(source, 20);
  assert.equal(chunks.join(''), source);
  assert.ok(chunks.every((chunk) => chunk.length <= 20));
});
