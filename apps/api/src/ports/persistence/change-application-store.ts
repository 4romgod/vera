import type { SoftwareChangeApplication } from '../../domain/changes/software-change-application.ts';

export type ChangeApplicationStore = {
  create(application: SoftwareChangeApplication): Promise<{
    created: boolean;
    application: SoftwareChangeApplication;
  }>;
  findByRequestKey(
    principalId: string,
    requestKey: string,
  ): Promise<SoftwareChangeApplication | null>;
  findById(
    principalId: string,
    applicationId: string,
  ): Promise<SoftwareChangeApplication | null>;
  findByApprovalId(
    principalId: string,
    approvalId: string,
  ): Promise<SoftwareChangeApplication | null>;
  replace(
    application: SoftwareChangeApplication,
    expectedVersion: number,
  ): Promise<boolean>;
  findDispatchable(limit: number): Promise<SoftwareChangeApplication[]>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
