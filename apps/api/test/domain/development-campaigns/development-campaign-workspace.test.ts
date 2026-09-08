import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  campaignWorkspace,
  matchesAdoptedWorkspaceFile,
} from '../../../src/domain/development-campaigns/development-campaign-workspace.ts';
import type { DevelopmentCampaignEffect } from '../../../src/domain/development-campaigns/development-campaign.ts';

function effectWithProtectedOwnerFile(): DevelopmentCampaignEffect {
  return {
    workspace: {
      mode: 'adopted',
      snapshot: {
        files: [
          {
            relativePath: 'package-lock.json',
            operation: 'update',
            beforeSha256: 'a'.repeat(64),
            afterSha256: 'b'.repeat(64),
            bytes: 120,
            staged: true,
            unstaged: false,
            untracked: false,
          },
        ],
      },
    },
  } as DevelopmentCampaignEffect;
}

void describe('development campaign adopted workspace', () => {
  void it('treats legacy effects without workspace evidence as clean', () => {
    assert.deepEqual(campaignWorkspace({} as DevelopmentCampaignEffect), {
      mode: 'clean',
    });
  });

  void it('allows only the exact frozen owner version of a protected file', () => {
    const effect = effectWithProtectedOwnerFile();
    const exact = {
      relativePath: 'package-lock.json',
      operation: 'update' as const,
      beforeSha256: 'a'.repeat(64),
      afterSha256: 'b'.repeat(64),
      bytes: 120,
    };

    assert.equal(matchesAdoptedWorkspaceFile(effect, exact), true);
    assert.equal(
      matchesAdoptedWorkspaceFile(effect, {
        ...exact,
        afterSha256: 'c'.repeat(64),
      }),
      false,
    );
  });
});
