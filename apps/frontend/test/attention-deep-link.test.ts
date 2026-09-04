import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAttentionDeepLink } from '../src/notifications/attention-deep-link';

void describe('notification attention deep links', () => {
  void it('accepts only the exact Vera Today target shapes', () => {
    const id = 'attention_0123456789abcdef0123456789abcdef';
    assert.deepEqual(parseAttentionDeepLink('vera://attention'), {});
    assert.deepEqual(parseAttentionDeepLink(`vera://attention/${id}`), {
      attentionItemId: id,
    });
    assert.equal(parseAttentionDeepLink('https://example.com'), null);
    assert.equal(
      parseAttentionDeepLink('vera://attention/attention_short'),
      null,
    );
    assert.equal(
      parseAttentionDeepLink(`vera://attention/${id}/unexpected`),
      null,
    );
  });
});
