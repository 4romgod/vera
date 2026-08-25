export type WorkLease = {
  schemaVersion: 1;
  runId: string;
  workerId: string;
  token: string;
  acquiredAt: string;
  expiresAt: string;
};

export type WorkLeaseStore = {
  claim(lease: WorkLease, now: string): Promise<boolean>;
  release(runId: string, token: string): Promise<void>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
