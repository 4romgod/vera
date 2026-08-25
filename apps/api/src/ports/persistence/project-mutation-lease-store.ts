export type ProjectMutationLease = {
  schemaVersion: 1;
  projectId: string;
  workerId: string;
  token: string;
  acquiredAt: string;
  expiresAt: string;
};

export type ProjectMutationLeaseStore = {
  claim(lease: ProjectMutationLease, now: string): Promise<boolean>;
  release(projectId: string, token: string): Promise<void>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
