import type { Artifact } from '../../domain/artifacts/artifact.ts';

export type ArtifactStore = {
  createArtifact(
    artifact: Artifact,
  ): Promise<{ created: boolean; artifact: Artifact }>;
  findArtifactById(
    principalId: string,
    artifactId: string,
  ): Promise<Artifact | null>;
  findArtifactByInvocationId(
    principalId: string,
    invocationId: string,
  ): Promise<Artifact | null>;
};
