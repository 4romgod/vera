import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DevelopmentCampaignCatalogSchema } from '../../../src/domain/development-campaigns/development-campaign.ts';

const policy = {
  id: 'vera-policy',
  projectRoot: '/srv/vera',
  baseBranch: 'main',
  qualityGates: [
    {
      id: 'quality',
      label: 'Quality',
      executable: '/usr/bin/npm',
      arguments: ['run', 'check'],
      timeoutMs: 60_000,
    },
  ],
  protectedPathPrefixes: ['.github/'],
  limits: {
    maxAttempts: 2,
    maxChangedFiles: 30,
    maxChangedBytes: 100_000,
    maxDurationMinutes: 60,
    minimumRequiredChecks: 1,
  },
  merge: {
    method: 'squash' as const,
    requireReviewApproval: true,
    synchronizeLocalBase: true,
  },
};

void describe('development campaign domain', () => {
  void it('rejects duplicate operator policy identities', () => {
    const result = DevelopmentCampaignCatalogSchema.safeParse({
      schemaVersion: 1,
      policies: [policy, policy],
    });

    assert.equal(result.success, false);
  });
});
