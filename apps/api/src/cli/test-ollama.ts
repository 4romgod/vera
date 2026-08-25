import { createEvaluateModelDecision } from '../application/evaluate-model-decision.ts';
import { ModelDevelopmentPlanningCapability } from '../capabilities/model-development-planning-capability.ts';
import { loadConfig } from '../config.ts';
import { loadEnvironmentFile } from '../environment.ts';
import { OllamaModelProvider } from '../model/ollama-model-provider.ts';

loadEnvironmentFile();
const config = loadConfig({
  ...process.env,
  VERA_MODEL_PROVIDER: 'ollama',
});
const provider = new OllamaModelProvider(config.ollama);
const evaluate = createEvaluateModelDecision(provider);

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
] as const;

let failed = false;
for (const testCase of cases) {
  const result = await evaluate(testCase.message);
  const proposalText =
    result.decision.kind === 'approval_required'
      ? JSON.stringify(result.decision.proposedArguments)
      : '';
  const faithfullyScoped =
    testCase.name !== 'development delegation' ||
    (result.decision.kind === 'approval_required' &&
      result.decision.proposedArguments.ticket.reference === 'VERA-101' &&
      result.decision.proposedArguments.project.name === 'Vera' &&
      !/distributed systems|middleware|interceptor|header|UUID/iu.test(
        proposalText,
      ));
  const passed = result.decision.kind === testCase.expected && faithfullyScoped;
  failed ||= !passed;
  process.stdout.write(
    `${JSON.stringify({
      case: testCase.name,
      expected: testCase.expected,
      actual: result.decision.kind,
      faithfullyScoped,
      passed,
      model: result.model,
      proposal: result.proposal,
      decision: result.decision,
    })}\n`,
  );
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
    invocationId: 'invocation_ollama_conformance',
    arguments: planningArguments,
    project: { id: 'project_ollama_conformance', displayName: 'Vera' },
    context: {
      manifest: {
        schemaVersion: 1,
        projectId: 'project_ollama_conformance',
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
  const beginsWithInspection =
    /inspect|review|discover|identify|locate|examine/iu.test(
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
    beginsWithInspection &&
    !prematurelySelectedTechnology;
  const passed = identityPreserved && evidenceBounded;
  failed ||= !passed;
  process.stdout.write(
    `${JSON.stringify({
      case: 'development capability execution',
      expected: 'schema-valid, evidence-bounded plan with code-owned identity',
      actual: {
        identityPreserved,
        evidenceBounded,
        beginsWithInspection,
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
    })}\n`,
  );
} catch (error) {
  failed = true;
  process.stdout.write(
    `${JSON.stringify({
      case: 'development capability execution',
      passed: false,
      error: error instanceof Error ? error.message : 'unknown error',
    })}\n`,
  );
}

if (failed) {
  process.exitCode = 1;
}
