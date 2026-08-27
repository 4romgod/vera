import type { SoftwareChangePublication } from '../../../../domain/changes/software-change-publication.ts';
import type { SoftwareChangePublicationStore } from '../../../../ports/persistence/software-change-publication-store.ts';

export class InMemorySoftwareChangePublicationStore
  implements SoftwareChangePublicationStore
{
  private readonly publications = new Map<string, SoftwareChangePublication>();
  private readonly idByRequest = new Map<string, string>();

  public create(publication: SoftwareChangePublication): Promise<{
    created: boolean;
    publication: SoftwareChangePublication;
  }> {
    const identity = `${publication.principalId}\u0000${publication.requestKey}`;
    const existingId = this.idByRequest.get(identity);
    if (existingId !== undefined) {
      const existing = this.publications.get(existingId);
      if (existing === undefined)
        throw new Error('Publication index is inconsistent.');
      return Promise.resolve({
        created: false,
        publication: structuredClone(existing),
      });
    }
    this.idByRequest.set(identity, publication.id);
    this.publications.set(publication.id, structuredClone(publication));
    return Promise.resolve({
      created: true,
      publication: structuredClone(publication),
    });
  }

  public findByRequestKey(principalId: string, requestKey: string) {
    const id = this.idByRequest.get(`${principalId}\u0000${requestKey}`);
    return id === undefined
      ? Promise.resolve(null)
      : this.findById(principalId, id);
  }

  public findById(principalId: string, publicationId: string) {
    const publication = this.publications.get(publicationId);
    return Promise.resolve(
      publication?.principalId === principalId
        ? structuredClone(publication)
        : null,
    );
  }

  public replace(
    publication: SoftwareChangePublication,
    expectedVersion: number,
  ) {
    const existing = this.publications.get(publication.id);
    if (existing?.version !== expectedVersion) return Promise.resolve(false);
    this.publications.set(publication.id, structuredClone(publication));
    return Promise.resolve(true);
  }

  public findDispatchable(limit: number) {
    return Promise.resolve(
      [...this.publications.values()]
        .filter((publication) =>
          ['approved', 'publishing'].includes(publication.status),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit)
        .map((publication) => structuredClone(publication)),
    );
  }

  public checkReadiness() {
    return Promise.resolve();
  }
  public close() {
    this.publications.clear();
    return Promise.resolve();
  }
}
