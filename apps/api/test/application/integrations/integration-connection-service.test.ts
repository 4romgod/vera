import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryIntegrationConnectionStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-integration-connection-store.ts';
import { createIntegrationConnectionService } from '../../../src/application/integrations/integration-connection-service.ts';
import { GitHubIntegrationDefinition } from '../../../src/domain/integrations/integration-connection.ts';

void describe('integration connection service', () => {
  void it('adopts one host session without exposing credentials and revokes Vera independently', async () => {
    const store = new InMemoryIntegrationConnectionStore();
    let account = {
      providerAccountId: '123',
      login: 'vera-owner',
      profileUrl: 'https://github.com/vera-owner',
    };
    let time = 0;
    const service = createIntegrationConnectionService({
      store,
      connectors: [
        {
          adapterId: 'github_gh_cli',
          definition: GitHubIntegrationDefinition,
          credentialBinding: { kind: 'host_session', host: 'github.com' },
          inspectAccount: () => Promise.resolve(account),
        },
      ],
      clock: () => `2026-09-05T00:00:0${String(time++)}.000Z`,
      createId: (prefix) => `${prefix}_test_${String(time)}`,
    });

    assert.equal(service.catalog().integrations[0]?.id, 'github');
    const connected = await service.connect({
      principalId: 'owner_v1',
      integrationId: 'github',
      requestKey: 'connect-one',
    });
    assert.equal(connected.status, 'active');
    assert.equal(connected.account.login, 'vera-owner');
    assert.equal(JSON.stringify(connected).includes('requestKey'), false);
    assert.equal(JSON.stringify(connected).includes('principalId'), false);
    assert.equal(JSON.stringify(connected).includes('token'), false);

    const replay = await service.connect({
      principalId: 'owner_v1',
      integrationId: 'github',
      requestKey: 'another-explicit-request',
    });
    assert.equal(replay.id, connected.id);
    assert.equal(replay.version, connected.version);

    account = { ...account, providerAccountId: '456', login: 'other-owner' };
    await assert.rejects(service.verify('owner_v1', connected.id), {
      code: 'connection_conflict',
    });
    await assert.rejects(
      service.connect({
        principalId: 'owner_v1',
        integrationId: 'github',
        requestKey: 'silent-account-switch',
      }),
      { code: 'connection_conflict' },
    );

    const revoked = await service.revoke('owner_v1', connected.id);
    assert.equal(revoked.status, 'revoked');
    await assert.rejects(service.requireActive('owner_v1', 'github'), {
      code: 'connection_not_found',
    });
    const repeatedRevocation = await service.revoke('owner_v1', connected.id);
    assert.equal(repeatedRevocation.version, revoked.version);

    const reconnected = await service.connect({
      principalId: 'owner_v1',
      integrationId: 'github',
      requestKey: 'explicit-reconnect',
    });
    assert.equal(reconnected.id, connected.id);
    assert.equal(reconnected.status, 'active');
    assert.equal(reconnected.account.login, 'other-owner');
  });

  void it('keeps connections isolated by owner identity', async () => {
    const service = createIntegrationConnectionService({
      store: new InMemoryIntegrationConnectionStore(),
      connectors: [
        {
          adapterId: 'github_gh_cli',
          definition: GitHubIntegrationDefinition,
          credentialBinding: { kind: 'host_session', host: 'github.com' },
          inspectAccount: () =>
            Promise.resolve({ providerAccountId: '123', login: 'owner' }),
        },
      ],
    });
    const connection = await service.connect({
      principalId: 'owner_one',
      integrationId: 'github',
      requestKey: 'owner-one',
    });
    await assert.rejects(service.get('owner_two', connection.id), {
      code: 'connection_not_found',
    });
  });

  void it('reconciles a connection created concurrently after the initial lookup', async () => {
    const backing = new InMemoryIntegrationConnectionStore();
    const connector = {
      adapterId: 'github_gh_cli',
      definition: GitHubIntegrationDefinition,
      credentialBinding: { kind: 'host_session' as const, host: 'github.com' },
      inspectAccount: () =>
        Promise.resolve({ providerAccountId: '123', login: 'owner' }),
    };
    const first = createIntegrationConnectionService({
      store: backing,
      connectors: [connector],
    });
    const connected = await first.connect({
      principalId: 'owner_v1',
      integrationId: 'github',
      requestKey: 'first-connect',
    });
    await first.revoke('owner_v1', connected.id);

    let hidInitialLookup = false;
    const racingStore = {
      create: backing.create.bind(backing),
      findById: backing.findById.bind(backing),
      findByIntegrationId: (principalId: string, integrationId: string) => {
        if (!hidInitialLookup) {
          hidInitialLookup = true;
          return Promise.resolve(null);
        }
        return backing.findByIntegrationId(principalId, integrationId);
      },
      list: backing.list.bind(backing),
      replace: backing.replace.bind(backing),
      checkReadiness: backing.checkReadiness.bind(backing),
      close: backing.close.bind(backing),
    };
    const raced = createIntegrationConnectionService({
      store: racingStore,
      connectors: [connector],
    });
    const reconciled = await raced.connect({
      principalId: 'owner_v1',
      integrationId: 'github',
      requestKey: 'racing-connect',
    });

    assert.equal(reconciled.id, connected.id);
    assert.equal(reconciled.status, 'active');
    assert.equal(reconciled.version, 3);
  });
});
