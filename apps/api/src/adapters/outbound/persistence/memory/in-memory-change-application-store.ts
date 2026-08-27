import type { SoftwareChangeApplication } from '../../../../domain/changes/software-change-application.ts';
import type { ChangeApplicationStore } from '../../../../ports/persistence/change-application-store.ts';

export class InMemoryChangeApplicationStore implements ChangeApplicationStore {
  private readonly applications = new Map<string, SoftwareChangeApplication>();
  private readonly applicationIdByRequest = new Map<string, string>();

  public create(application: SoftwareChangeApplication): Promise<{
    created: boolean;
    application: SoftwareChangeApplication;
  }> {
    const identity = this.identity(
      application.principalId,
      application.requestKey,
    );
    const existingId = this.applicationIdByRequest.get(identity);
    if (existingId !== undefined) {
      const existing = this.applications.get(existingId);
      if (existing === undefined) {
        throw new Error('In-memory change-application index is inconsistent.');
      }
      return Promise.resolve({
        created: false,
        application: structuredClone(existing),
      });
    }
    this.applicationIdByRequest.set(identity, application.id);
    this.applications.set(application.id, structuredClone(application));
    return Promise.resolve({
      created: true,
      application: structuredClone(application),
    });
  }

  public findById(
    principalId: string,
    applicationId: string,
  ): Promise<SoftwareChangeApplication | null> {
    const application = this.applications.get(applicationId);
    return Promise.resolve(
      application?.principalId === principalId
        ? structuredClone(application)
        : null,
    );
  }

  public findByRequestKey(
    principalId: string,
    requestKey: string,
  ): Promise<SoftwareChangeApplication | null> {
    const id = this.applicationIdByRequest.get(
      this.identity(principalId, requestKey),
    );
    return id === undefined
      ? Promise.resolve(null)
      : this.findById(principalId, id);
  }

  public findByApprovalId(
    principalId: string,
    approvalId: string,
  ): Promise<SoftwareChangeApplication | null> {
    const application = [...this.applications.values()].find(
      (candidate) =>
        candidate.principalId === principalId &&
        candidate.approval.id === approvalId,
    );
    return Promise.resolve(
      application === undefined ? null : structuredClone(application),
    );
  }

  public listBySourceArtifact(
    principalId: string,
    artifactId: string,
    limit: number,
  ): Promise<SoftwareChangeApplication[]> {
    return Promise.resolve(
      [...this.applications.values()]
        .filter(
          (application) =>
            application.principalId === principalId &&
            application.sourceArtifact.id === artifactId,
        )
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.id.localeCompare(left.id),
        )
        .slice(0, limit)
        .map((application) => structuredClone(application)),
    );
  }

  public replace(
    application: SoftwareChangeApplication,
    expectedVersion: number,
  ): Promise<boolean> {
    const existing = this.applications.get(application.id);
    if (existing?.version !== expectedVersion) return Promise.resolve(false);
    this.applications.set(application.id, structuredClone(application));
    return Promise.resolve(true);
  }

  public findDispatchable(limit: number): Promise<SoftwareChangeApplication[]> {
    return Promise.resolve(
      [...this.applications.values()]
        .filter((application) =>
          ['approved', 'applying', 'cancellation_requested'].includes(
            application.status,
          ),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit)
        .map((application) => structuredClone(application)),
    );
  }

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }

  public close(): Promise<void> {
    this.applications.clear();
    return Promise.resolve();
  }

  private identity(principalId: string, requestKey: string): string {
    return `${principalId}\u0000${requestKey}`;
  }
}
