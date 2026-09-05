import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  VeraApiError,
  VeraClient,
  type ChangeApplicationResource,
  type DevelopmentCampaignResource,
  type MissionResource,
  type SoftwareChangePublicationResource,
} from '../src/index.ts';

const fixtureTime = '2026-09-04T12:00:00.000Z';
const fixtureFile = {
  relativePath: 'src/test.ts',
  operation: 'create' as const,
  afterSha256: 'c'.repeat(64),
  bytes: 1,
};
const fixtureAuthority: DevelopmentCampaignResource['approval']['effect']['capabilities'][number]['authority'] =
  {
    approval: 'always',
    projectContext: 'required',
    networkAccess: 'provider_api',
    dataClasses: ['owner_request', 'project_context'],
    sideEffects: ['isolated_workspace_write'],
    credentials: 'server_managed',
  };
const fixtureDestination: DevelopmentCampaignResource['approval']['effect']['capabilities'][number]['destination'] =
  {
    schemaVersion: 1,
    adapterId: 'test_adapter',
    provider: 'test_provider',
    transport: 'https',
    dataBoundary: 'owner_controlled',
  };

function isGeneratedValidationError(error: unknown): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'ZodError');
  return true;
}

function developmentCampaignEffect(): DevelopmentCampaignResource['approval']['effect'] {
  return {
    adapterId: 'local_git_github' as const,
    completionMode: 'policy' as const,
    policyId: 'fixture',
    project: { id: 'project_test', displayName: 'Test' },
    repository: { owner: 'vera', name: 'vera' },
    baseBranch: 'main',
    baseRevision: 'a'.repeat(40),
    objective: 'Ship the test change.',
    ticket: { reference: 'VERA-401', details: 'Ship the test change.' },
    delivery: {
      commitMessage: 'feat: ship test change',
      pullRequest: { title: 'Ship test change', body: 'Body', draft: false },
    },
    capabilities: [
      {
        name: 'development_planning' as const,
        version: 1 as const,
        destination: fixtureDestination,
        authority: fixtureAuthority,
      },
    ],
    qualityGates: [
      {
        id: 'quality',
        label: 'Quality',
        executable: 'npm',
        arguments: ['test'],
        timeoutMs: 1_000,
      },
    ],
    protectedPathPrefixes: [],
    limits: {
      maxAttempts: 2,
      maxChangedFiles: 10,
      maxChangedBytes: 100_000,
      maxDurationMinutes: 30,
      minimumRequiredChecks: 1,
    },
    merge: {
      enabled: true,
      method: 'squash' as const,
      requireReviewApproval: true,
      synchronizeLocalBase: true,
    },
    authority: {
      implementation: 'bounded_capabilities' as const,
      application: 'exact_generated_patch' as const,
      verification: 'configured_commands' as const,
      publication: 'create_one_pull_request' as const,
      observation: 'github_checks_and_reviews' as const,
      merge: 'prohibited' as const,
      directBasePush: false as const,
      forcePush: false as const,
      policyMutation: false as const,
    },
  };
}

function campaignFixture(
  status: DevelopmentCampaignResource['status'],
): DevelopmentCampaignResource {
  return {
    schemaVersion: 1,
    version: status === 'succeeded' ? 3 : 1,
    id: 'campaign_test',
    requestKey: 'campaign-key',
    principalId: 'owner_v1',
    status,
    approval: {
      id: 'approval_campaign',
      status: status === 'awaiting_approval' ? 'pending' : 'approved',
      reason: 'development_campaign',
      effect: developmentCampaignEffect(),
      requestedAt: fixtureTime,
    },
    attempts: [],
    events: [],
    createdAt: fixtureTime,
    updatedAt: fixtureTime,
  };
}

function missionFixture(status: MissionResource['status']): MissionResource {
  return {
    schemaVersion: 1,
    version: status === 'succeeded' ? 3 : 1,
    id: 'mission_test',
    requestKey: 'mission-key',
    principalId: 'owner_v1',
    status,
    approval: {
      id: 'approval_mission',
      status: status === 'awaiting_approval' ? 'pending' : 'approved',
      reason: 'bounded_mission',
      effect: {
        policyId: 'fixture',
        objective: 'Deliver one bounded improvement.',
        completionCriteria: 'One verified pull request is ready.',
        project: { id: 'project_test', displayName: 'Test' },
        limits: { maxCampaigns: 1, maxDurationMinutes: 30 },
        campaign: {
          id: 'campaign_test',
          approvalId: 'approval_campaign',
          effect: developmentCampaignEffect(),
        },
        authority: {
          selectOneOutcome: true,
          createDevelopmentCampaigns: 1,
          createPullRequest: true,
          mergePullRequest: false,
          recurringExecution: false,
          missionPolicyMutation: false,
        },
      },
      requestedAt: fixtureTime,
    },
    events: [],
    createdAt: fixtureTime,
    updatedAt: fixtureTime,
  };
}

function changeApplicationFixture(
  status: ChangeApplicationResource['status'],
): ChangeApplicationResource {
  const approvalStatus =
    status === 'awaiting_approval' ? 'pending' : 'approved';
  return {
    schemaVersion: 1,
    version: 1,
    id: 'application_test',
    status,
    sourceArtifact: { id: 'artifact_test', sha256: 'a'.repeat(64) },
    project: { id: 'project_test', displayName: 'Test' },
    approval: {
      id: 'approval_test',
      status: approvalStatus,
      reason: 'software_change_application',
      sourceArtifact: { id: 'artifact_test', sha256: 'a'.repeat(64) },
      project: { id: 'project_test', displayName: 'Test' },
      effect: {
        adapterId: 'local_git_worktree',
        baseRevision: 'a'.repeat(40),
        branchName: 'vera/change-test',
        workspacePath: '/managed/application_test',
        patchSha256: 'b'.repeat(64),
        staged: true,
        files: [fixtureFile],
      },
      requestedAt: fixtureTime,
    },
    effect: {
      id: 'effect_test',
      status: status === 'succeeded' ? 'succeeded' : 'pending',
    },
    createdAt: fixtureTime,
    updatedAt: fixtureTime,
    links: { application: '/application', events: '/events' },
  };
}

function publicationFixture(
  status: SoftwareChangePublicationResource['status'],
): SoftwareChangePublicationResource {
  return {
    schemaVersion: 1,
    version: 1,
    id: 'publication_test',
    status,
    sourceApplication: {
      id: 'application_test',
      effectId: 'effect_test',
      version: 4,
    },
    project: { id: 'project_test', displayName: 'Test' },
    approval: {
      id: 'approval_publication',
      status: status === 'awaiting_approval' ? 'pending' : 'approved',
      reason: 'software_change_publication',
      effect: {
        adapterId: 'github_gh_cli',
        repository: { remoteName: 'origin', owner: 'vera', name: 'vera' },
        baseRevision: 'a'.repeat(40),
        baseBranch: 'main',
        baseBranchRevision: 'a'.repeat(40),
        headBranch: 'vera/change-test',
        workspacePath: '/managed/application_test',
        treeRevision: 'b'.repeat(40),
        files: [fixtureFile],
        author: { name: 'Vera', email: 'vera@example.com' },
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
      requestedAt: fixtureTime,
    },
    effect: {
      id: 'effect_publication',
      status: status === 'succeeded' ? 'succeeded' : 'pending',
    },
    createdAt: fixtureTime,
    updatedAt: fixtureTime,
    links: { publication: '/publication', events: '/events' },
  };
}

void describe('Vera HTTP client', () => {
  const knowledgeSource = {
    schemaVersion: 1 as const,
    id: 'knowledge_test',
    revision: 1,
    title: 'Vera brief',
    scope: { kind: 'global' as const },
    sensitivity: 'personal' as const,
    status: 'active' as const,
    provenance: {
      kind: 'owner_attachments' as const,
      attachments: [
        {
          id: 'attachment_test',
          kind: 'document' as const,
          filename: 'brief.txt',
          mediaType: 'text/plain' as const,
          byteLength: 12,
          sha256: 'a'.repeat(64),
        },
      ],
    },
    chunkCount: 1,
    contentSha256: 'b'.repeat(64),
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
  };

  void it('uploads document bytes with a transport type separate from the declared media type', async () => {
    const bytes = new TextEncoder().encode('Vera attachment').buffer;
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input, init) => {
        assert.equal(input, 'http://vera.test/v1/attachments');
        assert.ok(init);
        const headers = new Headers(init.headers);
        assert.equal(headers.get('content-type'), 'application/octet-stream');
        assert.equal(headers.get('x-vera-filename'), 'Vera%20brief.md');
        assert.equal(headers.get('x-vera-media-type'), 'text/markdown');
        assert.equal(init.body, bytes);
        return Promise.resolve(
          Response.json(
            {
              schemaVersion: 1,
              id: 'attachment_test',
              kind: 'document',
              filename: 'Vera brief.md',
              mediaType: 'text/markdown',
              byteLength: 15,
              sha256: 'a'.repeat(64),
              extraction: {
                status: 'ready',
                extractor: 'vera_document_text_v1',
                totalCharacters: 15,
                sha256: 'b'.repeat(64),
              },
              createdAt: '2026-08-27T00:00:00.000Z',
            },
            { status: 201 },
          ),
        );
      },
    });

    const attachment = await client.uploadAttachment({
      filename: 'Vera brief.md',
      mediaType: 'text/markdown',
      bytes,
    });

    assert.equal(attachment.id, 'attachment_test');
    assert.equal(
      client.attachmentPreviewUrl(attachment.id),
      'http://vera.test/v1/attachments/attachment_test/preview',
    );
  });

  void it('uploads a completed audio recording and validates its transcript', async () => {
    const audio = new Blob([Uint8Array.of(1, 2, 3)], {
      type: 'audio/webm',
    });
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input, init) => {
        assert.equal(input, 'http://vera.test/v1/audio/transcriptions');
        assert.ok(init);
        assert.equal(init.method, 'POST');
        assert.equal(
          new Headers(init.headers).get('content-type'),
          'audio/webm',
        );
        assert.equal(init.body, audio);
        return Promise.resolve(
          Response.json({
            schemaVersion: 1,
            text: 'Hello Vera.',
            provider: 'openai',
            model: 'gpt-transcribe',
            durationMs: 42,
          }),
        );
      },
    });

    assert.deepEqual(
      await client.transcribeAudio({ audio, contentType: 'audio/webm' }),
      {
        schemaVersion: 1,
        text: 'Hello Vera.',
        provider: 'openai',
        model: 'gpt-transcribe',
        durationMs: 42,
      },
    );
  });

  void it('uploads native recording bytes without changing their media type', async () => {
    const audio = Uint8Array.of(4, 5, 6).buffer;
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (_input, init) => {
        assert.ok(init);
        assert.equal(
          new Headers(init.headers).get('content-type'),
          'audio/mp4',
        );
        assert.equal(init.body, audio);
        return Promise.resolve(
          Response.json({
            schemaVersion: 1,
            text: 'Native recording.',
            provider: 'whisper_cpp',
            model: 'large-v3-turbo-q5_0',
            durationMs: 20,
          }),
        );
      },
    });

    const result = await client.transcribeAudio({
      audio,
      contentType: 'audio/mp4',
    });

    assert.equal(result.text, 'Native recording.');
  });

  void it('invokes the default fetch with its global receiver in browser runtimes', async () => {
    const originalFetch = globalThis.fetch;
    const replacement = function (this: unknown): Promise<Response> {
      assert.equal(this, globalThis);
      return Promise.resolve(Response.json({ schemaVersion: 1, memories: [] }));
    };
    globalThis.fetch = replacement;

    try {
      const client = new VeraClient();
      const result = await client.listMemories();
      assert.deepEqual(result.memories, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  void it('creates, searches, lists, and removes grounded knowledge through typed boundaries', async () => {
    const requests: { url: string; method: string; body?: unknown }[] = [];
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const method = init?.method ?? 'GET';
        const body: unknown =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as unknown)
            : undefined;
        requests.push({ url, method, body });
        if (url.endsWith('/v1/knowledge-search')) {
          return Promise.resolve(
            Response.json({
              schemaVersion: 1,
              query: 'Vera',
              searchedAt: '2026-09-04T00:01:00.000Z',
              citations: [
                {
                  sourceId: knowledgeSource.id,
                  sourceTitle: knowledgeSource.title,
                  chunkId: 'knowledge_chunk_test_1',
                  locator: 'brief.txt · lines 1-1',
                  excerpt: 'Vera is a personal orchestration system.',
                  score: 17,
                  attachments: knowledgeSource.provenance.attachments,
                },
              ],
            }),
          );
        }
        if (method === 'GET' && url.endsWith('/v1/knowledge-sources')) {
          return Promise.resolve(
            Response.json({
              schemaVersion: 1,
              sources: [knowledgeSource],
            }),
          );
        }
        return Promise.resolve(
          Response.json(
            method === 'DELETE'
              ? {
                  ...knowledgeSource,
                  revision: 2,
                  status: 'removed',
                  chunkCount: 0,
                }
              : knowledgeSource,
            { status: method === 'POST' ? 201 : 200 },
          ),
        );
      },
    });

    const created = await client.createKnowledgeSource({
      title: knowledgeSource.title,
      scope: { kind: 'global' },
      attachmentIds: ['attachment_test'],
      idempotencyKey: 'knowledge-client-create',
    });
    assert.equal(created.id, knowledgeSource.id);
    const listed = await client.listKnowledgeSources();
    assert.equal(listed.sources[0]?.title, knowledgeSource.title);
    const searched = await client.searchKnowledge({ query: 'Vera' });
    assert.equal(searched.citations[0]?.sourceId, knowledgeSource.id);
    const removed = await client.removeKnowledgeSource(knowledgeSource.id);
    assert.equal(removed.status, 'removed');

    assert.deepEqual(
      requests.map(({ method }) => method),
      ['POST', 'GET', 'POST', 'DELETE'],
    );
    assert.deepEqual(requests[0]?.body, {
      title: 'Vera brief',
      scope: { kind: 'global' },
      attachmentIds: ['attachment_test'],
    });
  });

  void it('loads and validates the capability catalog', async () => {
    let requestedUrl = '';
    const client = new VeraClient({
      baseUrl: 'http://vera.test/',
      fetch: (input) => {
        requestedUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return Promise.resolve(
          Response.json({
            schemaVersion: 1,
            capabilities: [
              {
                name: 'web_research',
                version: 1,
                description: 'Research public sources.',
                effect: 'external',
                artifact: {
                  type: 'research_report',
                  mediaType: 'application/vnd.vera.research-report+json',
                },
                acceptedInputArtifacts: [],
                authority: {
                  approval: 'always',
                  projectContext: 'none',
                  networkAccess: 'public_web_via_provider',
                  dataClasses: ['owner_request', 'public_web'],
                  sideEffects: [
                    'third_party_disclosure',
                    'public_network_read',
                  ],
                  credentials: 'server_managed',
                  maxWebSearchCalls: 4,
                },
                enabled: true,
              },
            ],
          }),
        );
      },
    });

    const catalog = await client.listCapabilities();

    assert.equal(requestedUrl, 'http://vera.test/v1/capabilities');
    assert.equal(catalog.capabilities[0]?.name, 'web_research');
  });

  void it('rejects an invalid capability catalog at the client boundary', async () => {
    const client = new VeraClient({
      fetch: () =>
        Promise.resolve(
          Response.json({ schemaVersion: 1, capabilities: [{ name: 42 }] }),
        ),
    });

    await assert.rejects(client.listCapabilities(), isGeneratedValidationError);
  });

  void it('manages external connections through generated validated operations', async () => {
    const requests: {
      url: string;
      method: string;
      key?: string;
      body?: string;
    }[] = [];
    const connection = {
      schemaVersion: 1,
      version: 1,
      id: 'connection_test',
      integrationId: 'github',
      adapterId: 'github_gh_cli',
      status: 'active',
      credentialBinding: { kind: 'host_session', host: 'github.com' },
      account: {
        providerAccountId: '123',
        login: 'vera-owner',
        profileUrl: 'https://github.com/vera-owner',
      },
      operations: ['issues_read', 'issues_create'],
      lastVerifiedAt: fixtureTime,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    };
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const headers = new Headers(init?.headers);
        const idempotencyKey = headers.get('idempotency-key');
        requests.push({
          url,
          method: init?.method ?? 'GET',
          ...(idempotencyKey === null ? {} : { key: idempotencyKey }),
          ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        });
        if (url.endsWith('/v1/integrations')) {
          return Promise.resolve(
            Response.json({
              schemaVersion: 1,
              integrations: [
                {
                  schemaVersion: 1,
                  id: 'github',
                  provider: 'github',
                  displayName: 'GitHub',
                  description: 'Manage issues.',
                  credentialManagement: 'host_session',
                  capabilities: ['work_item_management'],
                  operations: ['issues_read', 'issues_create'],
                },
              ],
            }),
          );
        }
        if (
          url.endsWith('/v1/integration-connections') &&
          init?.method !== 'POST'
        ) {
          return Promise.resolve(
            Response.json({ schemaVersion: 1, connections: [connection] }),
          );
        }
        return Promise.resolve(
          Response.json(connection, {
            status: url.endsWith('/v1/integration-connections') ? 201 : 200,
          }),
        );
      },
    });

    const catalog = await client.listIntegrations();
    const listed = await client.listIntegrationConnections();
    const connected = await client.connectIntegration({
      integrationId: 'github',
      idempotencyKey: 'connect-test',
    });
    await client.getIntegrationConnection(connected.id);
    await client.verifyIntegrationConnection(connected.id);
    await client.revokeIntegrationConnection(connected.id);

    assert.equal(catalog.integrations[0]?.id, 'github');
    assert.equal(listed.connections[0]?.account.login, 'vera-owner');
    assert.equal(requests[2]?.key, 'connect-test');
    assert.deepEqual(JSON.parse(requests[2].body ?? '{}'), {
      integrationId: 'github',
    });
    assert.deepEqual(
      requests.map(({ url }) => url),
      [
        'http://vera.test/v1/integrations',
        'http://vera.test/v1/integration-connections',
        'http://vera.test/v1/integration-connections',
        'http://vera.test/v1/integration-connections/connection_test',
        'http://vera.test/v1/integration-connections/connection_test/verification',
        'http://vera.test/v1/integration-connections/connection_test/revocation',
      ],
    );
  });

  void it('normalizes generated Axios operation errors at the facade boundary', async () => {
    const client = new VeraClient({
      fetch: () =>
        Promise.resolve(
          Response.json(
            {
              error: {
                code: 'capability_catalog_unavailable',
                message: 'Capability discovery failed.',
              },
            },
            { status: 500 },
          ),
        ),
    });

    await assert.rejects(client.listCapabilities(), (error) => {
      assert.ok(error instanceof VeraApiError);
      assert.equal(error.status, 500);
      assert.equal(error.code, 'capability_catalog_unavailable');
      return true;
    });
  });

  void it('lists the public command-free machine catalog', async () => {
    let requestedUrl = '';
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input) => {
        requestedUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return Promise.resolve(
          Response.json({
            schemaVersion: 1,
            machines: [
              {
                id: 'macmini',
                displayName: 'Mac Mini',
                adapter: 'local',
                diagnostics: [{ id: 'disk', label: 'Disk' }],
                services: [
                  {
                    id: 'redis',
                    displayName: 'Redis',
                    actions: ['start', 'stop', 'restart'],
                  },
                ],
              },
            ],
          }),
        );
      },
    });

    const catalog = await client.listMachines();

    assert.equal(requestedUrl, 'http://vera.test/v1/machines');
    assert.equal(catalog.machines[0]?.services[0]?.id, 'redis');
    const machine = catalog.machines[0];
    assert.ok(machine);
    assert.equal('command' in machine, false);
  });

  void it('rejects an invalid machine catalog at the client boundary', async () => {
    const client = new VeraClient({
      fetch: () =>
        Promise.resolve(
          Response.json({ schemaVersion: 1, machines: [{ id: 42 }] }),
        ),
    });

    await assert.rejects(client.listMachines(), isGeneratedValidationError);
  });

  void it('rejects operator-only machine commands at the client boundary', async () => {
    const client = new VeraClient({
      fetch: () =>
        Promise.resolve(
          Response.json({
            schemaVersion: 1,
            machines: [
              {
                id: 'macmini',
                displayName: 'Mac Mini',
                adapter: 'local',
                diagnostics: [],
                services: [],
                command: { executable: '/usr/bin/true', arguments: [] },
              },
            ],
          }),
        ),
    });

    await assert.rejects(client.listMachines(), isGeneratedValidationError);
  });

  void it('lists and validates owner-scoped personal tasks', async () => {
    let requestedUrl = '';
    const task = {
      schemaVersion: 1 as const,
      id: 'personal_task_test',
      title: 'Buy milk',
      status: 'open' as const,
      createdAt: '2026-08-26T10:00:00.000Z',
      updatedAt: '2026-08-26T10:00:00.000Z',
    };
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input) => {
        requestedUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        return Promise.resolve(
          Response.json(
            requestedUrl.includes('/personal-tasks/personal_task_test')
              ? task
              : { schemaVersion: 1, tasks: [task] },
          ),
        );
      },
    });

    const listed = await client.listPersonalTasks({
      status: 'open',
      limit: 10,
    });
    assert.equal(
      requestedUrl,
      'http://vera.test/v1/personal-tasks?status=open&limit=10',
    );
    assert.equal(listed.tasks[0]?.title, 'Buy milk');
    assert.equal(
      (await client.getPersonalTask('personal_task_test')).id,
      'personal_task_test',
    );
  });

  void it('lists reminders and resumes notification delivery from an opaque cursor', async () => {
    const reminder = {
      schemaVersion: 1 as const,
      id: 'reminder_test',
      message: 'Stand up',
      scheduledFor: '2026-08-26T10:00:00.000Z',
      timeZone: 'Africa/Johannesburg',
      status: 'delivered' as const,
      createdAt: '2026-08-26T09:00:00.000Z',
      updatedAt: '2026-08-26T10:00:00.000Z',
    };
    const notification = {
      schemaVersion: 1 as const,
      id: 'notification_test',
      reminderId: reminder.id,
      message: reminder.message,
      scheduledFor: reminder.scheduledFor,
      deliveredAt: '2026-08-26T10:00:00.000Z',
      status: 'unread' as const,
      channel: 'vera_inbox' as const,
    };
    const requestedUrls: string[] = [];
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        requestedUrls.push(url);
        if (url.includes('/notifications')) {
          return Promise.resolve(
            Response.json({
              schemaVersion: 1,
              notifications: [notification],
              nextCursor: 'opaque-cursor',
            }),
          );
        }
        return Promise.resolve(
          Response.json(
            url.includes('/reminders/reminder_test')
              ? reminder
              : { schemaVersion: 1, reminders: [reminder] },
          ),
        );
      },
    });

    assert.equal(
      (await client.listReminders({ status: 'delivered', limit: 5 }))
        .reminders[0]?.id,
      reminder.id,
    );
    assert.equal((await client.getReminder(reminder.id)).id, reminder.id);
    const page = await client.listNotifications({
      after: 'prior-cursor',
      limit: 10,
    });
    assert.equal(page.notifications[0]?.id, notification.id);
    assert.equal(page.nextCursor, 'opaque-cursor');
    assert.ok(
      requestedUrls.includes(
        'http://vera.test/v1/notifications?after=prior-cursor&limit=10',
      ),
    );
  });

  void it('lists and validates governed memory with exact scope filters', async () => {
    const memory = {
      schemaVersion: 1 as const,
      id: 'memory_test',
      revision: 1,
      kind: 'preference' as const,
      subject: 'Package manager',
      content: 'Use npm workspaces.',
      scope: { kind: 'project' as const, projectId: 'project_vera' },
      sensitivity: 'personal' as const,
      status: 'active' as const,
      provenance: {
        source: 'owner_message' as const,
        taskId: 'task_test',
        invocationId: 'invocation_test',
      },
      history: [],
      createdAt: '2026-08-26T10:00:00.000Z',
      updatedAt: '2026-08-26T10:00:00.000Z',
    };
    let requestedUrl = '';
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input) => {
        requestedUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return Promise.resolve(
          Response.json(
            requestedUrl.endsWith('/memory_test')
              ? memory
              : { schemaVersion: 1, memories: [memory] },
          ),
        );
      },
    });
    const listed = await client.listMemories({
      status: 'active',
      kind: 'preference',
      scope: { kind: 'project', projectId: 'project_vera' },
      limit: 10,
    });
    assert.equal(listed.memories[0]?.id, memory.id);
    assert.equal(
      requestedUrl,
      'http://vera.test/v1/memories?status=active&kind=preference&scopeKind=project&projectId=project_vera&limit=10',
    );
    assert.equal((await client.getMemory(memory.id)).content, memory.content);
  });

  void it('rejects incomplete governed-memory resources at the client boundary', async () => {
    const client = new VeraClient({
      fetch: () =>
        Promise.resolve(
          Response.json({
            schemaVersion: 1,
            memories: [
              {
                schemaVersion: 1,
                id: 'memory_incomplete',
                revision: 1,
                kind: 'fact',
                subject: 'Incomplete',
                content: 'Missing provenance and history.',
                scope: { kind: 'global' },
                sensitivity: 'personal',
                status: 'active',
                createdAt: '2026-08-26T10:00:00.000Z',
                updatedAt: '2026-08-26T10:00:00.000Z',
              },
            ],
          }),
        ),
    });

    await assert.rejects(client.listMemories(), isGeneratedValidationError);
  });

  void it('parses chunked notification server-sent events', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'retry: 1000\n\nevent: notification\nid: cursor\ndata:',
          ),
        );
        controller.enqueue(
          encoder.encode(
            ' {"schemaVersion":1,"id":"notification_test","reminderId":"reminder_test","message":"Stand up","scheduledFor":"2026-08-26T10:00:00.000Z","deliveredAt":"2026-08-26T10:00:00.000Z","status":"unread","channel":"vera_inbox"}\n\n',
          ),
        );
        controller.close();
      },
    });
    const client = new VeraClient({
      fetch: () =>
        Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
        ),
    });

    const received = [];
    for await (const notification of client.streamNotifications()) {
      received.push(notification);
    }
    assert.equal(received.length, 1);
    const event = received[0];
    assert.ok(event);
    assert.equal(event.cursor, 'cursor');
    assert.equal(event.notification.id, 'notification_test');
  });

  void it('sends idempotent task submissions and validates task identity', async () => {
    let request:
      | {
          input: Parameters<typeof fetch>[0];
          init?: Parameters<typeof fetch>[1];
        }
      | undefined;
    const client = new VeraClient({
      baseUrl: 'http://vera.test/',
      fetch: (input, init) => {
        request = { input, ...(init === undefined ? {} : { init }) };
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: 1,
              taskId: 'task_test',
              runId: 'run_test',
              taskStatus: 'active',
              runStatus: 'deciding',
              message: 'hello',
              createdAt: '2026-08-25T00:00:00.000Z',
              updatedAt: '2026-08-25T00:00:00.000Z',
              links: { task: '/task', run: '/run', events: '/events' },
            }),
            { status: 202, headers: { 'content-type': 'application/json' } },
          ),
        );
      },
    });

    const task = await client.submitTask({
      message: 'hello',
      projectId: 'project_test',
      attachmentIds: ['attachment_test'],
      idempotencyKey: 'client-test-key',
    });

    assert.equal(task.runStatus, 'deciding');
    assert.ok(request);
    assert.equal(request.input, 'http://vera.test/v1/tasks');
    assert.equal(
      new Headers(request.init?.headers).get('idempotency-key'),
      'client-test-key',
    );
    const requestBody = request.init?.body;
    if (typeof requestBody !== 'string') {
      throw new Error('Expected a JSON request body.');
    }
    assert.deepEqual(JSON.parse(requestBody), {
      message: 'hello',
      projectId: 'project_test',
      attachmentIds: ['attachment_test'],
    });
  });

  void it('does not declare a content type for bodyless generated requests', async () => {
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input, init) => {
        assert.equal(
          input,
          'http://vera.test/v1/notification-devices/notification_device_test/test',
        );
        assert.ok(init);
        assert.equal(init.method, 'POST');
        assert.equal(init.body, undefined);
        const headers = new Headers(init.headers);
        assert.equal(headers.get('content-type'), null);
        assert.equal(headers.get('idempotency-key'), 'notification-test-key');
        return Promise.resolve(
          Response.json({
            schemaVersion: 1,
            version: 1,
            id: 'push_delivery_test',
            deviceId: 'notification_device_test',
            sourceId: 'test:notification-test-key',
            category: 'test',
            deepLink: 'vera://attention',
            status: 'queued',
            attempts: 0,
            nextAttemptAt: fixtureTime,
            createdAt: fixtureTime,
            updatedAt: fixtureTime,
          }),
        );
      },
    });

    const delivery = await client.testNotificationDevice(
      'notification_device_test',
      'notification-test-key',
    );

    assert.equal(delivery.id, 'push_delivery_test');
  });

  void it('normalizes Vera error envelopes', async () => {
    const client = new VeraClient({
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'task_not_found', message: 'Missing task.' },
            }),
            { status: 404, headers: { 'content-type': 'application/json' } },
          ),
        ),
    });

    await assert.rejects(client.getTask('task_missing'), (error) => {
      assert.ok(error instanceof VeraApiError);
      assert.equal(error.status, 404);
      assert.equal(error.code, 'task_not_found');
      return true;
    });
  });

  void it('rejects an unknown run status at the client boundary', async () => {
    const client = new VeraClient({
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: 1,
              taskId: 'task_test',
              runId: 'run_test',
              runStatus: 'mystery',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
    });

    await assert.rejects(client.getRun('run_test'), isGeneratedValidationError);
  });

  void it('polls until a caller-defined approval boundary', async () => {
    let calls = 0;
    const client = new VeraClient({
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: 1,
              taskId: 'task_test',
              runId: 'run_test',
              taskStatus: 'active',
              runStatus: calls === 1 ? 'deciding' : 'awaiting_approval',
              message: 'plan',
              createdAt: '2026-08-25T00:00:00.000Z',
              updatedAt: '2026-08-25T00:00:00.000Z',
              links: { task: '/task', run: '/run', events: '/events' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      },
    });

    const task = await client.waitForRun('run_test', {
      intervalMs: 1,
      until: (current) => current.runStatus === 'awaiting_approval',
    });

    assert.equal(task.runStatus, 'awaiting_approval');
    assert.equal(calls, 2);
  });

  void it('creates and polls a controlled change application', async () => {
    const requests: string[] = [];
    let polls = 0;
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input, init) => {
        const requestUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        requests.push(`${init?.method ?? 'GET'} ${requestUrl}`);
        const isCreate = requestUrl.includes('/artifacts/');
        if (!isCreate) polls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify(
              isCreate
                ? changeApplicationFixture('awaiting_approval')
                : changeApplicationFixture(
                    polls === 1 ? 'applying' : 'succeeded',
                  ),
            ),
            {
              status: isCreate ? 202 : 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        );
      },
    });

    const created = await client.createChangeApplication({
      artifactId: 'artifact_test',
      idempotencyKey: 'application-key',
    });
    const completed = await client.waitForChangeApplication(created.id, {
      intervalMs: 1,
    });

    assert.equal(created.status, 'awaiting_approval');
    assert.equal(completed.status, 'succeeded');
    assert.equal(polls, 2);
    assert.match(
      requests[0] ?? '',
      /POST .*\/v1\/artifacts\/artifact_test\/applications/u,
    );
  });

  void it('creates and polls a separately approved software-change publication', async () => {
    let polls = 0;
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const isCreate = url.includes('/change-applications/');
        if (!isCreate) polls += 1;
        if (isCreate) {
          assert.equal(init?.method, 'POST');
          const requestBody = init.body;
          assert.equal(typeof requestBody, 'string');
          if (typeof requestBody !== 'string') {
            throw new Error('Expected a JSON request body.');
          }
          assert.doesNotMatch(
            requestBody,
            /"directBasePush"/u,
            'the server, not the caller, defines publication authority',
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify(
              isCreate
                ? publicationFixture('awaiting_approval')
                : publicationFixture(polls === 1 ? 'publishing' : 'succeeded'),
            ),
            {
              status: isCreate ? 202 : 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        );
      },
    });

    const created = await client.createSoftwareChangePublication({
      applicationId: 'application_test',
      baseBranch: 'main',
      commitMessage: 'Publish test',
      pullRequest: { title: 'Publish test', body: 'Body', draft: true },
      idempotencyKey: 'publication-key',
    });
    const completed = await client.waitForSoftwareChangePublication(
      created.id,
      { intervalMs: 1 },
    );

    assert.equal(created.status, 'awaiting_approval');
    assert.equal(completed.status, 'succeeded');
    assert.equal(polls, 2);
  });

  void it('discovers policies and drives a durable development campaign', async () => {
    const requests: {
      url: string;
      method: string;
      headers: Headers;
      body?: string;
    }[] = [];
    let polls = 0;
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const method = init?.method ?? 'GET';
        requests.push({
          url,
          method,
          headers: new Headers(init?.headers),
          ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        });
        if (url.endsWith('/development-campaign-policies')) {
          return Promise.resolve(
            Response.json({
              schemaVersion: 1,
              policies: [
                {
                  schemaVersion: 1,
                  id: 'fixture',
                  project: { id: 'project_test', displayName: 'Test' },
                  baseBranch: 'main',
                  qualityGates: [
                    { id: 'quality', label: 'Quality', timeoutMs: 1_000 },
                  ],
                  limits: {
                    maxAttempts: 2,
                    maxChangedFiles: 10,
                    maxChangedBytes: 100_000,
                    maxDurationMinutes: 30,
                    minimumRequiredChecks: 1,
                  },
                  merge: {
                    enabled: true,
                    method: 'squash',
                    requireReviewApproval: true,
                    synchronizeLocalBase: true,
                  },
                },
              ],
            }),
          );
        }
        if (method === 'POST') {
          return Promise.resolve(
            Response.json(campaignFixture('awaiting_approval'), {
              status: 202,
            }),
          );
        }
        polls += 1;
        return Promise.resolve(
          Response.json(
            campaignFixture(polls === 1 ? 'implementing' : 'succeeded'),
          ),
        );
      },
    });

    const policies = await client.listDevelopmentCampaignPolicies();
    const policy = policies.policies[0];
    assert.ok(policy);
    const created = await client.createDevelopmentCampaign({
      projectId: 'project_test',
      policyId: policy.id,
      objective: 'Add status.',
      ticket: { reference: 'VERA-401', details: 'Add status.' },
      delivery: {
        commitMessage: 'feat: add status',
        pullRequest: { title: 'feat: add status', body: 'Body', draft: false },
      },
      idempotencyKey: 'campaign-key',
    });
    const completed = await client.waitForDevelopmentCampaign(created.id, {
      intervalMs: 1,
    });

    assert.equal(policy.project.id, 'project_test');
    assert.equal(completed.status, 'succeeded');
    const creation = requests.find(
      (request) =>
        request.method === 'POST' &&
        request.url.endsWith('/v1/development-campaigns'),
    );
    assert.ok(creation);
    assert.equal(creation.headers.get('idempotency-key'), 'campaign-key');
    assert.doesNotMatch(creation.body ?? '', /qualityGates|directBasePush/u);
    assert.equal(polls, 2);
  });

  void it('requests and decides an exact development-campaign repair', async () => {
    const requests: {
      url: string;
      method: string;
      headers: Headers;
      body?: string;
    }[] = [];
    const campaign: DevelopmentCampaignResource = {
      ...campaignFixture('repair_awaiting_approval'),
      version: 8,
      id: 'campaign_repair',
      repairs: [],
    };
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        requests.push({
          url,
          method: init?.method ?? 'GET',
          headers: new Headers(init?.headers),
          ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        });
        return Promise.resolve(Response.json(campaign, { status: 202 }));
      },
    });

    await client.requestDevelopmentCampaignRepair({
      campaignId: 'campaign_repair',
      idempotencyKey: 'repair-key',
    });
    await client.decideDevelopmentCampaignRepair({
      campaignId: 'campaign_repair',
      repairId: 'repair_one',
      decision: 'approved',
    });

    const repairRequest = requests[0];
    const decisionRequest = requests[1];
    assert.ok(repairRequest);
    assert.ok(decisionRequest);
    assert.equal(repairRequest.headers.get('idempotency-key'), 'repair-key');
    assert.equal(
      repairRequest.url,
      'http://vera.test/v1/development-campaigns/campaign_repair/repairs',
    );
    assert.equal(
      decisionRequest.url,
      'http://vera.test/v1/development-campaigns/campaign_repair/repairs/repair_one/decision',
    );
    assert.deepEqual(JSON.parse(decisionRequest.body ?? ''), {
      decision: 'approved',
    });
  });

  void it('creates, approves, and waits for one bounded mission', async () => {
    const requests: { url: string; method: string; body?: string }[] = [];
    let polls = 0;
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const method = init?.method ?? 'GET';
        requests.push({
          url,
          method,
          ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        });
        if (method === 'POST') {
          return Promise.resolve(
            Response.json(missionFixture('awaiting_approval'), { status: 202 }),
          );
        }
        polls += 1;
        return Promise.resolve(
          Response.json(
            missionFixture(polls === 1 ? 'executing' : 'succeeded'),
          ),
        );
      },
    });

    const created = await client.createMission({
      projectId: 'project_vera',
      policyId: 'vera-bounded-mission',
      objective: 'Deliver one bounded improvement.',
      completionCriteria: 'One verified pull request is ready.',
      delivery: {
        commitMessage: 'feat: deliver bounded improvement',
        pullRequestTitle: 'Deliver bounded improvement',
      },
      idempotencyKey: 'mission-key',
    });
    await client.decideMission({
      missionId: created.id,
      decision: 'approved',
    });
    const completed = await client.waitForMission(created.id, {
      intervalMs: 1,
    });

    assert.equal(completed.status, 'succeeded');
    const creation = requests.find(
      (request) =>
        request.method === 'POST' && request.url.endsWith('/v1/missions'),
    );
    assert.ok(creation);
    assert.match(creation.body ?? '', /"action":"create"/u);
    assert.equal(polls, 2);
  });

  void it('rediscovers durable software-delivery attempts after a client restart', async () => {
    const requests: string[] = [];
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        requests.push(url);
        return Promise.resolve(
          Response.json(
            url.includes('/artifacts/')
              ? {
                  schemaVersion: 1,
                  applications: [
                    {
                      ...changeApplicationFixture('succeeded'),
                      id: 'application_recovered',
                    },
                  ],
                }
              : {
                  schemaVersion: 1,
                  publications: [
                    {
                      ...publicationFixture('awaiting_approval'),
                      id: 'publication_recovered',
                    },
                  ],
                },
          ),
        );
      },
    });

    const applications =
      await client.listChangeApplicationsForArtifact('artifact_test');
    const publications =
      await client.listSoftwareChangePublicationsForApplication(
        'application_recovered',
      );

    assert.equal(applications.applications[0]?.id, 'application_recovered');
    assert.equal(publications.publications[0]?.id, 'publication_recovered');
    assert.deepEqual(requests, [
      'http://vera.test/v1/artifacts/artifact_test/applications',
      'http://vera.test/v1/change-applications/application_recovered/publications',
    ]);
  });

  void it('waits for a terminal conversation reply to be projected', async () => {
    let calls = 0;
    const client = new VeraClient({
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: 1,
              taskId: 'task_test',
              runId: 'run_test',
              taskStatus: 'completed',
              runStatus: 'succeeded',
              conversationId: 'conversation_test',
              conversationReply: {
                status: calls === 1 ? 'pending' : 'projected',
                messageId: 'message_reply_test',
                createdAt: '2026-08-25T00:00:00.000Z',
                ...(calls === 1
                  ? {}
                  : { projectedAt: '2026-08-25T00:00:01.000Z' }),
              },
              message: 'hello',
              createdAt: '2026-08-25T00:00:00.000Z',
              updatedAt: '2026-08-25T00:00:00.000Z',
              links: { task: '/task', run: '/run', events: '/events' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      },
    });

    const completed = await client.waitForRun('run_test', { intervalMs: 1 });

    assert.equal(completed.conversationReply?.status, 'projected');
    assert.equal(calls, 2);
  });

  void it('applies the polling timeout to an in-flight HTTP request', async () => {
    const client = new VeraClient({
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('request aborted')),
            { once: true },
          );
        }),
    });

    const keepEventLoopAlive = setTimeout(() => undefined, 50);
    try {
      await assert.rejects(
        client.waitForRun('run_stuck', { timeoutMs: 5 }),
        /Timed out waiting for run run_stuck/u,
      );
    } finally {
      clearTimeout(keepEventLoopAlive);
    }
  });

  void it('forwards cancellation when loading adaptive-goal evidence', async () => {
    const controller = new AbortController();
    let markRequestStarted: (signal: AbortSignal) => void = () => undefined;
    const requestStarted = new Promise<AbortSignal>((resolve) => {
      markRequestStarted = resolve;
    });
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input, init) => {
        assert.equal(
          input,
          'http://vera.test/v1/artifacts/artifact_attachment_analysis',
        );
        const signal = init?.signal;
        assert.ok(signal);
        markRequestStarted(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new DOMException(
                      'The operation was aborted.',
                      'AbortError',
                    ),
              ),
            { once: true },
          );
        });
      },
    });

    const request = client.getArtifact('artifact_attachment_analysis', {
      signal: controller.signal,
    });
    const observedSignal = await requestStarted;

    const rejection = assert.rejects(request);
    controller.abort();
    assert.equal(observedSignal.aborted, true);
    await rejection;
  });

  void it('loads and validates the deterministic attention briefing', async () => {
    const briefing = {
      schemaVersion: 1 as const,
      generatedAt: '2026-09-04T12:00:00.000Z',
      headline: 'One thing needs your attention',
      summary: 'Nothing is urgent.',
      counts: { urgent: 0, high: 0, normal: 1, snoozed: 0, dismissed: 0 },
      items: [
        {
          schemaVersion: 1 as const,
          id: 'attention_test',
          reason: 'open_task',
          priority: 'normal' as const,
          title: 'Review Vera',
          summary: 'This task is still open.',
          occurredAt: '2026-09-04T10:00:00.000Z',
          target: {
            kind: 'personal_task' as const,
            personalTaskId: 'personal_task_test',
          },
          state: 'active' as const,
        },
      ],
      snoozedItems: [],
      dismissedItems: [],
    };
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input) => {
        assert.equal(input, 'http://vera.test/v1/attention');
        return Promise.resolve(Response.json(briefing));
      },
    });

    assert.deepEqual(await client.getAttentionBriefing(), briefing);
  });

  void it('sends an idempotent attention decision and validates the result', async () => {
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input, init) => {
        assert.equal(
          input,
          'http://vera.test/v1/attention-items/attention_test/decision',
        );
        if (init === undefined) throw new Error('Expected request options.');
        assert.equal(init.method, 'POST');
        assert.equal(
          new Headers(init.headers).get('idempotency-key'),
          'attention-decision-test',
        );
        assert.equal(typeof init.body, 'string');
        assert.deepEqual(JSON.parse(init.body as string), {
          decision: 'dismiss',
        });
        return Promise.resolve(
          Response.json({
            schemaVersion: 1,
            generatedAt: '2026-09-04T12:00:00.000Z',
            headline: "You're all caught up",
            summary: 'No current items.',
            counts: {
              urgent: 0,
              high: 0,
              normal: 0,
              snoozed: 0,
              dismissed: 0,
            },
            items: [],
            snoozedItems: [],
            dismissedItems: [],
          }),
        );
      },
    });

    const result = await client.decideAttention({
      attentionItemId: 'attention_test',
      decision: 'dismiss',
      idempotencyKey: 'attention-decision-test',
    });
    assert.equal(result.items.length, 0);
  });

  void it('validates provider-neutral external signals from the generated boundary', async () => {
    const signal = {
      schemaVersion: 1,
      version: 1,
      id: `external_signal_${'a'.repeat(32)}`,
      principalId: 'owner_v1',
      routineId: 'routine_watch',
      integrationId: 'github',
      connectionId: 'connection_github',
      project: { id: 'project_vera', displayName: 'Vera' },
      repository: { provider: 'github', owner: '4romgod', name: 'vera' },
      externalKey: 'pull:42:failed-checks',
      category: 'failed_check',
      title: 'Checks failed on #42',
      summary: 'quality-gate failed.',
      url: 'https://github.com/4romgod/vera/pull/42',
      occurredAt: '2026-09-05T10:00:00.000Z',
      status: 'active',
      firstObservedAt: '2026-09-05T10:01:00.000Z',
      lastObservedAt: '2026-09-05T10:01:00.000Z',
    };
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input) => {
        assert.equal(input, 'http://vera.test/v1/external-signals');
        return Promise.resolve(
          Response.json({ schemaVersion: 1, signals: [signal] }),
        );
      },
    });
    assert.deepEqual((await client.listExternalSignals()).signals, [signal]);
  });

  void it('waits for a durable routine run to reach a terminal state', async () => {
    let calls = 0;
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input) => {
        assert.equal(
          input,
          'http://vera.test/v1/routine-runs/routine_run_test',
        );
        calls += 1;
        const status = calls === 1 ? 'executing' : 'succeeded';
        return Promise.resolve(
          Response.json({
            schemaVersion: 1,
            version: calls,
            id: 'routine_run_test',
            routineId: 'routine_test',
            principalId: 'owner_v1',
            occurrenceKey: 'manual:test',
            trigger: 'manual',
            scheduledFor: '2026-09-04T12:00:00.000Z',
            action: {
              kind: 'machine_health_check',
              machineId: 'macmini',
            },
            status,
            startedAt: '2026-09-04T12:00:00.000Z',
            ...(status === 'succeeded'
              ? {
                  completedAt: '2026-09-04T12:00:01.000Z',
                  result: {
                    outcome: 'healthy',
                    summary: 'Mac mini passed the health check.',
                    diagnostic: {
                      schemaVersion: 1,
                      machine: {
                        id: 'macmini',
                        displayName: 'Mac mini',
                      },
                      adapter: 'local',
                      inspectedAt: '2026-09-04T12:00:01.000Z',
                      system: {
                        hostname: 'macmini.local',
                        platform: 'darwin',
                        architecture: 'arm64',
                      },
                      diagnostics: [],
                      services: [],
                    },
                  },
                }
              : {}),
            createdAt: '2026-09-04T12:00:00.000Z',
            updatedAt: '2026-09-04T12:00:01.000Z',
          }),
        );
      },
    });

    const completed = await client.waitForRoutineRun('routine_run_test', {
      intervalMs: 1,
    });

    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.result?.outcome, 'healthy');
    assert.equal(calls, 2);
  });

  void it('bounds an in-flight routine-run poll by its wait timeout', async () => {
    const client = new VeraClient({
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('request aborted')),
            { once: true },
          );
        }),
    });

    const keepEventLoopAlive = setTimeout(() => undefined, 50);
    try {
      await assert.rejects(
        client.waitForRoutineRun('routine_run_stuck', { timeoutMs: 5 }),
        /Timed out waiting for routine run routine_run_stuck/u,
      );
    } finally {
      clearTimeout(keepEventLoopAlive);
    }
  });

  void it('validates the private device-notification boundary', async () => {
    const device = {
      schemaVersion: 1,
      version: 1,
      id: 'notification_device_test',
      installationId: 'installation-test',
      provider: 'expo',
      projectId: 'project-test',
      platform: 'android',
      name: 'Phone',
      status: 'active',
      preferences: {
        approvals: true,
        reminders: true,
        tasks: true,
        failures: true,
        results: true,
      },
      registeredAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
      tokenSuffix: 'token]',
    };
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input) => {
        if (input === 'http://vera.test/v1/push-notifications/status') {
          return Promise.resolve(
            Response.json({
              schemaVersion: 1,
              enabled: true,
              provider: 'expo',
              projectId: 'project-test',
            }),
          );
        }
        return Promise.resolve(
          Response.json({ schemaVersion: 1, devices: [device] }),
        );
      },
    });
    assert.equal((await client.getPushNotificationStatus()).enabled, true);
    assert.equal(
      (await client.listNotificationDevices()).devices[0]?.id,
      device.id,
    );
    await assert.rejects(
      new VeraClient({
        fetch: () =>
          Promise.resolve(
            Response.json({
              schemaVersion: 1,
              devices: [{ ...device, status: 'invented' }],
            }),
          ),
      }).listNotificationDevices(),
      isGeneratedValidationError,
    );
  });
});
