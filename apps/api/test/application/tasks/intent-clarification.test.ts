import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { InMemoryExecutionStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-execution-store.ts';
import { InMemoryOwnerResourceStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { InMemoryScratchpad } from '../../../src/adapters/outbound/persistence/memory/in-memory-scratchpad.ts';
import { createConversationService } from '../../../src/application/conversations/conversation-service.ts';
import { admitClarificationRequest } from '../../../src/application/tasks/clarification-policy.ts';
import { createTaskLifecycle } from '../../../src/application/tasks/task-lifecycle.ts';
import type { EvaluateModelDecision } from '../../../src/application/model-decisions/evaluate-model-decision.ts';
import type { EvaluateGoalContinuation } from '../../../src/application/model-decisions/evaluate-goal-continuation.ts';
import { ArtifactSchema } from '../../../src/domain/artifacts/artifact.ts';
import type { DecisionResult } from '../../../src/domain/model/execution-decision.ts';
import { TaskAggregateSchema } from '../../../src/domain/tasks/task-aggregate.ts';
import type { CapabilityRuntimeRegistry } from '../../../src/ports/capabilities/capability-runtime.ts';

const now = '2026-09-08T10:00:00.000Z';

function clarificationDecision(input: {
  id: string;
  question: string;
  missingKey: string;
  resolvedFacts?: { key: string; value: string }[];
}): DecisionResult {
  const request = {
    question: input.question,
    missingInformation: [
      { key: input.missingKey, description: `Need ${input.missingKey}.` },
    ],
    resolvedFacts: input.resolvedFacts ?? [],
  };
  return {
    decisionId: input.id,
    proposal: {
      schemaVersion: 1,
      kind: 'request_clarification',
      decisionSummary: 'A required detail is unresolved.',
      ...request,
    },
    decision: { kind: 'clarification_required', ...request },
    model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
  };
}

function responseDecision(message: string): DecisionResult {
  return {
    decisionId: 'decision_complete',
    proposal: {
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'The clarified request can now be answered.',
      message,
    },
    decision: { kind: 'respond', message },
    model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
  };
}

function emptyCapabilities(): CapabilityRuntimeRegistry {
  return {
    declarations: () => [],
    enabledReferences: () => [],
    selected: () => null,
    resolve: () => null,
  };
}

function lifecycleHarness(input: {
  store: InMemoryExecutionStore;
  resources: InMemoryOwnerResourceStore;
  evaluate: EvaluateModelDecision;
  evaluateGoalContinuation?: EvaluateGoalContinuation;
  executionMode?: 'inline' | 'worker';
  idStart?: number;
}) {
  let sequence = input.idStart ?? 0;
  return createTaskLifecycle({
    store: input.store,
    resources: input.resources,
    scratchpad: new InMemoryScratchpad(),
    evaluateModelDecision: input.evaluate,
    ...(input.evaluateGoalContinuation === undefined
      ? {}
      : { evaluateGoalContinuation: input.evaluateGoalContinuation }),
    capabilities: emptyCapabilities(),
    contextAssembler: {
      assemble: () => Promise.reject(new Error('Unexpected project context.')),
    },
    clock: () => now,
    createId: (prefix) => `${prefix}_${String(++sequence)}`,
    ...(input.executionMode === undefined
      ? {}
      : { executionMode: input.executionMode }),
  });
}

void describe('durable intent clarification', () => {
  void it('continues one task through repeated clarification after a lifecycle restart', async () => {
    const store = new InMemoryExecutionStore();
    const resources = new InMemoryOwnerResourceStore();
    let conversationSequence = 0;
    const conversations = createConversationService({
      store: resources,
      clock: () => now,
      createId: (prefix) =>
        `${prefix}_conversation_${String(++conversationSequence)}`,
    });
    const conversation = await conversations.createConversation({
      principalId: 'owner_v1',
      creationKey: 'conversation-key',
    });
    const original = await conversations.appendOwnerMessage({
      principalId: 'owner_v1',
      conversationId: conversation.id,
      requestKey: 'message-original',
      content: 'Please arrange it.',
    });
    const decisions = [
      clarificationDecision({
        id: 'decision_first',
        question: 'What should I arrange?',
        missingKey: 'outcome',
      }),
      clarificationDecision({
        id: 'decision_second',
        question: 'When should the meeting happen?',
        missingKey: 'time',
        resolvedFacts: [{ key: 'outcome', value: 'A meeting with Sam.' }],
      }),
      responseDecision('I understand: arrange a meeting with Sam tomorrow.'),
    ];
    const contexts: Parameters<EvaluateModelDecision>[1][] = [];
    const evaluate: EvaluateModelDecision = (_message, context) => {
      contexts.push(context);
      const decision = decisions.shift();
      if (decision === undefined) throw new Error('Unexpected evaluation.');
      return Promise.resolve(decision);
    };
    const firstLifecycle = lifecycleHarness({ store, resources, evaluate });
    const submitted = await firstLifecycle.submit({
      principalId: 'owner_v1',
      requestKey: original.messageId,
      message: 'Please arrange it.',
      conversationId: conversation.id,
      messageId: original.messageId,
    });
    await conversations.attachTask({
      principalId: 'owner_v1',
      conversationId: conversation.id,
      messageId: original.messageId,
      taskId: submitted.task.id,
    });
    assert.equal(submitted.run.status, 'awaiting_clarification');
    assert.equal(submitted.run.conversationReply?.status, 'projected');

    const firstAnswer = await conversations.appendOwnerMessage({
      principalId: 'owner_v1',
      conversationId: conversation.id,
      requestKey: 'answer-one',
      content: 'A meeting with Sam.',
    });
    const restartedLifecycle = lifecycleHarness({
      store,
      resources,
      evaluate,
      idStart: 100,
    });
    const secondQuestion = await restartedLifecycle.answerClarification({
      taskId: submitted.task.id,
      principalId: 'owner_v1',
      requestKey: 'answer-one',
      messageId: firstAnswer.messageId,
      content: 'A meeting with Sam.',
    });
    await conversations.attachTask({
      principalId: 'owner_v1',
      conversationId: conversation.id,
      messageId: firstAnswer.messageId,
      taskId: submitted.task.id,
    });
    assert.equal(secondQuestion.run.status, 'awaiting_clarification');
    assert.equal(secondQuestion.run.clarification?.rounds.length, 2);

    const secondAnswer = await conversations.appendOwnerMessage({
      principalId: 'owner_v1',
      conversationId: conversation.id,
      requestKey: 'answer-two',
      content: 'Tomorrow afternoon.',
    });
    const completed = await restartedLifecycle.answerClarification({
      taskId: submitted.task.id,
      principalId: 'owner_v1',
      requestKey: 'answer-two',
      messageId: secondAnswer.messageId,
      content: 'Tomorrow afternoon.',
    });
    await conversations.attachTask({
      principalId: 'owner_v1',
      conversationId: conversation.id,
      messageId: secondAnswer.messageId,
      taskId: submitted.task.id,
    });

    assert.equal(completed.task.id, submitted.task.id);
    assert.equal(
      completed.run.status,
      'succeeded',
      JSON.stringify(completed.run.failure),
    );
    assert.equal(completed.run.clarification?.status, 'resolved');
    assert.equal(completed.run.conversationReply?.status, 'projected');
    assert.equal(
      contexts[1]?.clarification?.rounds[0]?.answer?.content,
      'A meeting with Sam.',
    );
    assert.equal(
      contexts[2]?.clarification?.rounds[1]?.answer?.content,
      'Tomorrow afternoon.',
    );
    const refreshed = await conversations.getConversation(
      'owner_v1',
      conversation.id,
    );
    assert.deepEqual(
      refreshed.messages.map(({ role, content, taskId }) => ({
        role,
        content,
        taskId,
      })),
      [
        {
          role: 'owner',
          content: 'Please arrange it.',
          taskId: submitted.task.id,
        },
        {
          role: 'vera',
          content: 'What should I arrange?',
          taskId: submitted.task.id,
        },
        {
          role: 'owner',
          content: 'A meeting with Sam.',
          taskId: submitted.task.id,
        },
        {
          role: 'vera',
          content: 'When should the meeting happen?',
          taskId: submitted.task.id,
        },
        {
          role: 'owner',
          content: 'Tomorrow afternoon.',
          taskId: submitted.task.id,
        },
        {
          role: 'vera',
          content: 'I understand: arrange a meeting with Sam tomorrow.',
          taskId: submitted.task.id,
        },
      ],
    );
  });

  void it('stops duplicate and repeatedly non-progressing questions', () => {
    const aggregate = TaskAggregateSchema.parse({
      schemaVersion: 1,
      version: 1,
      task: {
        id: 'task_policy',
        requestKey: 'policy',
        principalId: 'owner_v1',
        message: 'Do it.',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      run: {
        id: 'run_policy',
        status: 'deciding',
        createdAt: now,
        updatedAt: now,
        clarification: {
          schemaVersion: 1,
          status: 'evaluating_answer',
          maxRounds: 6,
          consecutiveNoProgressRounds: 1,
          totalWaitingMs: 0,
          rounds: [
            {
              id: 'clarification_one',
              decisionId: 'decision_one',
              question: 'Which project?',
              missingInformation: [
                { key: 'project', description: 'Need a project.' },
              ],
              resolvedFacts: [],
              askedAt: now,
              questionMessageId: 'message_question',
              answer: {
                messageId: 'message_answer',
                requestKey: 'answer',
                content: 'I am not sure.',
                answeredAt: now,
              },
            },
          ],
        },
      },
      events: [],
    });
    assert.equal(
      admitClarificationRequest(aggregate, {
        question: 'Which project?',
        missingInformation: [
          { key: 'project', description: 'Need a project.' },
        ],
        resolvedFacts: [],
      }).kind,
      'stall',
    );
    assert.equal(
      admitClarificationRequest(aggregate, {
        question: 'Can you identify the project another way?',
        missingInformation: [
          { key: 'project', description: 'Need a project.' },
        ],
        resolvedFacts: [],
      }).kind,
      'stall',
    );
  });

  void it('requires an exact task when a conversation has multiple open questions', async () => {
    const store = new InMemoryExecutionStore();
    const resources = new InMemoryOwnerResourceStore();
    const aggregate = (suffix: string) =>
      TaskAggregateSchema.parse({
        schemaVersion: 1,
        version: 1,
        task: {
          id: `task_${suffix}`,
          requestKey: `request-${suffix}`,
          principalId: 'owner_v1',
          conversationId: 'conversation_shared',
          message: `Request ${suffix}`,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        run: {
          id: `run_${suffix}`,
          status: 'awaiting_clarification',
          createdAt: now,
          updatedAt: now,
          clarification: {
            schemaVersion: 1,
            status: 'awaiting_answer',
            maxRounds: 6,
            consecutiveNoProgressRounds: 0,
            totalWaitingMs: 0,
            rounds: [
              {
                id: `clarification_${suffix}`,
                decisionId: `decision_${suffix}`,
                question: `Question ${suffix}?`,
                missingInformation: [
                  { key: `detail_${suffix}`, description: 'Need a detail.' },
                ],
                resolvedFacts: [],
                askedAt: now,
                questionMessageId: `message_${suffix}`,
              },
            ],
          },
        },
        events: [],
      });
    await store.create(aggregate('one'));
    await store.create(aggregate('two'));
    const lifecycle = lifecycleHarness({
      store,
      resources,
      evaluate: () => Promise.reject(new Error('Unexpected evaluation.')),
    });

    await assert.rejects(
      lifecycle.findAwaitingClarification({
        principalId: 'owner_v1',
        conversationId: 'conversation_shared',
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'clarification_ambiguous',
    );
    assert.equal(
      (
        await lifecycle.findAwaitingClarification({
          principalId: 'owner_v1',
          conversationId: 'conversation_shared',
          taskId: 'task_one',
        })
      )?.task.id,
      'task_one',
    );
  });

  void it('rejects clarification attachments that exceed the task-wide bound', async () => {
    const store = new InMemoryExecutionStore();
    const resources = new InMemoryOwnerResourceStore();
    const attachment = (index: number) => ({
      id: `attachment_${String(index)}`,
      filename: `attachment-${String(index)}.txt`,
      byteLength: 1,
      sha256: 'a'.repeat(64),
      kind: 'document' as const,
      mediaType: 'text/plain' as const,
    });
    const aggregate = TaskAggregateSchema.parse({
      schemaVersion: 1,
      version: 1,
      task: {
        id: 'task_attachment_limit',
        requestKey: 'attachment-limit',
        principalId: 'owner_v1',
        attachments: [1, 2, 3, 4, 5].map(attachment),
        message: 'Use these files.',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      run: {
        id: 'run_attachment_limit',
        status: 'awaiting_clarification',
        createdAt: now,
        updatedAt: now,
        clarification: {
          schemaVersion: 1,
          status: 'awaiting_answer',
          maxRounds: 6,
          consecutiveNoProgressRounds: 0,
          totalWaitingMs: 0,
          rounds: [
            {
              id: 'clarification_attachment_limit',
              decisionId: 'decision_attachment_limit',
              question: 'Is there another file?',
              missingInformation: [
                { key: 'file', description: 'Need the final file.' },
              ],
              resolvedFacts: [],
              askedAt: now,
              questionMessageId: 'message_attachment_limit',
            },
          ],
        },
      },
      events: [],
    });
    await store.create(aggregate);
    const lifecycle = lifecycleHarness({
      store,
      resources,
      evaluate: () => Promise.reject(new Error('Unexpected evaluation.')),
    });

    await assert.rejects(
      lifecycle.answerClarification({
        principalId: 'owner_v1',
        taskId: aggregate.task.id,
        requestKey: 'sixth-attachment',
        content: 'Yes, use this too.',
        attachments: [attachment(6)],
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'clarification_attachment_limit_exceeded',
    );
    assert.equal(
      (await lifecycle.getTask('owner_v1', aggregate.task.id)).run.status,
      'awaiting_clarification',
    );
  });

  void it('resumes an adaptive goal from its prior evidence after clarification', async () => {
    const store = new InMemoryExecutionStore();
    const resources = new InMemoryOwnerResourceStore();
    const report = {
      schemaVersion: 1 as const,
      objective: 'Check the forecast.',
      report: 'Rain is expected.',
      sources: [{ title: 'Forecast', url: 'https://example.com/forecast' }],
      searchedAt: now,
    };
    const serialized = JSON.stringify(report);
    const artifact = ArtifactSchema.parse({
      schemaVersion: 1,
      id: 'artifact_forecast',
      version: 1,
      principalId: 'owner_v1',
      taskId: 'task_adaptive_clarification',
      runId: 'run_adaptive_clarification',
      invocationId: 'invocation_forecast',
      type: 'research_report',
      mediaType: 'application/vnd.vera.research-report+json',
      sha256: createHash('sha256').update(serialized).digest('hex'),
      byteLength: Buffer.byteLength(serialized),
      producer: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
      content: report,
      createdAt: now,
    });
    await resources.createArtifact(artifact);
    const aggregate = TaskAggregateSchema.parse({
      schemaVersion: 1,
      version: 1,
      task: {
        id: 'task_adaptive_clarification',
        requestKey: 'adaptive-request',
        principalId: 'owner_v1',
        message: 'Research the forecast and summarize it.',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      run: {
        id: 'run_adaptive_clarification',
        status: 'deciding',
        createdAt: now,
        updatedAt: now,
        budget: {
          limits: {
            modelCalls: 4,
            capabilityInvocations: 3,
            retries: 2,
            maxDurationMs: 600_000,
            maxContextFiles: 100,
            maxContextBytes: 1_000_000,
            maxContextFileBytes: 100_000,
            maxArtifactBytes: 100_000,
          },
          consumed: { modelCalls: 1, capabilityInvocations: 1, retries: 0 },
        },
        goal: {
          schemaVersion: 2,
          mode: 'adaptive',
          objective: 'Research the forecast and summarize it.',
          summary: 'Research before formatting the response.',
          completionCriteria:
            'Return the verified forecast in the owner-selected format.',
          requirements: [
            {
              id: 'requirement_research',
              description: 'Research the forecast.',
              capability: 'web_research',
              version: 1,
              condition: { kind: 'always' },
            },
          ],
          status: 'active',
          currentStepIndex: 0,
          steps: [
            {
              id: 'step_1',
              purpose: 'Research the forecast.',
              inputStepIds: [],
              capability: 'web_research',
              version: 1,
              arguments: { objective: 'Check the forecast.' },
              status: 'succeeded',
              artifact: {
                id: artifact.id,
                version: artifact.version,
                type: artifact.type,
                mediaType: artifact.mediaType,
                sha256: artifact.sha256,
                byteLength: artifact.byteLength,
              },
            },
          ],
          continuations: [],
        },
      },
      events: [],
    });
    await store.create(aggregate);
    let calls = 0;
    const evaluateGoalContinuation: EvaluateGoalContinuation = (input) => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          decisionId: 'decision_ask_format',
          proposal: {
            schemaVersion: 1,
            kind: 'request_clarification',
            decisionSummary: 'The response format is unresolved.',
            question: 'Would you like a short or detailed summary?',
            missingInformation: [
              { key: 'format', description: 'Need the response format.' },
            ],
            resolvedFacts: [{ key: 'forecast', value: 'Rain is expected.' }],
            evidenceStepIds: ['step_1'],
          },
          decision: {
            kind: 'clarification_required',
            question: 'Would you like a short or detailed summary?',
            missingInformation: [
              { key: 'format', description: 'Need the response format.' },
            ],
            resolvedFacts: [{ key: 'forecast', value: 'Rain is expected.' }],
            evidenceStepIds: ['step_1'],
          },
          model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
          decidedAt: now,
        });
      }
      assert.equal(
        input.clarification?.rounds[0]?.answer?.content,
        'A short summary.',
      );
      return Promise.resolve({
        decisionId: 'decision_complete_goal',
        proposal: {
          schemaVersion: 1,
          kind: 'complete_goal',
          decisionSummary: 'The evidence and preferred format are available.',
          message: 'Rain is expected.',
          evidenceStepIds: ['step_1'],
          requirementResolutions: [
            {
              requirementId: 'requirement_research',
              status: 'satisfied',
              evidenceStepIds: ['step_1'],
            },
          ],
        },
        decision: {
          kind: 'complete_goal',
          message: 'Rain is expected.',
          evidenceStepIds: ['step_1'],
          requirementResolutions: [
            {
              requirementId: 'requirement_research',
              status: 'satisfied',
              evidenceStepIds: ['step_1'],
            },
          ],
        },
        model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
        decidedAt: now,
      });
    };
    const lifecycle = lifecycleHarness({
      store,
      resources,
      evaluate: () => Promise.reject(new Error('Unexpected initial decision.')),
      evaluateGoalContinuation,
      executionMode: 'worker',
    });

    const question = await lifecycle.progressTask(
      'owner_v1',
      aggregate.task.id,
    );
    assert.equal(question.run.status, 'awaiting_clarification');
    assert.equal(question.run.goal?.status, 'active');
    const resumed = await lifecycle.answerClarification({
      principalId: 'owner_v1',
      taskId: aggregate.task.id,
      requestKey: 'format-answer',
      content: 'A short summary.',
    });
    assert.equal(resumed.run.status, 'deciding');
    const completed = await lifecycle.progressTask(
      'owner_v1',
      aggregate.task.id,
    );
    assert.equal(
      completed.run.status,
      'succeeded',
      JSON.stringify(completed.run.failure),
    );
    assert.equal(completed.run.clarification?.status, 'resolved');
    assert.equal(completed.run.goal?.status, 'succeeded');
    assert.equal(calls, 2);
  });

  void it('grants each answered round its own evaluation within the model-call budget', async () => {
    const store = new InMemoryExecutionStore();
    const resources = new InMemoryOwnerResourceStore();
    const keys = ['outcome', 'audience', 'deadline', 'format'];
    const decisions: DecisionResult[] = [
      ...keys.map((key, index) =>
        clarificationDecision({
          id: `decision_round_${String(index + 1)}`,
          question: `What is the ${key}?`,
          missingKey: key,
        }),
      ),
      responseDecision('Everything needed is now known.'),
    ];
    const evaluate: EvaluateModelDecision = () => {
      const decision = decisions.shift();
      if (decision === undefined) throw new Error('Unexpected evaluation.');
      return Promise.resolve(decision);
    };
    const lifecycle = lifecycleHarness({ store, resources, evaluate });
    let current = await lifecycle.submit({
      principalId: 'owner_v1',
      requestKey: 'budget-request',
      message: 'Prepare it.',
    });
    for (const [index, key] of keys.entries()) {
      assert.equal(
        current.run.status,
        'awaiting_clarification',
        JSON.stringify(current.run.failure),
      );
      current = await lifecycle.answerClarification({
        principalId: 'owner_v1',
        taskId: current.task.id,
        requestKey: `budget-answer-${String(index + 1)}`,
        content: `The ${key} is settled.`,
      });
    }

    // Five model calls exceed the default four-call work budget; the four
    // owner answers each grant one evaluation, so the clarified task finishes.
    assert.equal(
      current.run.status,
      'succeeded',
      JSON.stringify(current.run.failure),
    );
    assert.equal(current.run.budget?.consumed.modelCalls, 5);
    assert.equal(decisions.length, 0);
  });

  void it('resolves a retried conversation answer to the task that recorded it', async () => {
    const store = new InMemoryExecutionStore();
    const resources = new InMemoryOwnerResourceStore();
    await store.create(
      TaskAggregateSchema.parse({
        schemaVersion: 1,
        version: 1,
        task: {
          id: 'task_answered',
          requestKey: 'request-answered',
          principalId: 'owner_v1',
          conversationId: 'conversation_retry',
          message: 'Book it.',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        run: {
          id: 'run_answered',
          status: 'deciding',
          createdAt: now,
          updatedAt: now,
          clarification: {
            schemaVersion: 1,
            status: 'evaluating_answer',
            maxRounds: 6,
            consecutiveNoProgressRounds: 0,
            totalWaitingMs: 0,
            rounds: [
              {
                id: 'clarification_answered',
                decisionId: 'decision_answered',
                question: 'Which day?',
                missingInformation: [
                  { key: 'day', description: 'Need the day.' },
                ],
                resolvedFacts: [],
                askedAt: now,
                questionMessageId: 'message_question',
                answer: {
                  messageId: 'message_answer',
                  requestKey: 'retry-key',
                  content: 'Friday.',
                  answeredAt: now,
                },
              },
            ],
          },
        },
        events: [],
      }),
    );
    const lifecycle = lifecycleHarness({
      store,
      resources,
      evaluate: () => Promise.reject(new Error('Unexpected evaluation.')),
    });

    const retried = await lifecycle.findAwaitingClarification({
      principalId: 'owner_v1',
      conversationId: 'conversation_retry',
      answerRequestKey: 'retry-key',
    });
    assert.equal(retried?.task.id, 'task_answered');
    assert.equal(
      await lifecycle.findAwaitingClarification({
        principalId: 'owner_v1',
        conversationId: 'conversation_other',
        answerRequestKey: 'retry-key',
      }),
      null,
    );
    await lifecycle.assertClarificationAnswerable({
      principalId: 'owner_v1',
      taskId: 'task_answered',
      requestKey: 'retry-key',
      content: 'Friday.',
    });
    await assert.rejects(
      lifecycle.assertClarificationAnswerable({
        principalId: 'owner_v1',
        taskId: 'task_answered',
        requestKey: 'retry-key',
        content: 'Saturday.',
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'idempotency_key_reused',
    );
  });
});
