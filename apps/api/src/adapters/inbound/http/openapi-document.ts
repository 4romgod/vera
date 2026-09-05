import type { FastifyInstance } from 'fastify';
import type { OpenAPIV3 } from 'openapi-types';

import type { BuildAppOptions } from './build-app.ts';
import { buildApp } from './build-app.ts';
import { registerOpenApi } from './openapi.ts';

const unavailable = () =>
  Promise.reject(new Error('Documentation dependencies cannot be invoked.'));

const documentationDependency = new Proxy<Record<PropertyKey, unknown>>(
  {
    maxAttachmentBytes: 25_000_000,
    maxAudioBytes: 25_000_000,
  },
  {
    get(target, property): unknown {
      if (property in target) return target[property];
      return unavailable;
    },
  },
);

/** Builds the complete route graph without connecting to runtime dependencies. */
export function buildOpenApiApp(): FastifyInstance {
  return buildApp({
    registerOpenApi,
    evaluateModelDecision: unavailable,
    provider: new Proxy<Record<PropertyKey, unknown>>(
      { name: 'documented-provider', model: 'documented-model' },
      {
        get(target, property): unknown {
          if (property in target) return target[property];
          return unavailable;
        },
      },
    ),
    capabilities: documentationDependency,
    machines: documentationDependency,
    projects: documentationDependency,
    conversations: documentationDependency,
    artifacts: documentationDependency,
    personalTasks: documentationDependency,
    reminders: documentationDependency,
    notifications: documentationDependency,
    memories: documentationDependency,
    knowledge: documentationDependency,
    attention: documentationDependency,
    transcriptions: documentationDependency,
    attachments: documentationDependency,
    taskLifecycle: documentationDependency,
    changeApplications: documentationDependency,
    softwareChangePublications: documentationDependency,
    developmentCampaigns: documentationDependency,
    missions: documentationDependency,
    routines: documentationDependency,
    pushNotifications: documentationDependency,
  } as unknown as BuildAppOptions);
}

export async function createOpenApiDocument(): Promise<OpenAPIV3.Document> {
  const app = buildOpenApiApp();
  try {
    await app.ready();
    return app.swagger() as OpenAPIV3.Document;
  } finally {
    await app.close();
  }
}
