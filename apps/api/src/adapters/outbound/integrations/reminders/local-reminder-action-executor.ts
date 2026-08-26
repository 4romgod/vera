import type { CapabilityAuthority } from '../../../../domain/capabilities/capability-registry.ts';
import {
  ReminderActionArgumentsSchema,
  ReminderResultSchema,
  reminderResource,
  type ReminderActionArguments,
  type ReminderResult,
} from '../../../../domain/reminders/reminder.ts';
import type { IntegrationActionExecutor } from '../../../../ports/integrations/integration-action-executor.ts';
import type { ReminderStore } from '../../../../ports/persistence/reminder-store.ts';
import {
  reminderIdForInvocation,
  reminderMutationOrderKey,
} from '../../../../ports/persistence/reminder-store.ts';

function assertTimeZone(value: string): void {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
  } catch {
    throw new Error(`Reminder time zone "${value}" is invalid.`);
  }
}

export class LocalReminderActionExecutor
  implements IntegrationActionExecutor<ReminderActionArguments, ReminderResult>
{
  public readonly integrationId = 'vera_reminders';
  public readonly destination = {
    schemaVersion: 1 as const,
    adapterId: 'vera_reminders',
    provider: 'vera',
    transport: 'local_store',
    dataBoundary: 'owner_controlled' as const,
  };
  public readonly maximumAuthority: CapabilityAuthority = {
    approval: 'always',
    projectContext: 'none',
    networkAccess: 'none',
    dataClasses: ['owner_request', 'personal_reminder_data'],
    sideEffects: ['personal_data_write', 'scheduled_notification'],
    credentials: 'none',
  };

  public constructor(private readonly store: ReminderStore) {}

  public authorityFor(
    arguments_: ReminderActionArguments,
  ): CapabilityAuthority {
    const sideEffects: CapabilityAuthority['sideEffects'] =
      arguments_.action === 'list'
        ? []
        : arguments_.action === 'create' || arguments_.action === 'reschedule'
          ? this.maximumAuthority.sideEffects
          : ['personal_data_write'];
    return { ...this.maximumAuthority, sideEffects };
  }

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }

  public async execute(
    input: {
      principalId: string;
      invocationId: string;
      startedAt: string;
      recovery: boolean;
      arguments: ReminderActionArguments;
    },
    options: { signal?: AbortSignal } = {},
  ): Promise<ReminderResult> {
    if (options.signal?.aborted === true) {
      throw new Error('Reminder action was aborted.');
    }
    const arguments_ = ReminderActionArgumentsSchema.parse(input.arguments);
    if ('timeZone' in arguments_) assertTimeZone(arguments_.timeZone);

    if (arguments_.action === 'create') {
      const reminder = await this.store.createReminder({
        schemaVersion: 1,
        id: reminderIdForInvocation(input.invocationId),
        principalId: input.principalId,
        message: arguments_.message,
        scheduledFor: new Date(arguments_.scheduledFor).toISOString(),
        timeZone: arguments_.timeZone,
        status: 'scheduled',
        createdAt: input.startedAt,
        updatedAt: input.startedAt,
        creationInvocationId: input.invocationId,
        lastMutation: {
          invocationId: input.invocationId,
          orderKey: reminderMutationOrderKey(
            input.startedAt,
            input.invocationId,
          ),
        },
      });
      if (reminder.lastMutation.invocationId !== input.invocationId) {
        throw new Error(
          `Reminder action ${input.invocationId} was superseded by a newer mutation.`,
        );
      }
      return ReminderResultSchema.parse({
        schemaVersion: 1,
        action: 'create',
        summary: `Scheduled reminder "${reminder.message}" for ${reminder.scheduledFor}.`,
        reminders: [reminderResource(reminder)],
      });
    }

    if (arguments_.action === 'list') {
      const status = arguments_.status ?? 'scheduled';
      const reminders = await this.store.listReminders(input.principalId, {
        status,
        limit: arguments_.limit ?? 50,
      });
      return ReminderResultSchema.parse({
        schemaVersion: 1,
        action: 'list',
        summary: `Found ${String(reminders.length)} ${status === 'all' ? '' : `${status} `}reminder(s).`,
        reminders: reminders.map(reminderResource),
      });
    }

    const action =
      arguments_.action === 'reschedule'
        ? {
            ...arguments_,
            scheduledFor: new Date(arguments_.scheduledFor).toISOString(),
          }
        : arguments_;
    const reminder = await this.store.mutateReminder({
      principalId: input.principalId,
      reminderId: arguments_.reminderId,
      action,
      invocationId: input.invocationId,
      mutationAt: input.startedAt,
      recovery: input.recovery,
    });
    if (reminder === null) {
      throw new Error(`Reminder ${arguments_.reminderId} was not found.`);
    }
    if (reminder.lastMutation.invocationId !== input.invocationId) {
      throw new Error(
        `Reminder action ${input.invocationId} was superseded by a newer mutation.`,
      );
    }
    const verb =
      arguments_.action === 'reschedule'
        ? 'Rescheduled'
        : arguments_.action === 'cancel'
          ? 'Cancelled'
          : 'Acknowledged';
    return ReminderResultSchema.parse({
      schemaVersion: 1,
      action: arguments_.action,
      summary: `${verb} reminder "${reminder.message}".`,
      reminders: [reminderResource(reminder)],
    });
  }
}
