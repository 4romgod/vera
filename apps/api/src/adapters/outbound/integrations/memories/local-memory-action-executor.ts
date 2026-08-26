import {
  MemoryActionArgumentsSchema,
  MemoryResultSchema,
  memoryResource,
  type MemoryActionArguments,
  type MemoryProvenance,
  type MemoryResult,
  type MemoryScope,
} from '../../../../domain/memories/memory.ts';
import type { CapabilityAuthority } from '../../../../domain/capabilities/capability-registry.ts';
import type { IntegrationActionExecutor } from '../../../../ports/integrations/integration-action-executor.ts';
import type { OwnerResourceStore } from '../../../../ports/persistence/owner-resource-store.ts';
import {
  memoryIdForInvocation,
  memoryMutationOrderKey,
} from '../../../../ports/persistence/memory-store.ts';

export class LocalMemoryActionExecutor
  implements IntegrationActionExecutor<MemoryActionArguments, MemoryResult>
{
  public readonly integrationId = 'vera_memory';
  public readonly destination = {
    schemaVersion: 1 as const,
    adapterId: 'vera_memory',
    provider: 'vera',
    transport: 'local_store',
    dataBoundary: 'owner_controlled' as const,
  };
  public readonly maximumAuthority: CapabilityAuthority = {
    approval: 'always',
    projectContext: 'none',
    networkAccess: 'none',
    dataClasses: ['owner_request', 'long_term_memory'],
    sideEffects: ['personal_data_write'],
    credentials: 'none',
  };

  public constructor(private readonly store: OwnerResourceStore) {}

  public authorityFor(arguments_: MemoryActionArguments): CapabilityAuthority {
    return {
      ...this.maximumAuthority,
      sideEffects: arguments_.action === 'list' ? [] : ['personal_data_write'],
    };
  }

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }

  public async execute(
    input: {
      principalId: string;
      invocationId: string;
      startedAt: string;
      recovery: boolean;
      arguments: MemoryActionArguments;
      source?: {
        taskId: string;
        conversationId?: string;
        messageId?: string;
      };
    },
    options: { signal?: AbortSignal } = {},
  ): Promise<MemoryResult> {
    if (options.signal?.aborted === true) {
      throw new Error('Memory action was aborted.');
    }
    const arguments_ = MemoryActionArgumentsSchema.parse(input.arguments);
    if (arguments_.action === 'list') {
      const memories = await this.store.listMemories(input.principalId, {
        status: arguments_.status ?? 'active',
        limit: arguments_.limit ?? 50,
        ...(arguments_.kind === undefined ? {} : { kind: arguments_.kind }),
        ...(arguments_.scope === undefined ? {} : { scope: arguments_.scope }),
      });
      return MemoryResultSchema.parse({
        schemaVersion: 1,
        action: 'list',
        summary: `Found ${String(memories.length)} governed memory record(s).`,
        memories: memories.map(memoryResource),
      });
    }
    if (input.source === undefined) {
      throw new Error('A memory mutation requires owner-message provenance.');
    }
    const provenance: MemoryProvenance = {
      source: 'owner_message',
      taskId: input.source.taskId,
      ...(input.source.conversationId === undefined
        ? {}
        : { conversationId: input.source.conversationId }),
      ...(input.source.messageId === undefined
        ? {}
        : { messageId: input.source.messageId }),
      invocationId: input.invocationId,
    };
    if (arguments_.action === 'remember') {
      await this.assertProjectScope(input.principalId, arguments_.scope);
      const memory = await this.store.createMemory({
        schemaVersion: 1,
        id: memoryIdForInvocation(input.invocationId),
        revision: 1,
        principalId: input.principalId,
        kind: arguments_.kind,
        subject: arguments_.subject,
        content: arguments_.content,
        scope: arguments_.scope,
        sensitivity: arguments_.sensitivity ?? 'personal',
        status: 'active',
        provenance,
        creationInvocationId: input.invocationId,
        history: [],
        createdAt: input.startedAt,
        updatedAt: input.startedAt,
        lastMutation: {
          invocationId: input.invocationId,
          orderKey: memoryMutationOrderKey(input.startedAt, input.invocationId),
        },
      });
      return MemoryResultSchema.parse({
        schemaVersion: 1,
        action: 'remember',
        summary: `Remembered ${memory.kind} "${memory.subject}".`,
        memories: [memoryResource(memory)],
      });
    }
    const current = await this.store.findMemoryById(
      input.principalId,
      arguments_.memoryId,
    );
    if (current === null) {
      throw new Error(`Memory ${arguments_.memoryId} was not found.`);
    }
    if (arguments_.action === 'correct') {
      const scope = arguments_.scope ?? current.scope;
      await this.assertProjectScope(input.principalId, scope);
      const memory = await this.store.correctMemory({
        principalId: input.principalId,
        memoryId: current.id,
        replacement: {
          kind: arguments_.kind ?? current.kind,
          subject: arguments_.subject ?? current.subject,
          content: arguments_.content,
          scope,
          sensitivity: arguments_.sensitivity ?? current.sensitivity,
          provenance,
        },
        invocationId: input.invocationId,
        mutationAt: input.startedAt,
        recovery: input.recovery,
      });
      if (memory === null) {
        throw new Error(`Memory ${arguments_.memoryId} was not found.`);
      }
      if (memory.lastMutation.invocationId !== input.invocationId) {
        throw new Error(
          `Memory action ${input.invocationId} was superseded by a newer mutation.`,
        );
      }
      return MemoryResultSchema.parse({
        schemaVersion: 1,
        action: 'correct',
        summary: `Corrected memory "${memory.subject}" to revision ${String(memory.revision)}.`,
        memories: [memoryResource(memory)],
      });
    }
    const memory = await this.store.forgetMemory({
      principalId: input.principalId,
      memoryId: current.id,
      invocationId: input.invocationId,
      mutationAt: input.startedAt,
      recovery: input.recovery,
    });
    if (memory === null) {
      throw new Error(`Memory ${arguments_.memoryId} was not found.`);
    }
    if (memory.lastMutation.invocationId !== input.invocationId) {
      throw new Error(
        `Memory action ${input.invocationId} was superseded by a newer mutation.`,
      );
    }
    return MemoryResultSchema.parse({
      schemaVersion: 1,
      action: 'forget',
      summary: `Forgot memory "${memory.subject}".`,
      memories: [memoryResource(memory)],
    });
  }

  private async assertProjectScope(
    principalId: string,
    scope: MemoryScope,
  ): Promise<void> {
    if (scope.kind === 'global') return;
    const project = await this.store.findProjectById(
      principalId,
      scope.projectId,
    );
    if (project === null) {
      throw new Error(
        `Project ${scope.projectId} was not found for memory scope.`,
      );
    }
  }
}
