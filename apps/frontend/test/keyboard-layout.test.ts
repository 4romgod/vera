import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { keyboardAvoidingBehavior } from '../src/components/assistant/keyboard-layout.ts';

void describe('assistant keyboard layout', () => {
  void it('keeps the composer above native keyboards', () => {
    assert.equal(keyboardAvoidingBehavior('android'), 'padding');
    assert.equal(keyboardAvoidingBehavior('ios'), 'padding');
  });

  void it('leaves web layout unchanged', () => {
    assert.equal(keyboardAvoidingBehavior('web'), undefined);
    assert.equal(keyboardAvoidingBehavior(undefined), undefined);
  });
});
