import {
  type DevelopmentCampaign,
  type DevelopmentCampaignEffect,
  type DevelopmentCampaignEvent,
} from '../../../domain/development-campaigns/development-campaign.ts';
import type { TaskAggregate } from '../../../domain/tasks/task-aggregate.ts';
import type { IdFactory } from './contracts.ts';

export function appendEvent(
  campaign: DevelopmentCampaign,
  type: DevelopmentCampaignEvent['type'],
  occurredAt: string,
  data: Record<string, unknown>,
  createId: IdFactory,
) {
  campaign.events.push({
    schemaVersion: 1,
    id: createId('event'),
    sequence: campaign.events.length + 1,
    type,
    occurredAt,
    data,
  });
}

export function stableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function pathIsProtected(path: string, prefixes: string[]) {
  const normalized = path.replace(/^\.\//u, '').replace(/\\/gu, '/');
  return prefixes.some((candidate) => {
    const prefix = candidate.replace(/^\.\//u, '').replace(/\\/gu, '/');
    return (
      normalized === prefix.replace(/\/$/u, '') || normalized.startsWith(prefix)
    );
  });
}

export function softwareChangeArtifactId(
  aggregate: TaskAggregate,
): string | undefined {
  const output = aggregate.run.output;
  if (output === undefined) return undefined;
  if (output.kind === 'software_change') return output.artifact?.id;
  if (output.kind === 'goal_result' || output.kind === 'adaptive_goal_result') {
    return output.artifacts.find(
      (artifact) => artifact.type === 'software_change',
    )?.id;
  }
  return undefined;
}

export function repairMessage(
  effect: DevelopmentCampaignEffect,
  attempt: number,
  previous?: DevelopmentCampaign['attempts'][number]['verification'],
) {
  const failure = previous?.gates.find((gate) => gate.status === 'failed');
  return [
    'Implement the following development-campaign objective as one complete software change.',
    'The objective, ticket reference, ticket details, and project name must be copied exactly into any capability proposal.',
    `Objective: ${effect.objective}`,
    `Ticket reference: ${effect.ticket.reference}`,
    `Ticket details: ${effect.ticket.details}`,
    `Project name: ${effect.project.displayName}`,
    `Campaign attempt: ${String(attempt)} of ${String(effect.limits.maxAttempts)}.`,
    ...(failure === undefined
      ? []
      : [
          'The previous replacement patch was retired from this campaign after its configured quality gate failed.',
          `Failed gate: ${failure.label} (${failure.id}).`,
          `Bounded gate output:\n${failure.output}`,
          'Generate a complete replacement change from the unchanged approved base; do not reuse or depend on the retired workspace.',
        ]),
  ].join('\n\n');
}
