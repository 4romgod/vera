import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { splitSpeech } from '../src/voice/split-speech.ts';

void describe('spoken reply chunking', () => {
  void it('normalizes one short utterance and ignores empty input', () => {
    assert.deepEqual(splitSpeech('  Hello from Vera.  '), ['Hello from Vera.']);
    assert.deepEqual(splitSpeech('   '), []);
  });

  void it('splits long replies without losing or reordering words', () => {
    const words = Array.from(
      { length: 900 },
      (_, index) => `word${String(index)}`,
    );
    const chunks = splitSpeech(words.join(' '));

    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.length <= 2_800));
    assert.deepEqual(chunks.join(' ').split(' '), words);
  });

  void it('prefers sentence boundaries for long spoken replies', () => {
    const firstSentence = `${'a'.repeat(2_700)}.`;
    const chunks = splitSpeech(`${firstSentence} ${'b'.repeat(200)}`);

    assert.equal(chunks[0], firstSentence);
    assert.equal(chunks[1], 'b'.repeat(200));
  });
});
