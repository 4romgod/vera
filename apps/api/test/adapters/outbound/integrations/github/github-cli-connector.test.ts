import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GitHubCliConnector } from '../../../../../src/adapters/outbound/integrations/github/github-cli-connector.ts';

void describe('GitHub CLI connector', () => {
  void it('advertises only operations enabled in a read-only awareness runtime', () => {
    const connector = new GitHubCliConnector({
      workItemManagementEnabled: false,
    });

    assert.deepEqual(connector.definition.capabilities, ['external_awareness']);
    assert.deepEqual(connector.definition.operations, [
      'notifications_read',
      'pull_request_checks_read',
    ]);
  });

  void it('advertises separately governed issue operations when enabled', () => {
    const connector = new GitHubCliConnector({
      workItemManagementEnabled: true,
    });

    assert.deepEqual(connector.definition.capabilities, [
      'external_awareness',
      'work_item_management',
    ]);
    assert.ok(connector.definition.operations.includes('issues_create'));
  });
});
