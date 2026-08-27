import type { Mission } from '../../../../domain/missions/mission.ts';
import type { MissionStore } from '../../../../ports/persistence/mission-store.ts';

export class InMemoryMissionStore implements MissionStore {
  private readonly missions = new Map<string, Mission>();
  private readonly idByRequest = new Map<string, string>();

  public create(mission: Mission) {
    const identity = `${mission.principalId}\u0000${mission.requestKey}`;
    const existingId = this.idByRequest.get(identity);
    if (existingId !== undefined) {
      const existing = this.missions.get(existingId);
      if (existing === undefined) throw new Error('Mission index is invalid.');
      return Promise.resolve({
        created: false,
        mission: structuredClone(existing),
      });
    }
    this.idByRequest.set(identity, mission.id);
    this.missions.set(mission.id, structuredClone(mission));
    return Promise.resolve({
      created: true,
      mission: structuredClone(mission),
    });
  }

  public findByRequestKey(principalId: string, requestKey: string) {
    const id = this.idByRequest.get(`${principalId}\u0000${requestKey}`);
    return id === undefined
      ? Promise.resolve(null)
      : this.findById(principalId, id);
  }

  public findById(principalId: string, missionId: string) {
    const mission = this.missions.get(missionId);
    return Promise.resolve(
      mission?.principalId === principalId ? structuredClone(mission) : null,
    );
  }

  public list(principalId: string, limit: number) {
    return Promise.resolve(
      [...this.missions.values()]
        .filter((mission) => mission.principalId === principalId)
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.id.localeCompare(left.id),
        )
        .slice(0, limit)
        .map((mission) => structuredClone(mission)),
    );
  }

  public replace(mission: Mission, expectedVersion: number) {
    const current = this.missions.get(mission.id);
    if (current?.version !== expectedVersion) return Promise.resolve(false);
    this.missions.set(mission.id, structuredClone(mission));
    return Promise.resolve(true);
  }

  public findDispatchable(limit: number) {
    return Promise.resolve(
      [...this.missions.values()]
        .filter((mission) => ['approved', 'executing'].includes(mission.status))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit)
        .map((mission) => structuredClone(mission)),
    );
  }

  public listNotifications(
    principalId: string,
    options: {
      after?: { deliveredAt: string; id: string };
      limit: number;
    },
  ) {
    return Promise.resolve(
      [...this.missions.values()]
        .filter(
          (mission) =>
            mission.principalId === principalId &&
            mission.notification !== undefined,
        )
        .map((mission) => mission.notification)
        .filter((notification) => notification !== undefined)
        .filter(
          (notification) =>
            options.after === undefined ||
            notification.deliveredAt > options.after.deliveredAt ||
            (notification.deliveredAt === options.after.deliveredAt &&
              notification.id > options.after.id),
        )
        .sort(
          (left, right) =>
            left.deliveredAt.localeCompare(right.deliveredAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, options.limit)
        .map((notification) => structuredClone(notification)),
    );
  }

  public checkReadiness() {
    return Promise.resolve();
  }

  public close() {
    this.missions.clear();
    this.idByRequest.clear();
    return Promise.resolve();
  }
}
