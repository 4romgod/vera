import type { ArtifactStore } from './artifact-store.ts';
import type { ConversationStore } from './conversation-store.ts';
import type { ProjectStore } from './project-store.ts';
import type { PersonalTaskStore } from './personal-task-store.ts';

export type OwnerResourceStore = ArtifactStore &
  ConversationStore &
  ProjectStore &
  PersonalTaskStore & {
    checkReadiness(): Promise<void>;
    close(): Promise<void>;
  };
