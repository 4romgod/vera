import type { SoftwareChange } from '../changes/software-change.ts';
import type {
  DevelopmentCampaignEffect,
  DevelopmentCampaignWorkspace,
} from './development-campaign.ts';

export function campaignWorkspace(
  effect: DevelopmentCampaignEffect,
): DevelopmentCampaignWorkspace {
  return effect.workspace ?? { mode: 'clean' };
}

export function matchesAdoptedWorkspaceFile(
  effect: DevelopmentCampaignEffect,
  file: SoftwareChange['files'][number],
): boolean {
  const workspace = campaignWorkspace(effect);
  if (workspace.mode !== 'adopted') return false;
  const adopted = workspace.snapshot.files.find(
    (candidate) => candidate.relativePath === file.relativePath,
  );
  if (adopted?.operation !== file.operation || adopted.bytes !== file.bytes) {
    return false;
  }
  if (adopted.operation === 'create' && file.operation === 'create') {
    return adopted.afterSha256 === file.afterSha256;
  }
  if (adopted.operation === 'delete' && file.operation === 'delete') {
    return adopted.beforeSha256 === file.beforeSha256;
  }
  return (
    adopted.operation === 'update' &&
    file.operation === 'update' &&
    adopted.beforeSha256 === file.beforeSha256 &&
    adopted.afterSha256 === file.afterSha256
  );
}
