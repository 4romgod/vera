import type { ArtifactStore } from './artifact-store.ts';
import type { ConversationStore } from './conversation-store.ts';
import type { ProjectStore } from './project-store.ts';

export type OwnerResourceStore = ArtifactStore &
  ConversationStore &
  ProjectStore & {
    checkReadiness(): Promise<void>;
    close(): Promise<void>;
  };
