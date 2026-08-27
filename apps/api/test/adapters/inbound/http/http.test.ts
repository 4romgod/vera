import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createEvaluateModelDecision } from '../../../../src/application/model-decisions/evaluate-model-decision.ts';
import { buildApp } from '../../../../src/adapters/inbound/http/build-app.ts';
import { ModelProviderError } from '../../../../src/ports/model/model-provider.ts';
import { SoftwareChangePublicationSchema } from '../../../../src/domain/changes/software-change-publication.ts';
import { FakeModelProvider } from '../../../support/fake-model-provider.ts';

const apps: ReturnType<typeof buildApp>[] = [];

function appFor(
  candidate: unknown,
  readinessError?: Error,
  generationError?: Error,
) {
  const provider = new FakeModelProvider(
    candidate,
    readinessError,
    generationError,
  );
  const app = buildApp({
    evaluateModelDecision: createEvaluateModelDecision(provider),
    provider,
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

void describe('HTTP API', () => {
  void it('creates and approves a separately governed software-change publication', async () => {
    const provider = new FakeModelProvider({});
    const base = SoftwareChangePublicationSchema.parse({
      schemaVersion: 1,
      version: 1,
      id: 'publication_test',
      requestKey: 'publication-http-key',
      principalId: 'owner_v1',
      status: 'awaiting_approval',
      sourceApplication: {
        id: 'application_test',
        effectId: 'effect_application',
        version: 4,
      },
      project: { id: 'project_test', displayName: 'Test' },
      approval: {
        id: 'approval_publication',
        status: 'pending',
        reason: 'software_change_publication',
        effect: {
          adapterId: 'github_gh_cli',
          repository: { remoteName: 'origin', owner: 'owner', name: 'test' },
          baseRevision: 'a'.repeat(40),
          baseBranch: 'main',
          baseBranchRevision: 'a'.repeat(40),
          headBranch: 'vera/change-test',
          workspacePath: '/managed/test',
          treeRevision: 'b'.repeat(40),
          files: [
            {
              relativePath: 'README.md',
              operation: 'create',
              afterSha256: 'c'.repeat(64),
              bytes: 1,
            },
          ],
          author: { name: 'Vera Test', email: 'vera@example.test' },
          commitMessage: 'Publish test',
          pullRequest: { title: 'Publish test', body: 'Body', draft: true },
          authority: {
            commit: 'create_one',
            push: 'create_or_verify_head',
            pullRequest: 'create_or_verify',
            directBasePush: false,
            forcePush: false,
          },
        },
        requestedAt: '2026-08-27T00:00:00.000Z',
      },
      effect: { id: 'effect_publication', status: 'pending' },
      events: [],
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
    });
    let wakes = 0;
    const app = buildApp({
      evaluateModelDecision: createEvaluateModelDecision(provider),
      provider,
      softwareChangePublications: {
        create: (input) => {
          assert.equal(input.applicationId, 'application_test');
          assert.equal(input.pullRequest.draft, true);
          return Promise.resolve(base);
        },
        get: () => Promise.resolve(base),
        decideApproval: (input) => {
          assert.equal(input.decision, 'approved');
          return Promise.resolve({
            ...base,
            version: 2,
            status: 'approved',
            approval: { ...base.approval, status: 'approved' },
          });
        },
        cancel: () => Promise.resolve({ ...base, status: 'cancelled' }),
        progress: () => Promise.resolve(base),
        wake: () => {
          wakes += 1;
        },
      },
    });
    apps.push(app);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/change-applications/application_test/publications',
      headers: { 'idempotency-key': 'publication-http-key' },
      payload: {
        baseBranch: 'main',
        commitMessage: 'Publish test',
        pullRequest: { title: 'Publish test', body: 'Body', draft: true },
      },
    });
    assert.equal(created.statusCode, 202, created.body);
    assert.equal(
      created.headers.location,
      '/v1/software-change-publications/publication_test',
    );
    assert.equal(
      created.json<{
        approval: { effect: { authority: { forcePush: boolean } } };
      }>().approval.effect.authority.forcePush,
      false,
    );

    const decided = await app.inject({
      method: 'POST',
      url: '/v1/software-change-publications/publication_test/decision',
      payload: { decision: 'approved' },
    });
    assert.equal(decided.statusCode, 202, decided.body);
    assert.equal(decided.json<{ status: string }>().status, 'approved');
    assert.equal(wakes, 1);
  });

  void it('reports health and active model adapter', async () => {
    const app = appFor({});
    const response = await app.inject({ method: 'GET', url: '/health' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: 'ok',
      service: 'vera-api',
      model: { name: 'fake', model: 'fake-v1' },
    });
  });

  void it('allows the local web frontend without widening the loopback trust boundary', async () => {
    const app = appFor({});
    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://127.0.0.1:8081' },
    });
    const rejected = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://untrusted.example' },
    });

    assert.equal(
      allowed.headers['access-control-allow-origin'],
      'http://127.0.0.1:8081',
    );
    assert.equal(rejected.headers['access-control-allow-origin'], undefined);
  });

  void it('reports readiness when the configured provider and model are available', async () => {
    const app = appFor({});
    const response = await app.inject({ method: 'GET', url: '/ready' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: 'ready',
      service: 'vera-api',
      model: {
        name: 'fake',
        model: 'fake-v1',
        durationMs: 1,
        providerVersion: 'test',
      },
    });
  });

  void it('reports the precise sanitized readiness failure', async () => {
    const app = appFor(
      {},
      new ModelProviderError(
        'Configured fake model is not installed',
        'model_not_found',
      ),
    );
    const response = await app.inject({ method: 'GET', url: '/ready' });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      status: 'not_ready',
      service: 'vera-api',
      model: { name: 'fake', model: 'fake-v1' },
      error: {
        code: 'model_not_found',
        message: 'The configured model "fake-v1" is not available.',
      },
    });
  });

  void it('reports an unavailable operational store as not ready', async () => {
    const provider = new FakeModelProvider({});
    const app = buildApp({
      evaluateModelDecision: createEvaluateModelDecision(provider),
      provider,
      readinessChecks: [
        {
          name: 'mongodb_operational_store',
          check: () => Promise.reject(new Error('connection refused')),
        },
      ],
    });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/ready' });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      status: 'not_ready',
      service: 'vera-api',
      model: { name: 'fake', model: 'fake-v1' },
      error: {
        code: 'operational_store_unavailable',
        message: 'The mongodb_operational_store dependency is unavailable.',
        dependency: 'mongodb_operational_store',
      },
    });
  });

  void it('reports an unavailable planning specialist as not ready', async () => {
    const provider = new FakeModelProvider({});
    const app = buildApp({
      evaluateModelDecision: createEvaluateModelDecision(provider),
      provider,
      readinessChecks: [
        {
          name: 'development_planning_capability',
          check: () => Promise.reject(new Error('Codex is not authenticated')),
        },
      ],
    });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/ready' });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      status: 'not_ready',
      service: 'vera-api',
      model: { name: 'fake', model: 'fake-v1' },
      error: {
        code: 'planning_capability_unavailable',
        message:
          'The development_planning_capability dependency is unavailable.',
        dependency: 'development_planning_capability',
      },
    });
  });

  void it('reports an unavailable software-change specialist as not ready', async () => {
    const provider = new FakeModelProvider({});
    const app = buildApp({
      evaluateModelDecision: createEvaluateModelDecision(provider),
      provider,
      readinessChecks: [
        {
          name: 'software_change_capability',
          check: () => Promise.reject(new Error('Codex is not authenticated')),
        },
      ],
    });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/ready' });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      status: 'not_ready',
      service: 'vera-api',
      model: { name: 'fake', model: 'fake-v1' },
      error: {
        code: 'software_change_capability_unavailable',
        message: 'The software_change_capability dependency is unavailable.',
        dependency: 'software_change_capability',
      },
    });
  });

  void it('reports an unavailable generic capability without treating it as storage', async () => {
    const provider = new FakeModelProvider({});
    const app = buildApp({
      evaluateModelDecision: createEvaluateModelDecision(provider),
      provider,
      readinessChecks: [
        {
          name: 'web_research_capability',
          check: () => Promise.reject(new Error('Research model unavailable')),
        },
      ],
    });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/ready' });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      status: 'not_ready',
      service: 'vera-api',
      model: { name: 'fake', model: 'fake-v1' },
      error: {
        code: 'capability_unavailable',
        message: 'The web_research_capability dependency is unavailable.',
        dependency: 'web_research_capability',
      },
    });
  });

  void it('evaluates a request end to end through the HTTP boundary', async () => {
    const app = appFor({
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'No specialist is needed.',
      message: 'An API is a software interface.',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/model-decisions',
      payload: { message: 'What is an API?' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      response.json<{ decision: { kind: string } }>().decision.kind,
      'respond',
    );
  });

  void it('rejects malformed requests before invoking the application', async () => {
    const app = appFor({});
    const response = await app.inject({
      method: 'POST',
      url: '/v1/model-decisions',
      payload: { message: '', unexpected: true },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json<{ error: { code: string } }>().error.code,
      'invalid_request',
    );
  });

  void it('rejects unknown authority-bearing request properties', async () => {
    const app = appFor({
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'No specialist is needed.',
      message: 'This must not be reached.',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/model-decisions',
      payload: { message: 'Explain Vera.', authorized: true },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json<{ error: { code: string } }>().error.code,
      'invalid_request',
    );
  });

  void it('reports a missing model distinctly during generation', async () => {
    const app = appFor(
      {},
      undefined,
      new ModelProviderError('Model is not installed', 'model_not_found'),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/model-decisions',
      payload: { message: 'Hello' },
    });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      error: {
        code: 'model_not_found',
        message: 'The configured model "fake-v1" is not available.',
      },
    });
  });

  void it('reports provider timeouts with gateway-timeout status', async () => {
    const app = appFor(
      {},
      undefined,
      new ModelProviderError('Provider timed out', 'provider_timeout'),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/model-decisions',
      payload: { message: 'Hello' },
    });

    assert.equal(response.statusCode, 504);
    assert.equal(
      response.json<{ error: { code: string } }>().error.code,
      'provider_timeout',
    );
  });
});
