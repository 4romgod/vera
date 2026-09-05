import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import Fastify, { type FastifyInstance } from 'fastify';

import { registerLiveVoiceRoutes } from '../../../../src/adapters/inbound/http/routes/live-voice-routes.ts';
import type { LiveVoiceSessionService } from '../../../../src/application/voice/live-voice-session-service.ts';
import { LiveVoiceSessionSchema } from '../../../../src/domain/voice/live-voice-session.ts';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

void describe('live voice HTTP API', () => {
  void it('returns a scoped transport credential without internal authority fields', async () => {
    const session = LiveVoiceSessionSchema.parse({
      schemaVersion: 1,
      version: 1,
      id: 'voice_session_http',
      principalId: 'owner_v1',
      requestKey: 'voice-session-http',
      takeoverRequested: true,
      activeSlot: 1,
      conversationId: 'conversation_http',
      projectId: 'project_http',
      roomName: 'vera_voice_http',
      participantIdentity: 'vera_owner_http',
      status: 'starting',
      expiresAt: '2026-09-05T23:30:00.000Z',
      startedAt: '2026-09-05T23:00:00.000Z',
      updatedAt: '2026-09-05T23:00:00.000Z',
      turns: [],
      deliveries: [],
    });
    const calls: unknown[] = [];
    const voice = {
      enabled: true,
      create(input: unknown) {
        calls.push(input);
        return Promise.resolve({
          session,
          credential: {
            url: 'wss://vera.example.ts.net/livekit',
            token: 'scoped-room-token',
            expiresAt: session.expiresAt,
          },
        });
      },
    } as unknown as LiveVoiceSessionService;
    const app = Fastify();
    apps.push(app);
    registerLiveVoiceRoutes(app, { principalId: 'owner_v1', voice });

    const availability = await app.inject({ method: 'GET', url: '/v1/voice' });
    assert.deepEqual(availability.json(), { schemaVersion: 1, enabled: true });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/voice/sessions',
      headers: { 'idempotency-key': 'voice-session-http' },
      payload: {
        conversationId: 'conversation_http',
        projectId: 'project_http',
        takeover: true,
      },
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(
      response.headers.location,
      '/v1/voice/sessions/voice_session_http',
    );
    assert.deepEqual(calls, [
      {
        principalId: 'owner_v1',
        requestKey: 'voice-session-http',
        conversationId: 'conversation_http',
        projectId: 'project_http',
        takeover: true,
      },
    ]);
    assert.equal(
      response.json<{ transport: { token: string } }>().transport.token,
      'scoped-room-token',
    );
    assert.doesNotMatch(
      response.body,
      /principalId|requestKey|activeSlot|roomName|participantIdentity/u,
    );
  });
});
