import type { SoftwareChangeApplication } from '../../domain/changes/software-change-application.ts';
import type {
  PublicationEffect,
  SoftwareChangePublication,
} from '../../domain/changes/software-change-publication.ts';
import type { Project } from '../../domain/projects/project.ts';

export type SoftwareChangePublicationResult = NonNullable<
  SoftwareChangePublication['result']
>;

export class SoftwareChangePublicationExecutionError extends Error {
  public constructor(
    message: string,
    public readonly code:
      | 'publication_conflict'
      | 'publication_failed'
      | 'publication_unavailable'
      | 'review_required',
  ) {
    super(message);
    this.name = 'SoftwareChangePublicationExecutionError';
  }
}

export type SoftwareChangePublicationExecutor = {
  readonly adapterId: 'github_gh_cli';
  prepare(input: {
    application: SoftwareChangeApplication;
    project: Project;
    baseBranch: string;
    commitMessage: string;
    pullRequest: { title: string; body: string; draft: boolean };
  }): Promise<PublicationEffect>;
  execute(input: {
    publication: SoftwareChangePublication;
    application: SoftwareChangeApplication;
    project: Project;
  }): Promise<SoftwareChangePublicationResult>;
  checkReadiness(): Promise<void>;
};
