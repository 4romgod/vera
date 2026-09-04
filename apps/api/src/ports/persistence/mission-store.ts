import type { Mission } from '../../domain/missions/mission.ts';
import type { MissionNotificationResource } from '../../domain/notifications/notification.ts';

export type MissionStore = {
  create(mission: Mission): Promise<{ created: boolean; mission: Mission }>;
  findByRequestKey(
    principalId: string,
    requestKey: string,
  ): Promise<Mission | null>;
  findById(principalId: string, missionId: string): Promise<Mission | null>;
  list(principalId: string, limit: number): Promise<Mission[]>;
  replace(mission: Mission, expectedVersion: number): Promise<boolean>;
  findDispatchable(limit: number): Promise<Mission[]>;
  listNotifications(
    principalId: string,
    options: {
      after?: { deliveredAt: string; id: string };
      limit: number;
    },
  ): Promise<MissionNotificationResource[]>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
