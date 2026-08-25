import { randomUUID } from 'node:crypto';

import { ProjectSchema, type Project } from '../../domain/projects/project.ts';
import type { ProjectStore } from '../../ports/persistence/project-store.ts';
import { ResourceError } from '../shared/resource-error.ts';

export type ProjectService = {
  registerProject(input: {
    principalId: string;
    registrationKey: string;
    displayName: string;
    rootPath: string;
  }): Promise<Project>;
  getProject(principalId: string, projectId: string): Promise<Project>;
  listProjects(principalId: string): Promise<Project[]>;
};

export function createProjectService(options: {
  store: ProjectStore;
  resolveLocalGitRoot(rootPath: string): Promise<string>;
  clock?: () => string;
  createId?: (prefix: string) => string;
}): ProjectService {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);

  return {
    async registerProject(input) {
      let rootPath: string;
      try {
        rootPath = await options.resolveLocalGitRoot(input.rootPath);
      } catch (error) {
        void error;
        throw new ResourceError(
          'The project source must be an accessible canonical local Git repository root.',
          'invalid_project_source',
        );
      }
      const now = clock();
      const project = ProjectSchema.parse({
        schemaVersion: 1,
        id: createId('project'),
        principalId: input.principalId,
        registrationKey: input.registrationKey,
        displayName: input.displayName,
        normalizedName: input.displayName.trim().toLocaleLowerCase(),
        source: { kind: 'local_git', rootPath },
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      const result = await options.store.createProject(project);
      if (
        !result.created &&
        (result.project.displayName !== project.displayName ||
          result.project.source.rootPath !== project.source.rootPath)
      ) {
        throw new ResourceError(
          `Idempotency key ${input.registrationKey} is already associated with different project input.`,
          'idempotency_key_reused',
        );
      }
      return result.project;
    },

    async getProject(principalId, projectId) {
      const project = await options.store.findProjectById(
        principalId,
        projectId,
      );
      if (project === null) {
        throw new ResourceError(
          `Project ${projectId} was not found.`,
          'project_not_found',
        );
      }
      return project;
    },

    listProjects: (principalId) => options.store.listProjects(principalId),
  };
}
