import type { Project } from '../domain/project.ts';
import type { ProjectContextBundle } from '../domain/project-context.ts';

export type ProjectContextAssembler = {
  assemble(input: {
    project: Project;
    objective: string;
    ticket: { reference: string; details: string };
    limits: { maxFiles: number; maxBytes: number; maxFileBytes: number };
  }): Promise<ProjectContextBundle>;
};
