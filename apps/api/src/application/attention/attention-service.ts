import { createHash, randomUUID } from 'node:crypto';

import {
  AttentionBriefingSchema,
  AttentionDecisionSchema,
  AttentionItemSchema,
  type AttentionBriefing,
  type AttentionItem,
} from '../../domain/attention/attention.ts';
import type { AttentionService } from '../../ports/attention/attention-service.ts';
import type { DevelopmentCampaignStore } from '../../ports/persistence/development-campaign-store.ts';
import type { ExecutionStore } from '../../ports/persistence/execution-store.ts';
import type { MissionStore } from '../../ports/persistence/mission-store.ts';
import type { OwnerResourceStore } from '../../ports/persistence/owner-resource-store.ts';
import type { AttentionDecisionStore } from '../../ports/persistence/attention-decision-store.ts';
import { ResourceError } from '../shared/resource-error.ts';

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_SNOOZE_MS = 30 * DAY_MS;
const SOURCE_LIMIT = 100;
const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2 } as const;

type Candidate = Omit<AttentionItem, 'state' | 'snoozedUntil'>;

export function createAttentionService(options: {
  executions: ExecutionStore;
  resources: OwnerResourceStore;
  missions: MissionStore;
  campaigns: DevelopmentCampaignStore;
  decisions: AttentionDecisionStore;
  clock?: () => Date;
}): AttentionService {
  const clock = options.clock ?? (() => new Date());

  async function candidates(principalId: string, now: Date) {
    const [executions, personalTasks, reminders, missions, campaigns] =
      await Promise.all([
        options.executions.listByPrincipal(principalId, SOURCE_LIMIT),
        options.resources.listPersonalTasks(principalId, {
          status: 'open',
          limit: SOURCE_LIMIT,
        }),
        options.resources.listReminders(principalId, {
          status: 'all',
          limit: SOURCE_LIMIT,
        }),
        options.missions.list(principalId, SOURCE_LIMIT),
        options.campaigns.list(principalId, SOURCE_LIMIT),
      ]);
    const items: Candidate[] = [];

    for (const aggregate of executions) {
      const target = {
        kind: 'task' as const,
        taskId: aggregate.task.id,
        runId: aggregate.run.id,
        ...(aggregate.task.conversationId === undefined
          ? {}
          : { conversationId: aggregate.task.conversationId }),
        ...(aggregate.run.approval?.id === undefined
          ? {}
          : { approvalId: aggregate.run.approval.id }),
      };
      if (
        aggregate.run.status === 'awaiting_approval' &&
        aggregate.run.approval?.status === 'pending'
      ) {
        items.push(
          candidate({
            source: `task:${aggregate.task.id}:${String(aggregate.version)}`,
            reason: 'approval_required',
            priority: 'urgent',
            title: 'Your approval is needed',
            summary: concise(aggregate.task.message),
            occurredAt: aggregate.run.approval.requestedAt,
            target,
          }),
        );
      } else if (aggregate.run.status === 'failed') {
        items.push(
          candidate({
            source: `task:${aggregate.task.id}:${String(aggregate.version)}`,
            reason: 'run_failed',
            priority: 'high',
            title: 'A Vera run failed',
            summary: concise(
              aggregate.run.failure?.message ?? aggregate.task.message,
            ),
            occurredAt: aggregate.task.updatedAt,
            target,
          }),
        );
      }
    }

    for (const task of personalTasks) {
      const dueAt = task.dueAt;
      const dueMs = dueAt === undefined ? undefined : Date.parse(dueAt);
      const delta = dueMs === undefined ? undefined : dueMs - now.getTime();
      const reason =
        delta === undefined
          ? 'open_task'
          : delta < 0
            ? 'task_overdue'
            : delta <= DAY_MS
              ? 'task_due_soon'
              : undefined;
      if (reason === undefined) continue;
      const priority =
        delta !== undefined && delta < -DAY_MS
          ? 'urgent'
          : reason === 'task_overdue'
            ? 'high'
            : 'normal';
      items.push(
        candidate({
          source: `personal_task:${task.id}:${task.updatedAt}:${reason}`,
          reason,
          priority,
          title: task.title,
          summary:
            reason === 'task_overdue'
              ? `This task was due ${relativeTime(dueAt ?? task.updatedAt, now)}.`
              : reason === 'task_due_soon'
                ? `This task is due ${relativeTime(dueAt ?? task.updatedAt, now)}.`
                : (task.notes ?? 'This task is still open.'),
          occurredAt: task.dueAt ?? task.updatedAt,
          target: { kind: 'personal_task', personalTaskId: task.id },
        }),
      );
    }

    for (const reminder of reminders) {
      const dueIn = Date.parse(reminder.scheduledFor) - now.getTime();
      if (reminder.status === 'delivered') {
        items.push(
          candidate({
            source: `reminder:${reminder.id}:${reminder.updatedAt}:delivered`,
            reason: 'reminder_delivered',
            priority: 'urgent',
            title: reminder.message,
            summary: 'This delivered reminder has not been acknowledged.',
            occurredAt:
              reminder.notification?.deliveredAt ?? reminder.updatedAt,
            target: { kind: 'reminder', reminderId: reminder.id },
          }),
        );
      } else if (
        reminder.status === 'scheduled' &&
        dueIn >= 0 &&
        dueIn <= DAY_MS
      ) {
        items.push(
          candidate({
            source: `reminder:${reminder.id}:${reminder.updatedAt}:due`,
            reason: 'reminder_due_soon',
            priority: 'normal',
            title: reminder.message,
            summary: `This reminder is due ${relativeTime(reminder.scheduledFor, now)}.`,
            occurredAt: reminder.scheduledFor,
            target: { kind: 'reminder', reminderId: reminder.id },
          }),
        );
      }
    }

    for (const mission of missions) {
      const base = {
        source: `mission:${mission.id}:${String(mission.version)}`,
        title: concise(mission.approval.effect.objective, 500),
        occurredAt: mission.updatedAt,
        target: { kind: 'mission' as const, missionId: mission.id },
      };
      if (mission.status === 'awaiting_approval') {
        items.push(
          candidate({
            ...base,
            reason: 'approval_required',
            priority: 'urgent',
            summary: 'This bounded mission is waiting for your approval.',
          }),
        );
      } else if (mission.status === 'review_required') {
        items.push(
          candidate({
            ...base,
            reason: 'mission_review_required',
            priority: 'high',
            summary:
              mission.failure?.message ?? 'This mission needs your review.',
          }),
        );
      } else if (mission.status === 'failed') {
        items.push(
          candidate({
            ...base,
            reason: 'mission_failed',
            priority: 'high',
            summary: mission.failure?.message ?? 'This mission failed.',
          }),
        );
      } else if (mission.status === 'succeeded') {
        items.push(
          candidate({
            ...base,
            reason: 'mission_result_ready',
            priority: 'high',
            summary: 'The pull request is ready for your review.',
          }),
        );
      }
    }

    for (const campaign of campaigns) {
      if (campaign.approval.effect.approvalController?.kind === 'mission')
        continue;
      const base = {
        source: `campaign:${campaign.id}:${String(campaign.version)}`,
        title: concise(campaign.approval.effect.objective, 500),
        occurredAt: campaign.updatedAt,
        target: { kind: 'campaign' as const, campaignId: campaign.id },
      };
      if (campaign.status === 'awaiting_approval') {
        items.push(
          candidate({
            ...base,
            reason: 'approval_required',
            priority: 'urgent',
            summary: 'This development campaign is waiting for your approval.',
          }),
        );
      } else if (campaign.status === 'review_required') {
        items.push(
          candidate({
            ...base,
            reason: 'campaign_review_required',
            priority: 'high',
            summary:
              campaign.failure?.message ?? 'This campaign needs your review.',
          }),
        );
      } else if (campaign.status === 'failed') {
        items.push(
          candidate({
            ...base,
            reason: 'campaign_failed',
            priority: 'high',
            summary: campaign.failure?.message ?? 'This campaign failed.',
          }),
        );
      } else if (campaign.status === 'succeeded') {
        items.push(
          candidate({
            ...base,
            reason: 'campaign_result_ready',
            priority: 'high',
            summary: 'The development result is ready for your review.',
          }),
        );
      }
    }
    return items;
  }

  async function briefing(principalId: string): Promise<AttentionBriefing> {
    const now = clock();
    const generatedAt = now.toISOString();
    const sourceItems = await candidates(principalId, now);
    const decisions = await options.decisions.listLatestByItem(
      principalId,
      sourceItems.map((item) => item.id),
    );
    const items = sourceItems.map((item): AttentionItem => {
      const decision = decisions.get(item.id);
      if (decision?.decision === 'dismissed') {
        return AttentionItemSchema.parse({ ...item, state: 'dismissed' });
      }
      if (
        decision?.decision === 'snoozed' &&
        decision.snoozedUntil !== undefined &&
        Date.parse(decision.snoozedUntil) > now.getTime()
      ) {
        return AttentionItemSchema.parse({
          ...item,
          state: 'snoozed',
          snoozedUntil: decision.snoozedUntil,
        });
      }
      return AttentionItemSchema.parse({ ...item, state: 'active' });
    });
    items.sort(attentionOrder);
    const active = items.filter((item) => item.state === 'active');
    const snoozed = items.filter((item) => item.state === 'snoozed');
    const dismissed = items.filter((item) => item.state === 'dismissed');
    const counts = {
      urgent: active.filter((item) => item.priority === 'urgent').length,
      high: active.filter((item) => item.priority === 'high').length,
      normal: active.filter((item) => item.priority === 'normal').length,
      snoozed: snoozed.length,
      dismissed: dismissed.length,
    };
    const activeCount = active.length;
    return AttentionBriefingSchema.parse({
      schemaVersion: 1,
      generatedAt,
      headline:
        activeCount === 0
          ? "You're all caught up"
          : activeCount === 1
            ? 'One thing needs your attention'
            : `${String(activeCount)} things need your attention`,
      summary:
        activeCount === 0
          ? 'Vera found no open approvals, failures, overdue work, or imminent reminders.'
          : counts.urgent > 0
            ? `${String(counts.urgent)} ${counts.urgent === 1 ? 'item requires' : 'items require'} immediate attention.`
            : 'Nothing is urgent; review the highest-priority item when you are ready.',
      counts,
      items: active,
      snoozedItems: snoozed,
      dismissedItems: dismissed,
    });
  }

  return {
    getBriefing: briefing,
    async decide(input) {
      const now = clock();
      if (input.request.decision === 'snooze') {
        const snoozedUntil = input.request.snoozedUntil;
        if (snoozedUntil === undefined) {
          throw new ResourceError(
            'Snooze requires an end time.',
            'invalid_attention_decision',
          );
        }
        const until = Date.parse(snoozedUntil);
        if (until <= now.getTime() || until > now.getTime() + MAX_SNOOZE_MS) {
          throw new ResourceError(
            'Snooze must end in the future and within 30 days.',
            'invalid_attention_decision',
          );
        }
      }
      const requestedDecision =
        input.request.decision === 'dismiss'
          ? 'dismissed'
          : input.request.decision === 'snooze'
            ? 'snoozed'
            : 'restored';
      const existing = await options.decisions.findByRequestKey(
        input.principalId,
        input.requestKey,
      );
      if (existing !== null) {
        assertSameDecision(existing, {
          attentionItemId: input.attentionItemId,
          decision: requestedDecision,
          ...(input.request.snoozedUntil === undefined
            ? {}
            : { snoozedUntil: input.request.snoozedUntil }),
        });
        return briefing(input.principalId);
      }
      const current = await candidates(input.principalId, now);
      if (!current.some((item) => item.id === input.attentionItemId)) {
        throw new ResourceError(
          `Attention item ${input.attentionItemId} is no longer current.`,
          'attention_item_not_found',
        );
      }
      const decision = AttentionDecisionSchema.parse({
        schemaVersion: 1,
        id: `attention_decision_${randomUUID()}`,
        principalId: input.principalId,
        requestKey: input.requestKey,
        attentionItemId: input.attentionItemId,
        decision: requestedDecision,
        ...(input.request.snoozedUntil === undefined
          ? {}
          : { snoozedUntil: input.request.snoozedUntil }),
        decidedAt: now.toISOString(),
      });
      const created = await options.decisions.create(decision);
      if (!created.created) {
        assertSameDecision(created.decision, decision);
      }
      return briefing(input.principalId);
    },
  };
}

function assertSameDecision(
  existing: {
    attentionItemId: string;
    decision: 'dismissed' | 'snoozed' | 'restored';
    snoozedUntil?: string | undefined;
  },
  requested: {
    attentionItemId: string;
    decision: 'dismissed' | 'snoozed' | 'restored';
    snoozedUntil?: string | undefined;
  },
): void {
  if (
    existing.attentionItemId !== requested.attentionItemId ||
    existing.decision !== requested.decision ||
    existing.snoozedUntil !== requested.snoozedUntil
  ) {
    throw new ResourceError(
      'This idempotency key was already used for another attention decision.',
      'idempotency_key_reused',
    );
  }
}

function candidate(
  input: Omit<Candidate, 'schemaVersion' | 'id'> & { source: string },
): Candidate {
  const { source, ...value } = input;
  const digest = createHash('sha256')
    .update(`${source}\u0000${input.reason}\u0000${input.priority}`)
    .digest('hex')
    .slice(0, 32);
  return { schemaVersion: 1, id: `attention_${digest}`, ...value };
}

function concise(value: string, limit = 2_000): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1)}…`;
}

function relativeTime(iso: string, now: Date): string {
  const delta = Date.parse(iso) - now.getTime();
  const absoluteMinutes = Math.max(1, Math.round(Math.abs(delta) / 60_000));
  const amount =
    absoluteMinutes >= 60 ? Math.round(absoluteMinutes / 60) : absoluteMinutes;
  const unit =
    absoluteMinutes >= 60
      ? amount === 1
        ? 'hour'
        : 'hours'
      : amount === 1
        ? 'minute'
        : 'minutes';
  return delta < 0
    ? `${String(amount)} ${unit} ago`
    : `in ${String(amount)} ${unit}`;
}

function attentionOrder(left: AttentionItem, right: AttentionItem): number {
  return (
    PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.id.localeCompare(right.id)
  );
}
