import type { SoftwareChangePublication } from '../../domain/changes/software-change-publication.ts';

export type SoftwareChangePublicationStore = {
  create(publication: SoftwareChangePublication): Promise<{
    created: boolean;
    publication: SoftwareChangePublication;
  }>;
  findByRequestKey(
    principalId: string,
    requestKey: string,
  ): Promise<SoftwareChangePublication | null>;
  findById(
    principalId: string,
    publicationId: string,
  ): Promise<SoftwareChangePublication | null>;
  replace(
    publication: SoftwareChangePublication,
    expectedVersion: number,
  ): Promise<boolean>;
  findDispatchable(limit: number): Promise<SoftwareChangePublication[]>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
