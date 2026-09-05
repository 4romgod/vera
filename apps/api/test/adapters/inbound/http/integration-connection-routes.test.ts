import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { buildApp } from '../../../../src/adapters/inbound/http/build-app.ts';
import { createEvaluateModelDecision } from '../../../../src/application/model-decisions/evaluate-model-decision.ts';
import type { IntegrationConnectionService } from '../../../../src/application/integrations/integration-connection-service.ts';
import { IntegrationDefinitions } from '../../../../src/domain/integrations/integration-connection.ts';
import { FakeModelProvider } from '../../../support/fake-model-provider.ts';

const apps: ReturnType<typeof buildApp>[] = [];
const connection = {
  schemaVersion: 1 as const,
  version: 1,
  id: 'connection_test',
  integrationId: 'github',
  adapterId: 'github_gh_cli',
  status: 'active' as const,
  credentialBinding: { kind: 'host_session' as const, host: 'github.com' },
  account: {
    providerAccountId: '123',
    login: 'vera-owner',
    profileUrl: 'https://github.com/vera-owner',
  },
  operations: ['issues_read', 'issues_create'],
  lastVerifiedAt: '2026-09-05T00:00:00.000Z',
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

void describe('integration connection HTTP API', () => {
  void it('exposes a non-secret catalog and explicit connection lifecycle', async () => {
    const calls: string[] = [];
    const integrations: IntegrationConnectionService = {
      catalog: () => ({
        schemaVersion: 1,
        integrations: IntegrationDefinitions,
      }),
      list: () => Promise.resolve([connection]),
      get: (_principalId, connectionId) => {
        calls.push(`get:${connectionId}`);
        return Promise.resolve(connection);
      },
      connect: ({ integrationId, requestKey }) => {
        calls.push(`connect:${integrationId}:${requestKey}`);
        return Promise.resolve(connection);
      },
      verify: (_principalId, connectionId) => {
        calls.push(`verify:${connectionId}`);
        return Promise.resolve(connection);
      },
      revoke: (_principalId, connectionId) => {
        calls.push(`revoke:${connectionId}`);
        return Promise.resolve({
          ...connection,
          version: 2,
          status: 'revoked',
          revokedAt: '2026-09-05T00:01:00.000Z',
          updatedAt: '2026-09-05T00:01:00.000Z',
        });
      },
      requireActive: () => {
        throw new Error(
          'The HTTP control plane must not request internal records.',
        );
      },
    };
    const provider = new FakeModelProvider({});
    const app = buildApp({
      provider,
      evaluateModelDecision: createEvaluateModelDecision(provider),
      integrations,
    });
    apps.push(app);

    const catalog = await app.inject({
      method: 'GET',
      url: '/v1/integrations',
    });
    assert.equal(catalog.statusCode, 200, catalog.body);
    assert.deepEqual(
      catalog
        .json<{ integrations: { id: string }[] }>()
        .integrations.map(({ id }) => id),
      ['github'],
    );
    const connected = await app.inject({
      method: 'POST',
      url: '/v1/integration-connections',
      headers: { 'idempotency-key': 'connect-github' },
      payload: { integrationId: 'github' },
    });
    assert.equal(connected.statusCode, 201, connected.body);
    assert.equal(
      connected.headers.location,
      '/v1/integration-connections/connection_test',
    );
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/integration-connections',
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(
      listed.json<{ connections: unknown[] }>().connections.length,
      1,
    );
    assert.equal(listed.body.includes('principalId'), false);
    assert.equal(listed.body.includes('requestKey'), false);
    assert.equal(listed.body.toLowerCase().includes('token'), false);

    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/integration-connections/connection_test',
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/integration-connections/connection_test/verification',
        })
      ).statusCode,
      200,
    );
    const revoked = await app.inject({
      method: 'POST',
      url: '/v1/integration-connections/connection_test/revocation',
    });
    assert.equal(revoked.statusCode, 200, revoked.body);
    assert.equal(revoked.json<{ status: string }>().status, 'revoked');
    assert.deepEqual(calls, [
      'connect:github:connect-github',
      'get:connection_test',
      'verify:connection_test',
      'revoke:connection_test',
    ]);
  });

  void it('requires an idempotency key when enabling a connection', async () => {
    const provider = new FakeModelProvider({});
    const app = buildApp({
      provider,
      evaluateModelDecision: createEvaluateModelDecision(provider),
      integrations: {
        catalog: () => ({
          schemaVersion: 1,
          integrations: IntegrationDefinitions,
        }),
        connect: () => Promise.resolve(connection),
        get: () => Promise.resolve(connection),
        list: () => Promise.resolve([]),
        verify: () => Promise.resolve(connection),
        revoke: () => Promise.resolve(connection),
        requireActive: () => {
          throw new Error('Not used.');
        },
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/integration-connections',
      payload: { integrationId: 'github' },
    });
    assert.equal(response.statusCode, 400, response.body);
  });
});
