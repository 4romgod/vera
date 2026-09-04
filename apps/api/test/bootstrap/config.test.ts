import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { loadConfig } from '../../src/bootstrap/config.ts';

void describe('application configuration', () => {
  void it('defaults to the owner-controlled Ollama provider', () => {
    const config = loadConfig({});
    assert.deepEqual(config.model, {
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'gemma4-12b-64k:latest',
      think: false,
      timeoutMs: 120_000,
      readinessTimeoutMs: 3_000,
      maxOutputTokens: 8_192,
    });
    assert.deepEqual(config.vision, {
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3-vl:8b',
      think: false,
      timeoutMs: 120_000,
      readinessTimeoutMs: 3_000,
      maxOutputTokens: 8_192,
    });
    assert.deepEqual(config.conversationContext, {
      maxMessages: 20,
      maxCharacters: 40_000,
    });
    assert.deepEqual(config.change, {
      adapterId: 'codex_cli',
      adapters: { codexCli: { command: 'codex' } },
    });
    assert.deepEqual(config.research, { adapterId: 'disabled' });
    assert.deepEqual(config.transcription, {
      provider: 'disabled',
      maxAudioBytes: 25_000_000,
    });
    assert.deepEqual(config.publication, {
      adapterId: 'github_gh_cli',
      gitCommand: 'git',
      ghCommand: 'gh',
    });
    assert.deepEqual(config.developmentCampaigns, {
      schemaVersion: 1,
      policies: [],
    });
    assert.deepEqual(config.missions, { schemaVersion: 1, policies: [] });
  });

  void it('configures Ollama reasoning without coupling it to a model name', () => {
    assert.deepEqual(
      loadConfig({
        VERA_MODEL_PROVIDER: 'ollama',
        OLLAMA_MODEL: 'gpt-oss:20b',
        OLLAMA_THINK: 'medium',
      }).model,
      {
        provider: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'gpt-oss:20b',
        think: 'medium',
        timeoutMs: 120_000,
        readinessTimeoutMs: 3_000,
        maxOutputTokens: 8_192,
      },
    );
    assert.throws(
      () => loadConfig({ OLLAMA_THINK: 'sometimes' }),
      /OLLAMA_THINK/u,
    );
  });

  void it('configures vision independently from the orchestration model', () => {
    assert.deepEqual(
      loadConfig({
        VERA_MODEL_PROVIDER: 'ollama',
        OLLAMA_MODEL: 'gpt-oss:20b',
        VERA_VISION_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'vision-key',
        GEMINI_VISION_MODEL: 'models/gemini-vision-test',
      }).vision,
      {
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'vision-key',
        model: 'gemini-vision-test',
        timeoutMs: 120_000,
        readinessTimeoutMs: 3_000,
        maxOutputTokens: 8_192,
      },
    );
    assert.throws(
      () =>
        loadConfig({
          VERA_MODEL_PROVIDER: 'ollama',
          VERA_VISION_PROVIDER: 'openai',
        }),
      /OPENAI_API_KEY is required/u,
    );
  });

  void it('supports an independent software-change adapter and Codex override', () => {
    assert.deepEqual(
      loadConfig({
        VERA_CHANGE_ADAPTER: 'deterministic_change',
        CODEX_COMMAND: 'shared-codex',
        CODEX_MODEL: 'shared-model',
        CHANGE_CODEX_COMMAND: 'change-codex',
        CHANGE_CODEX_MODEL: 'change-model',
      }).change,
      {
        adapterId: 'deterministic_change',
        adapters: {
          codexCli: { command: 'change-codex', model: 'change-model' },
        },
      },
    );
  });

  void it('uses an explicit durable root for managed change applications', () => {
    assert.deepEqual(
      loadConfig({ CHANGE_APPLICATION_ROOT: './managed-applications' })
        .application,
      { workspacesRoot: `${process.cwd()}/managed-applications` },
    );
  });

  void it('rejects a non-loopback listener while application authentication is absent', () => {
    assert.throws(() => loadConfig({ HOST: '0.0.0.0' }), /HOST/u);
  });

  void it('requires conversation history limits to preserve whole turns', () => {
    assert.throws(
      () => loadConfig({ CONVERSATION_CONTEXT_MAX_MESSAGES: '3' }),
      /CONVERSATION_CONTEXT_MAX_MESSAGES/u,
    );
  });

  void it('configures a validated owner time zone and independent reminder worker', () => {
    assert.deepEqual(
      loadConfig({
        VERA_OWNER_TIME_ZONE: 'Africa/Johannesburg',
        REMINDER_WORKER_CONCURRENCY: '3',
        REMINDER_POLL_INTERVAL_MS: '100',
        REMINDER_LEASE_MS: '45000',
      }).reminders,
      {
        ownerTimeZone: 'Africa/Johannesburg',
        concurrency: 3,
        pollIntervalMs: 100,
        leaseMs: 45_000,
      },
    );
    assert.throws(
      () => loadConfig({ VERA_OWNER_TIME_ZONE: 'Not/AZone' }),
      /VERA_OWNER_TIME_ZONE/u,
    );
  });

  void it('creates an OpenAI provider configuration only with a key', () => {
    assert.deepEqual(
      loadConfig({
        VERA_MODEL_PROVIDER: 'openai',
        OPENAI_API_KEY: 'openai-test-key',
        OPENAI_MODEL: 'gpt-test',
      }).model,
      {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'openai-test-key',
        model: 'gpt-test',
        timeoutMs: 120_000,
        readinessTimeoutMs: 3_000,
        maxOutputTokens: 8_192,
      },
    );
    assert.throws(
      () => loadConfig({ VERA_MODEL_PROVIDER: 'openai' }),
      /OPENAI_API_KEY is required/u,
    );
    assert.throws(
      () =>
        loadConfig({
          VERA_MODEL_PROVIDER: 'openai',
          OPENAI_API_KEY: 'openai-test-key',
          OPENAI_BASE_URL: 'http://openai.test/v1',
        }),
      /OPENAI_BASE_URL must use HTTPS/u,
    );
  });

  void it('normalizes a Gemini model reference and requires its key', () => {
    assert.deepEqual(
      loadConfig({
        VERA_MODEL_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'gemini-test-key',
        GEMINI_MODEL: 'models/gemini-test',
      }).model,
      {
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-test-key',
        model: 'gemini-test',
        timeoutMs: 120_000,
        readinessTimeoutMs: 3_000,
        maxOutputTokens: 8_192,
      },
    );
    assert.throws(
      () => loadConfig({ VERA_MODEL_PROVIDER: 'gemini' }),
      /GEMINI_API_KEY is required/u,
    );
    assert.throws(
      () =>
        loadConfig({
          VERA_MODEL_PROVIDER: 'gemini',
          GEMINI_API_KEY: 'gemini-test-key',
          GEMINI_BASE_URL: 'https://user:password@gemini.test/v1beta',
        }),
      /must not contain embedded credentials/u,
    );
  });

  void it('configures web research independently from the orchestration model', () => {
    const defaultResearch = loadConfig({
      VERA_RESEARCH_ADAPTER: 'openai_web_search',
      RESEARCH_OPENAI_API_KEY: 'research-test-key',
    }).research;
    assert.equal(defaultResearch.adapterId, 'openai_web_search');
    assert.equal(defaultResearch.openai.model, 'gpt-5.4-mini');

    assert.deepEqual(
      loadConfig({
        VERA_MODEL_PROVIDER: 'ollama',
        VERA_RESEARCH_ADAPTER: 'openai_web_search',
        RESEARCH_OPENAI_API_KEY: 'research-test-key',
        RESEARCH_OPENAI_MODEL: 'gpt-research-test',
        RESEARCH_SEARCH_CONTEXT_SIZE: 'high',
      }).research,
      {
        adapterId: 'openai_web_search',
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'research-test-key',
          model: 'gpt-research-test',
          timeoutMs: 120_000,
          readinessTimeoutMs: 3_000,
          maxOutputTokens: 8_192,
          searchContextSize: 'high',
        },
      },
    );
    assert.throws(
      () =>
        loadConfig({
          VERA_RESEARCH_ADAPTER: 'openai_web_search',
        }),
      /RESEARCH_OPENAI_API_KEY or OPENAI_API_KEY is required/u,
    );
    assert.throws(
      () =>
        loadConfig({
          VERA_RESEARCH_ADAPTER: 'openai_web_search',
          RESEARCH_OPENAI_API_KEY: 'research-test-key',
          RESEARCH_OPENAI_BASE_URL: 'http://openai.test/v1',
        }),
      /OPENAI_BASE_URL must use HTTPS/u,
    );
  });

  void it('configures speech transcription independently from the orchestration model', () => {
    assert.deepEqual(
      loadConfig({
        VERA_MODEL_PROVIDER: 'ollama',
        VERA_TRANSCRIPTION_PROVIDER: 'openai',
        TRANSCRIPTION_OPENAI_API_KEY: 'transcription-key',
        TRANSCRIPTION_OPENAI_MODEL: 'gpt-transcribe-test',
      }).transcription,
      {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'transcription-key',
        model: 'gpt-transcribe-test',
        timeoutMs: 120_000,
        maxAudioBytes: 25_000_000,
      },
    );
    assert.deepEqual(
      loadConfig({
        VERA_TRANSCRIPTION_PROVIDER: 'whisper_cpp',
        WHISPER_CPP_BASE_URL: 'http://localhost:8080/',
        WHISPER_CPP_MODEL: 'large-v3-turbo',
      }).transcription,
      {
        provider: 'whisper_cpp',
        baseUrl: 'http://localhost:8080',
        model: 'large-v3-turbo',
        timeoutMs: 120_000,
        maxAudioBytes: 25_000_000,
      },
    );
    assert.throws(
      () => loadConfig({ VERA_TRANSCRIPTION_PROVIDER: 'openai' }),
      /TRANSCRIPTION_OPENAI_API_KEY or OPENAI_API_KEY is required/u,
    );
    assert.throws(
      () =>
        loadConfig({
          VERA_TRANSCRIPTION_PROVIDER: 'whisper_cpp',
          WHISPER_CPP_BASE_URL: 'http://remote.example:8080',
        }),
      /loopback host/u,
    );
  });

  void it('loads and validates the operator-owned machine catalog from the repository root', () => {
    const machines = loadConfig({
      VERA_MACHINE_CATALOG_FILE: 'config/machines.example.json',
    }).machines;

    assert.ok(machines);
    assert.equal(machines.machines[0]?.id, 'macmini');
    assert.equal(machines.machines[0].services[0]?.id, 'redis');
    assert.throws(
      () =>
        loadConfig({
          VERA_MACHINE_CATALOG_FILE: 'config/does-not-exist.json',
        }),
      /Could not read VERA_MACHINE_CATALOG_FILE/u,
    );
  });

  void it('loads and resolves the operator-owned development-campaign catalog', () => {
    const campaigns = loadConfig({
      VERA_DEVELOPMENT_CAMPAIGN_CATALOG_FILE:
        'config/development-campaigns.example.json',
    }).developmentCampaigns;

    assert.ok(campaigns);
    const policy = campaigns.policies.at(0);
    assert.ok(policy);
    const gate = policy.qualityGates.at(0);
    assert.ok(gate);
    assert.equal(policy.id, 'vera-supervised-autonomy');
    const repositoryRoot = resolve(
      fileURLToPath(new URL('../../../../', import.meta.url)),
    );
    assert.equal(policy.projectRoot, repositoryRoot);
    assert.equal(gate.id, 'install');
    assert.throws(
      () =>
        loadConfig({
          VERA_DEVELOPMENT_CAMPAIGN_CATALOG_FILE:
            'config/development-campaigns-does-not-exist.json',
        }),
      /Could not read VERA_DEVELOPMENT_CAMPAIGN_CATALOG_FILE/u,
    );
  });

  void it('loads the operator-owned bounded-mission catalog', () => {
    const missions = loadConfig({
      VERA_MISSION_CATALOG_FILE: 'config/missions.example.json',
    }).missions;

    assert.ok(missions);
    assert.deepEqual(missions.policies[0], {
      id: 'vera-bounded-mission',
      campaignPolicyId: 'vera-supervised-autonomy',
      limits: { maxCampaigns: 1, maxDurationMinutes: 240 },
    });
    assert.throws(
      () =>
        loadConfig({
          VERA_MISSION_CATALOG_FILE: 'config/missions-does-not-exist.json',
        }),
      /Could not read VERA_MISSION_CATALOG_FILE/u,
    );
  });
});
