import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createEvaluateModelDecision } from '../src/application/evaluate-model-decision.ts';
import { buildApp } from '../src/http/build-app.ts';
import { ModelProviderError } from '../src/model/model-provider.ts';
import { FakeModelProvider } from './support/fake-model-provider.ts';

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
