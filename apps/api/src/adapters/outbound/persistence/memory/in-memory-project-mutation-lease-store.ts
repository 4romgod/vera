import type {
  ProjectMutationLease,
  ProjectMutationLeaseStore,
} from '../../../../ports/persistence/project-mutation-lease-store.ts';

export class InMemoryProjectMutationLeaseStore
  implements ProjectMutationLeaseStore
{
  private readonly leases = new Map<string, ProjectMutationLease>();

  public claim(lease: ProjectMutationLease, now: string): Promise<boolean> {
    const existing = this.leases.get(lease.projectId);
    if (existing !== undefined && existing.expiresAt > now) {
      return Promise.resolve(existing.token === lease.token);
    }
    this.leases.set(lease.projectId, structuredClone(lease));
    return Promise.resolve(true);
  }

  public release(projectId: string, token: string): Promise<void> {
    if (this.leases.get(projectId)?.token === token) {
      this.leases.delete(projectId);
    }
    return Promise.resolve();
  }

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }

  public close(): Promise<void> {
    this.leases.clear();
    return Promise.resolve();
  }
}
