import type { Project } from '../../domain/projects/project.ts';
import type { ProjectContextBundle } from '../../domain/projects/project-context.ts';

export type ProjectContextAssembler = {
  assemble(input: {
    project: Project;
    objective: string;
    ticket: { reference: string; details: string };
    revision?: string;
    limits: { maxFiles: number; maxBytes: number; maxFileBytes: number };
  }): Promise<ProjectContextBundle>;
};
