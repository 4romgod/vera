import {
  ArtifactSchema,
  type Artifact,
} from '../../domain/artifacts/artifact.ts';
import type { ArtifactStore } from '../../ports/persistence/artifact-store.ts';
import { ResourceError } from '../shared/resource-error.ts';

export type ArtifactService = {
  getArtifact(principalId: string, artifactId: string): Promise<Artifact>;
};

export function createArtifactService(options: {
  store: ArtifactStore;
}): ArtifactService {
  return {
    async getArtifact(principalId, artifactId) {
      const artifact = await options.store.findArtifactById(
        principalId,
        artifactId,
      );
      if (artifact === null) {
        throw new ResourceError(
          `Artifact ${artifactId} was not found.`,
          'artifact_not_found',
        );
      }
      return ArtifactSchema.parse(artifact);
    },
  };
}
