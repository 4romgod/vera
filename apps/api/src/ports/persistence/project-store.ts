import type { Project } from '../../domain/projects/project.ts';

export type ProjectStore = {
  createProject(
    project: Project,
  ): Promise<{ created: boolean; project: Project }>;
  findProjectById(
    principalId: string,
    projectId: string,
  ): Promise<Project | null>;
  listProjects(principalId: string): Promise<Project[]>;
};
