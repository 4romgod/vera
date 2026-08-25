import type { Artifact } from '../../domain/artifacts/artifact.ts';
import type {
  ChangeApplicationFile,
  SoftwareChangeApplication,
} from '../../domain/changes/software-change-application.ts';
import type { Project } from '../../domain/projects/project.ts';

export type PreparedChangeApplication = {
  adapterId: 'local_git_worktree';
  baseRevision: string;
  branchName: string;
  workspacePath: string;
  patchSha256: string;
  staged: true;
  files: ChangeApplicationFile[];
};

export type ChangeApplicationExecutionResult = PreparedChangeApplication & {
  appliedAt: string;
};

export class ChangeApplicationExecutionError extends Error {
  public constructor(
    message: string,
    public readonly code:
      | 'stale_source'
      | 'application_conflict'
      | 'application_failed'
      | 'review_required',
  ) {
    super(message);
    this.name = 'ChangeApplicationExecutionError';
  }
}

export type SoftwareChangeApplicationExecutor = {
  readonly adapterId: 'local_git_worktree';
  prepare(input: {
    applicationId: string;
    artifact: Extract<Artifact, { type: 'software_change' }>;
    project: Project;
  }): Promise<PreparedChangeApplication>;
  execute(input: {
    application: SoftwareChangeApplication;
    artifact: Extract<Artifact, { type: 'software_change' }>;
    project: Project;
    signal?: AbortSignal;
  }): Promise<ChangeApplicationExecutionResult>;
  reconcileCancellation(input: {
    application: SoftwareChangeApplication;
    artifact: Extract<Artifact, { type: 'software_change' }>;
    project: Project;
  }): Promise<
    | { outcome: 'cancelled' }
    | { outcome: 'succeeded'; result: ChangeApplicationExecutionResult }
  >;
  checkReadiness(): Promise<void>;
};
