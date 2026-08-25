import type { WorkLease, WorkLeaseStore } from '../ports/work-lease-store.ts';

export class InMemoryWorkLeaseStore implements WorkLeaseStore {
  private readonly leases = new Map<string, WorkLease>();

  public claim(lease: WorkLease, now: string): Promise<boolean> {
    const existing = this.leases.get(lease.runId);
    if (existing !== undefined && existing.expiresAt > now) {
      return Promise.resolve(false);
    }
    this.leases.set(lease.runId, structuredClone(lease));
    return Promise.resolve(true);
  }

  public release(runId: string, token: string): Promise<void> {
    if (this.leases.get(runId)?.token === token) {
      this.leases.delete(runId);
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
