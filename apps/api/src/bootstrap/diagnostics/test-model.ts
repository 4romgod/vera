import { createHash } from 'node:crypto';

import { createEvaluateModelDecision } from '../../application/model-decisions/evaluate-model-decision.ts';
import { createEvaluateGoalContinuation } from '../../application/model-decisions/evaluate-goal-continuation.ts';
import { ModelDevelopmentPlanningCapability } from '../../adapters/outbound/capabilities/development-planning/model-development-planning-capability.ts';
import { ArtifactSchema } from '../../domain/artifacts/artifact.ts';
import { nextAdaptiveGoalStepId } from '../../domain/goals/adaptive-goal.ts';
import { loadConfig } from '../config.ts';
import { loadEnvironmentFiles } from '../environment.ts';
import { createModelProvider } from '../../adapters/outbound/model/model-provider-registry.ts';
import {
  writeDiagnosticResult,
  type DiagnosticResult,
} from './diagnostic-output.ts';

function conformanceRunCount(value: string | undefined): number {
  const normalized = value ?? '1';
  if (!/^\d+$/u.test(normalized)) {
    throw new Error(
      'VERA_MODEL_CONFORMANCE_RUNS must be an integer from 1 to 10.',
    );
  }
  const count = Number(normalized);
  if (!Number.isSafeInteger(count) || count < 1 || count > 10) {
    throw new Error(
      'VERA_MODEL_CONFORMANCE_RUNS must be an integer from 1 to 10.',
    );
  }
  return count;
}

loadEnvironmentFiles();
const config = loadConfig();
const provider = createModelProvider(config.model);
const runs = conformanceRunCount(process.env.VERA_MODEL_CONFORMANCE_RUNS);
const qualificationStartedAt = performance.now();
const outcomes: DiagnosticResult[] = [];
const generations: {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}[] = [];

function record(result: DiagnosticResult): void {
  outcomes.push(result);
  const model = result.model;
  if (typeof model === 'object' && model !== null) {
    const modelRecord = model as Record<string, unknown>;
    const durationMs = modelRecord.durationMs;
    const usage = modelRecord.usage;
    const usageRecord =
      typeof usage === 'object' && usage !== null
        ? (usage as Record<string, unknown>)
        : undefined;
    const inputTokens =
      usageRecord === undefined ? undefined : usageRecord.inputTokens;
    const outputTokens =
      usageRecord === undefined ? undefined : usageRecord.outputTokens;
    if (
      typeof durationMs === 'number' &&
      typeof inputTokens === 'number' &&
      typeof outputTokens === 'number'
    ) {
      generations.push({ durationMs, inputTokens, outputTokens });
    }
  }
  writeDiagnosticResult(result);
}

const researchEnabled = config.research.adapterId !== 'disabled';
const enabledCapabilities = [
  { name: 'development_planning' as const, version: 1 as const },
  { name: 'software_change' as const, version: 1 as const },
  { name: 'personal_task_management' as const, version: 1 as const },
  { name: 'personal_reminder_management' as const, version: 1 as const },
  ...(researchEnabled
    ? [{ name: 'web_research' as const, version: 1 as const }]
    : []),
];

const cases = [
  {
    name: 'direct response',
    message: 'In one sentence, explain what an API is.',
    expected: 'respond',
  },
  {
    name: 'development delegation',
    message:
      'For project Vera, create an implementation plan for ticket VERA-101: add request IDs to API logs.',
    expected: 'approval_required',
  },
  ...(researchEnabled
    ? [
        {
          name: 'web research delegation',
          message:
            'Research the current OpenAI Responses API web-search contract and cite public sources.',
          expected: 'approval_required',
        },
      ]
    : []),
] as const;

let failed = false;
let providerVersion: string | undefined;
try {
  const readiness = await provider.checkReadiness();
  providerVersion = readiness.providerVersion;
  record({
    case: 'provider readiness',
    passed: true,
    provider: readiness.provider,
    model: readiness.model,
    providerVersion: readiness.providerVersion,
    durationMs: readiness.durationMs,
  });
} catch (error) {
  failed = true;
  record({
    case: 'provider readiness',
    passed: false,
    error: error instanceof Error ? error.message : 'unknown error',
  });
}

for (let run = 1; run <= runs; run += 1) {
  const evaluate = createEvaluateModelDecision(provider, undefined, {
    enabledCapabilities,
    ownerTimeZone: config.reminders.ownerTimeZone,
  });
  for (const testCase of cases) {
    try {
      const result = await evaluate(testCase.message);
      const proposalText =
        result.decision.kind === 'approval_required'
          ? JSON.stringify(result.decision.proposedArguments)
          : '';
      const faithfullyScoped =
        (testCase.name !== 'development delegation' ||
          (result.decision.kind === 'approval_required' &&
            'ticket' in result.decision.proposedArguments &&
            result.decision.proposedArguments.ticket.reference === 'VERA-101' &&
            result.decision.proposedArguments.project.name === 'Vera' &&
            !/distributed systems|middleware|interceptor|header|UUID/iu.test(
              proposalText,
            ))) &&
        (testCase.name !== 'web research delegation' ||
          (result.decision.kind === 'approval_required' &&
            result.decision.capability.name === 'web_research' &&
            !('project' in result.decision.proposedArguments)));
      const passed =
        result.decision.kind === testCase.expected && faithfullyScoped;
      failed ||= !passed;
      record({
        case: testCase.name,
        run,
        expected: testCase.expected,
        actual: result.decision.kind,
        faithfullyScoped,
        passed,
        model: result.model,
        proposal: result.proposal,
        decision: result.decision,
      });
    } catch (error) {
      failed = true;
      record({
        case: testCase.name,
        run,
        expected: testCase.expected,
        passed: false,
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  const planningArguments = {
    objective: 'Add request IDs to API logs.',
    ticket: {
      reference: 'VERA-305',
      details: 'Preserve this exact ticket text and add API request IDs.',
    },
    project: { name: 'Vera' },
  };
  try {
    const planning = await new ModelDevelopmentPlanningCapability(
      provider,
    ).execute({
      schemaVersion: 1,
      invocationId: 'invocation_model_conformance',
      arguments: planningArguments,
      project: { id: 'project_model_conformance', displayName: 'Vera' },
      context: {
        manifest: {
          schemaVersion: 1,
          projectId: 'project_model_conformance',
          sourceKind: 'local_git',
          revision: 'conformance',
          generatedAt: new Date().toISOString(),
          entries: [],
          totalFiles: 0,
          totalBytes: 0,
          limits: { maxFiles: 1, maxBytes: 1, maxFileBytes: 1 },
          exclusions: ['Conformance test supplies no repository evidence.'],
        },
        documents: [],
      },
      limits: { maxDurationMs: 120_000, maxArtifactBytes: 100_000 },
    });
    const identityPreserved =
      planning.plan.objective === planningArguments.objective &&
      planning.plan.ticket.reference === planningArguments.ticket.reference &&
      planning.plan.ticket.details === planningArguments.ticket.details &&
      planning.plan.project.name === planningArguments.project.name;
    const firstPhase = planning.plan.phases[0];
    const beginsWithEvidenceDiscovery =
      /inspect|review|discover|identify|locate|examine|obtain|acquir|request|gather/iu.test(
        [
          firstPhase?.name,
          firstPhase?.objective,
          ...(firstPhase?.steps ?? []),
        ].join(' '),
      );
    const prematurelySelectedTechnology = planning.plan.scope.some((item) =>
      /OpenTelemetry|Datadog|Jaeger|Zipkin|X-Trace-Id/iu.test(item),
    );
    const evidenceBounded =
      planning.plan.affectedProjectAreas.length === 0 &&
      planning.plan.assumptions.length === 0 &&
      planning.plan.unresolvedQuestions.length > 0 &&
      beginsWithEvidenceDiscovery &&
      !prematurelySelectedTechnology;
    const passed = identityPreserved && evidenceBounded;
    failed ||= !passed;
    record({
      case: 'development capability execution',
      run,
      expected: 'schema-valid, evidence-bounded plan with code-owned identity',
      actual: {
        identityPreserved,
        evidenceBounded,
        beginsWithEvidenceDiscovery,
        prematurelySelectedTechnology,
      },
      passed,
      model: planning.model,
      planSummary: {
        project: planning.plan.project,
        ticket: planning.plan.ticket,
        objective: planning.plan.objective,
        title: planning.plan.title,
        phaseCount: planning.plan.phases.length,
        assumptions: planning.plan.assumptions,
        unresolvedQuestions: planning.plan.unresolvedQuestions,
        affectedProjectAreas: planning.plan.affectedProjectAreas,
        firstPhase,
      },
    });
  } catch (error) {
    failed = true;
    record({
      case: 'development capability execution',
      run,
      passed: false,
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }

  if (provider.dataBoundary === 'owner_controlled' && researchEnabled) {
    const currentTime = '2030-01-01T00:00:00.000Z';
    const scheduledFor = '2030-01-02T07:00:00.000Z';
    const ownerMessage = `Research whether rain is expected in Cape Town on 2030-01-02 and, if rain is expected, remind me at ${scheduledFor} to take an umbrella.`;
    let adaptiveStage: 'planning' | 'continuation' = 'planning';
    try {
      const initial = await evaluate(ownerMessage, {
        temporalContext: {
          currentTime,
          ownerTimeZone: config.reminders.ownerTimeZone,
        },
      });
      const plan =
        initial.decision.kind === 'adaptive_goal_planned'
          ? initial.decision.plan
          : undefined;
      const researchRequirement = plan?.requirements.find(
        (requirement) =>
          requirement.capability === 'web_research' &&
          requirement.condition.kind === 'always',
      );
      const reminderRequirement = plan?.requirements.find(
        (requirement) =>
          requirement.capability === 'personal_reminder_management' &&
          requirement.condition.kind === 'evidence_dependent',
      );
      const planPassed =
        plan?.firstStep.capability === 'web_research' &&
        researchRequirement !== undefined &&
        reminderRequirement !== undefined;
      failed ||= !planPassed;
      record({
        case: 'adaptive goal planning',
        run,
        expected:
          'adaptive goal with unconditional research and evidence-dependent reminder',
        actual: initial.decision.kind,
        requirements: plan?.requirements,
        firstStep: plan?.firstStep,
        passed: planPassed,
        model: initial.model,
        proposal: initial.proposal,
      });

      if (planPassed) {
        adaptiveStage = 'continuation';
        const report = {
          schemaVersion: 1 as const,
          objective: 'Determine whether rain is expected in Cape Town.',
          report:
            'Rain is expected in Cape Town on 2030-01-02. The forecast reports a high probability of precipitation.',
          sources: [
            {
              title: 'Model conformance forecast fixture',
              url: 'https://example.com/forecast',
            },
          ],
          searchedAt: currentTime,
        };
        const serializedReport = JSON.stringify(report);
        const artifact = ArtifactSchema.parse({
          schemaVersion: 1,
          id: 'artifact_model_conformance_research',
          version: 1,
          principalId: 'owner_v1',
          taskId: 'task_model_conformance',
          runId: 'run_model_conformance',
          invocationId: 'invocation_model_conformance_research',
          type: 'research_report',
          mediaType: 'application/vnd.vera.research-report+json',
          sha256: createHash('sha256').update(serializedReport).digest('hex'),
          byteLength: Buffer.byteLength(serializedReport),
          producer: {
            provider: 'conformance_fixture',
            model: 'positive-evidence-v1',
            durationMs: 0,
          },
          content: report,
          createdAt: currentTime,
        });
        const continuation = await createEvaluateGoalContinuation(provider, {
          enabledCapabilities,
          ownerTimeZone: config.reminders.ownerTimeZone,
          clock: () => currentTime,
        })({
          ownerMessage,
          objective: plan.objective,
          completionCriteria: plan.completionCriteria,
          requirements: plan.requirements,
          observations: [
            {
              stepId: plan.firstStep.id,
              purpose: plan.firstStep.purpose,
              capability: {
                name: plan.firstStep.capability,
                version: plan.firstStep.version,
              },
              artifact,
            },
          ],
          nextStepId: nextAdaptiveGoalStepId([plan.firstStep.id]),
          remainingCapabilityInvocations: 2,
          temporalContext: {
            currentTime,
            ownerTimeZone: config.reminders.ownerTimeZone,
          },
        });
        const step =
          continuation.decision.kind === 'continue_goal'
            ? continuation.decision.step
            : undefined;
        const continuationPassed =
          step?.capability === 'personal_reminder_management' &&
          step.inputStepIds.length === 0 &&
          step.arguments.action === 'create' &&
          step.arguments.scheduledFor === scheduledFor &&
          step.arguments.timeZone === config.reminders.ownerTimeZone;
        failed ||= !continuationPassed;
        record({
          case: 'adaptive positive-evidence continuation',
          run,
          expected:
            'continue_goal with an owner-time-zone-preserving reminder step',
          actual: continuation.decision.kind,
          passed: continuationPassed,
          model: continuation.model,
          proposal: continuation.proposal,
          decision: continuation.decision,
        });
      } else {
        record({
          case: 'adaptive positive-evidence continuation',
          run,
          passed: false,
          skipped: true,
          reason: 'Adaptive goal planning did not qualify.',
        });
      }
    } catch (error) {
      failed = true;
      record({
        case:
          adaptiveStage === 'planning'
            ? 'adaptive goal planning'
            : 'adaptive positive-evidence continuation',
        run,
        passed: false,
        error: error instanceof Error ? error.message : 'unknown error',
      });
      if (adaptiveStage === 'planning') {
        record({
          case: 'adaptive positive-evidence continuation',
          run,
          passed: false,
          skipped: true,
          reason: 'Adaptive goal planning raised an error.',
        });
      }
    }
  } else {
    record({
      case: 'adaptive orchestration conformance',
      run,
      passed: true,
      skipped: true,
      reason:
        provider.dataBoundary !== 'owner_controlled'
          ? 'The selected orchestration provider is not owner-controlled.'
          : 'The selected profile does not enable web research.',
    });
  }
}

const caseOutcomes = outcomes.filter(
  (outcome) =>
    outcome.case !== 'provider readiness' && outcome.skipped !== true,
);
const skippedOutcomes = outcomes.filter((outcome) => outcome.skipped === true);
const passedCases = caseOutcomes.filter((outcome) => outcome.passed).length;
const totalDurationMs = Math.round(performance.now() - qualificationStartedAt);
const generationDurationMs = generations.map(({ durationMs }) => durationMs);
record({
  case: 'qualification summary',
  passed: !failed,
  provider: provider.name,
  model: provider.model,
  providerVersion,
  ...(config.model.provider === 'ollama'
    ? { reasoning: config.model.think }
    : {}),
  runs,
  casesAttempted: caseOutcomes.length,
  casesPassed: passedCases,
  casesSkipped: skippedOutcomes.length,
  passRate:
    caseOutcomes.length === 0
      ? 0
      : Number((passedCases / caseOutcomes.length).toFixed(4)),
  totalDurationMs,
  generationLatencyMs:
    generationDurationMs.length === 0
      ? undefined
      : {
          minimum: Math.min(...generationDurationMs),
          average: Math.round(
            generationDurationMs.reduce((total, value) => total + value, 0) /
              generationDurationMs.length,
          ),
          maximum: Math.max(...generationDurationMs),
        },
  usage: {
    inputTokens: generations.reduce(
      (total, generation) => total + generation.inputTokens,
      0,
    ),
    outputTokens: generations.reduce(
      (total, generation) => total + generation.outputTokens,
      0,
    ),
  },
  failures: caseOutcomes
    .filter((outcome) => !outcome.passed)
    .map((outcome) => ({ case: outcome.case, run: outcome.run })),
  skips: skippedOutcomes.map((outcome) => ({
    case: outcome.case,
    run: outcome.run,
    reason: outcome.reason,
  })),
});

if (failed) {
  process.exitCode = 1;
}
