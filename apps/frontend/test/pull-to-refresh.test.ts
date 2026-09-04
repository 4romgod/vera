import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PULL_REFRESH_TRIGGER_DISTANCE,
  pullRefreshDistance,
  shouldTriggerPullRefresh,
} from '../src/components/assistant/pull-to-refresh.ts';

void describe('pull to refresh', () => {
  void it('applies resistance and bounds the visible pull distance', () => {
    assert.equal(pullRefreshDistance(-20), 0);
    assert.equal(pullRefreshDistance(40), 18);
    assert.equal(pullRefreshDistance(1_000), 82);
  });

  void it('refreshes only after the deliberate pull threshold', () => {
    assert.equal(
      shouldTriggerPullRefresh(PULL_REFRESH_TRIGGER_DISTANCE - 1),
      false,
    );
    assert.equal(shouldTriggerPullRefresh(PULL_REFRESH_TRIGGER_DISTANCE), true);
  });
});
