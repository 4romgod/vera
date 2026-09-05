import type { ExternalSignal } from '../../domain/external-awareness/external-signal.ts';
import type { NotificationResource } from '../../domain/notifications/notification.ts';

export type ExternalSignalStore = {
  findById(
    principalId: string,
    signalId: string,
  ): Promise<ExternalSignal | null>;
  upsert(signal: ExternalSignal): Promise<{
    created: boolean;
    changed: boolean;
    signal: ExternalSignal;
  }>;
  resolveMissing(input: {
    principalId: string;
    routineId: string;
    activeIds: string[];
    resolvedAt: string;
  }): Promise<number>;
  listActive(principalId: string, limit: number): Promise<ExternalSignal[]>;
  listByRoutine(
    principalId: string,
    routineId: string,
    limit: number,
  ): Promise<ExternalSignal[]>;
  listNotifications(
    principalId: string,
    options: {
      after?: { deliveredAt: string; id: string };
      limit: number;
    },
  ): Promise<NotificationResource[]>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
