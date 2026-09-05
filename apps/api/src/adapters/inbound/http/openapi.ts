import swagger from '@fastify/swagger';
import type { FastifyInstance } from 'fastify';
import type { OpenAPIV3 } from 'openapi-types';

import {
  DocumentAttachmentMediaTypeSchema,
  ImageAttachmentMediaTypeSchema,
} from '../../../domain/attachments/attachment.ts';
import { ErrorResponseJsonSchema } from './schemas.ts';

const tags: OpenAPIV3.TagObject[] = [
  { name: 'operations', description: 'Service health and readiness.' },
  { name: 'model', description: 'Model decision evaluation.' },
  { name: 'capabilities', description: 'Available Vera capabilities.' },
  {
    name: 'integrations',
    description: 'Curated external services and owner connection state.',
  },
  { name: 'machines', description: 'Owner-machine discovery.' },
  { name: 'projects', description: 'Registered project resources.' },
  {
    name: 'conversations',
    description: 'Conversation resources and messages.',
  },
  { name: 'tasks', description: 'Tasks, runs, approvals, and run events.' },
  { name: 'artifacts', description: 'Immutable task artifacts.' },
  { name: 'personal-tasks', description: 'Owner personal-task projections.' },
  { name: 'reminders', description: 'Owner reminder projections.' },
  { name: 'notifications', description: 'Durable and push notifications.' },
  { name: 'memories', description: 'Governed long-term memories.' },
  { name: 'knowledge', description: 'Grounded personal knowledge.' },
  { name: 'attention', description: 'Owner attention briefing and decisions.' },
  { name: 'attachments', description: 'Attachment upload and retrieval.' },
  { name: 'transcription', description: 'Speech-to-text transcription.' },
  { name: 'software-delivery', description: 'Governed software delivery.' },
  { name: 'campaigns', description: 'Long-running development campaigns.' },
  { name: 'missions', description: 'Autonomous missions.' },
  { name: 'routines', description: 'Scheduled and on-demand routines.' },
  {
    name: 'external-awareness',
    description:
      'Read-only signals observed through approved standing routines.',
  },
];

const errorDescriptions: Readonly<Record<number, string>> = {
  400: 'The request did not satisfy the declared path, query, header, or body schema.',
  404: 'The requested resource does not exist for the current owner.',
  409: 'The request conflicts with the current resource state or reuses an idempotency key.',
  413: 'The uploaded payload exceeds the configured size limit.',
  415: 'The request media type is not supported.',
  422: 'The request is well-formed but cannot be applied to the referenced resources.',
  500: 'An unexpected error occurred or an operation failed internally.',
  502: 'An upstream model or transcription provider returned an invalid response.',
  503: 'A required provider, capability, or notification service is unavailable.',
  504: 'An upstream model or transcription provider timed out.',
};

const conflictOperations = new Set([
  'post /v1/integration-connections',
  'post /v1/integration-connections/{id}/verification',
  'post /v1/integration-connections/{id}/revocation',
  'post /v1/projects',
  'post /v1/conversations',
  'post /v1/conversations/{id}/messages',
  'post /v1/tasks',
  'post /v1/approvals/{id}/decision',
  'post /v1/runs/{id}/cancellation',
  'post /v1/knowledge-sources',
  'delete /v1/knowledge-sources/{id}',
  'post /v1/attention-items/{id}/decision',
  'post /v1/artifacts/{id}/applications',
  'post /v1/change-applications/{id}/decision',
  'post /v1/change-applications/{id}/cancellation',
  'post /v1/change-applications/{id}/publications',
  'post /v1/software-change-publications/{id}/decision',
  'post /v1/software-change-publications/{id}/cancellation',
  'post /v1/development-campaigns',
  'post /v1/development-campaigns/{id}/decision',
  'post /v1/development-campaigns/{id}/repairs',
  'post /v1/development-campaigns/{id}/repairs/{repairId}/decision',
  'post /v1/development-campaigns/{id}/cancellation',
  'post /v1/missions',
  'post /v1/missions/{id}/decision',
  'post /v1/missions/{id}/cancellation',
  'post /v1/routines',
  'post /v1/routines/{id}/decision',
  'post /v1/routines/{id}/pause',
  'post /v1/routines/{id}/resume',
  'post /v1/routines/{id}/runs',
  'put /v1/notification-devices/{id}/preferences',
  'post /v1/notification-devices/{id}/revoke',
  'post /v1/notification-devices/{id}/test',
]);

const unprocessableOperations = new Set([
  'post /v1/projects',
  'post /v1/knowledge-sources',
  'post /v1/knowledge-search',
  'post /v1/attention-items/{id}/decision',
  'post /v1/attachments',
  'post /v1/audio/transcriptions',
  'post /v1/artifacts/{id}/applications',
  'post /v1/change-applications/{id}/publications',
  'post /v1/development-campaigns/{id}/repairs',
  'post /v1/development-campaigns',
  'post /v1/missions',
  'post /v1/notification-devices',
  'put /v1/notification-devices/{id}/preferences',
]);

const unavailableOperations = new Set([
  'post /v1/integration-connections',
  'post /v1/integration-connections/{id}/verification',
  'post /v1/model-decisions',
  'post /v1/audio/transcriptions',
  'post /v1/development-campaigns',
  'post /v1/development-campaigns/{id}/repairs',
  'post /v1/missions',
  'post /v1/notification-devices',
]);

const upstreamOperations = new Set([
  'post /v1/model-decisions',
  'post /v1/audio/transcriptions',
]);

const notFoundOperations = new Set([
  'post /v1/integration-connections',
  'post /v1/tasks',
  'post /v1/knowledge-sources',
  'post /v1/knowledge-search',
  'post /v1/development-campaigns',
  'post /v1/missions',
  'post /v1/routines',
]);

const locationResponseStatuses: Readonly<Record<string, readonly string[]>> = {
  'post /v1/integration-connections': ['201'],
  'post /v1/projects': ['201'],
  'post /v1/conversations': ['201'],
  'post /v1/conversations/{id}/messages': ['202'],
  'post /v1/tasks': ['202'],
  'post /v1/knowledge-sources': ['200', '201'],
  'post /v1/attachments': ['200', '201'],
  'post /v1/artifacts/{id}/applications': ['202'],
  'post /v1/change-applications/{id}/publications': ['202'],
  'post /v1/development-campaigns': ['202'],
  'post /v1/missions': ['202'],
  'post /v1/routines': ['202'],
  'post /v1/routines/{id}/runs': ['202'],
};

function operationKey(method: string, path: string): string {
  return `${method.toLowerCase()} ${path}`;
}

function operationId(method: string, path: string): string {
  return [method.toLowerCase(), ...path.split('/').filter(Boolean)]
    .map((part) => part.replace(/[{}]/gu, ''))
    .map((part, index) =>
      index === 0
        ? part
        : part
            .split(/[-_]/u)
            .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
            .join(''),
    )
    .join('');
}

function tagFor(path: string): string {
  if (path === '/health' || path === '/ready') return 'operations';
  if (path.startsWith('/v1/model-decisions')) return 'model';
  if (path.startsWith('/v1/capabilities')) return 'capabilities';
  if (
    path.startsWith('/v1/integrations') ||
    path.startsWith('/v1/integration-connections')
  )
    return 'integrations';
  if (path.startsWith('/v1/machines')) return 'machines';
  if (path.startsWith('/v1/projects')) return 'projects';
  if (path.startsWith('/v1/conversations')) return 'conversations';
  if (
    path.startsWith('/v1/tasks') ||
    path.startsWith('/v1/runs') ||
    path.startsWith('/v1/approvals')
  )
    return 'tasks';
  if (path === '/v1/artifacts/{id}') return 'artifacts';
  if (path.startsWith('/v1/personal-tasks')) return 'personal-tasks';
  if (path.startsWith('/v1/reminders')) return 'reminders';
  if (
    path.startsWith('/v1/notifications') ||
    path.startsWith('/v1/notification-devices') ||
    path.startsWith('/v1/push-')
  )
    return 'notifications';
  if (path.startsWith('/v1/memories')) return 'memories';
  if (path.startsWith('/v1/knowledge-')) return 'knowledge';
  if (path.startsWith('/v1/attention')) return 'attention';
  if (path.startsWith('/v1/attachments')) return 'attachments';
  if (path.startsWith('/v1/audio/transcriptions')) return 'transcription';
  if (path.startsWith('/v1/development-campaign')) return 'campaigns';
  if (path.startsWith('/v1/missions') || path.startsWith('/v1/mission-'))
    return 'missions';
  if (path.startsWith('/v1/routines') || path.startsWith('/v1/routine-'))
    return 'routines';
  if (path.startsWith('/v1/external-signals')) return 'external-awareness';
  return 'software-delivery';
}

function errorStatuses(
  method: string,
  path: string,
  operation: OpenAPIV3.OperationObject,
): number[] {
  const key = operationKey(method, path);
  const statuses = new Set<number>([500]);
  if (operation.parameters !== undefined || operation.requestBody !== undefined)
    statuses.add(400);
  if (path.includes('{') || notFoundOperations.has(key)) statuses.add(404);
  if (conflictOperations.has(key)) statuses.add(409);
  if (unprocessableOperations.has(key)) statuses.add(422);
  if (unavailableOperations.has(key)) statuses.add(503);
  if (upstreamOperations.has(key)) {
    statuses.add(502);
    statuses.add(504);
  }
  if (
    key === 'post /v1/attachments' ||
    key === 'post /v1/audio/transcriptions'
  ) {
    statuses.add(413);
    statuses.add(415);
  }
  return [...statuses].sort((left, right) => left - right);
}

function errorResponse(status: number): OpenAPIV3.ResponseObject {
  return {
    description: errorDescriptions[status] ?? 'The request failed.',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
      },
    },
  };
}

function addLocationHeader(
  operation: OpenAPIV3.OperationObject,
  key: string,
): void {
  for (const status of locationResponseStatuses[key] ?? []) {
    const response = operation.responses[status];
    if (response === undefined || '$ref' in response) continue;
    response.headers = {
      ...response.headers,
      Location: {
        description: 'Canonical URL of the created resource.',
        schema: { type: 'string' },
      },
    };
  }
}

function documentBinaryAndStreamingOperations(
  document: OpenAPIV3.Document,
): void {
  const attachmentUpload = document.paths['/v1/attachments']?.post;
  if (attachmentUpload !== undefined) {
    if (attachmentUpload.parameters !== undefined)
      attachmentUpload.parameters = attachmentUpload.parameters.filter(
        (parameter) =>
          '$ref' in parameter ||
          parameter.name.toLowerCase() !== 'content-type',
      );
    const mediaTypeParameter = attachmentUpload.parameters?.find(
      (parameter) =>
        !('$ref' in parameter) && parameter.name === 'x-vera-media-type',
    );
    if (mediaTypeParameter !== undefined && !('$ref' in mediaTypeParameter)) {
      mediaTypeParameter.description =
        'The declared media type of the original attachment bytes.';
      mediaTypeParameter.schema = {
        type: 'string',
        enum: [
          ...DocumentAttachmentMediaTypeSchema.options,
          ...ImageAttachmentMediaTypeSchema.options,
        ],
      };
    }
    const filenameParameter = attachmentUpload.parameters?.find(
      (parameter) =>
        !('$ref' in parameter) && parameter.name === 'x-vera-filename',
    );
    if (filenameParameter !== undefined && !('$ref' in filenameParameter))
      filenameParameter.description =
        'The percent-encoded original filename supplied by the owner.';
    attachmentUpload.requestBody = {
      required: true,
      content: {
        'application/octet-stream': {
          schema: { type: 'string', format: 'binary' },
        },
      },
    };
  }

  const transcription = document.paths['/v1/audio/transcriptions']?.post;
  if (transcription !== undefined) {
    transcription.requestBody = {
      required: true,
      content: Object.fromEntries(
        [
          'audio/webm',
          'audio/mp4',
          'audio/mpeg',
          'audio/wav',
          'audio/x-wav',
        ].map((contentType) => [
          contentType,
          { schema: { type: 'string', format: 'binary' } },
        ]),
      ),
    };
  }

  const preview = document.paths['/v1/attachments/{id}/preview']?.get;
  if (preview !== undefined) {
    preview.responses['200'] = {
      description: 'A normalized attachment preview.',
      headers: {
        'Cache-Control': {
          description:
            'Private immutable cache policy for content-addressed previews.',
          schema: { type: 'string' },
        },
      },
      content: Object.fromEntries(
        ['image/jpeg', 'image/png'].map((contentType) => [
          contentType,
          { schema: { type: 'string', format: 'binary' } },
        ]),
      ),
    };
  }

  const stream = document.paths['/v1/notifications/stream']?.get;
  if (stream !== undefined) {
    stream.parameters = [
      ...(stream.parameters ?? []),
      {
        name: 'Last-Event-ID',
        in: 'header',
        required: false,
        description:
          'Resume cursor used when the after query parameter is absent.',
        schema: { type: 'string' },
      },
    ];
    stream.responses['200'] = {
      description:
        'A server-sent event stream. Notification events carry an id cursor and a JSON NotificationResource in their data field.',
      headers: {
        'Cache-Control': {
          description: 'Disables intermediary buffering and caching.',
          schema: { type: 'string' },
        },
      },
      content: {
        'text/event-stream': {
          schema: { type: 'string' },
          example:
            'event: notification\nid: 2026-09-05T10:00:00.000Z_notification_123\ndata: {"schemaVersion":1,"id":"notification_123"}\n\n',
        },
      },
    };
  }
}

function componentName(value: string): string {
  const normalized = value
    .split(/[^a-zA-Z0-9]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('');
  return normalized.length === 0 ? 'AnonymousSchema' : normalized;
}

function contentTypeSuffix(contentType: string): string {
  return contentType === 'application/json' ? '' : ` ${contentType}`;
}

const publicSchemaNames: Readonly<Record<string, string>> = {
  'getV1Capabilities response 200': 'CapabilityCatalogResource',
  'getV1Integrations response 200': 'IntegrationCatalogResource',
  'getV1IntegrationConnections response 200':
    'IntegrationConnectionListResource',
  'postV1IntegrationConnections response 201': 'IntegrationConnectionResource',
  'getV1Machines response 200': 'MachineCatalogResource',
  'getV1Projects response 200': 'ProjectListResource',
  'postV1Projects response 201': 'ProjectResource',
  'getV1Conversations response 200': 'ConversationListResource',
  'postV1Conversations response 201': 'ConversationResource',
  'postV1ConversationsIdMessages response 202': 'TaskResource',
  'getV1ArtifactsId response 200': 'ArtifactResource',
  'getV1PersonalTasks response 200': 'PersonalTaskListResource',
  'getV1PersonalTasksId response 200': 'PersonalTaskResource',
  'getV1Reminders response 200': 'ReminderListResource',
  'getV1RemindersId response 200': 'ReminderResource',
  'getV1Notifications response 200': 'NotificationPage',
  'getV1Memories response 200': 'MemoryListResource',
  'getV1MemoriesId response 200': 'MemoryResource',
  'getV1KnowledgeSources response 200': 'KnowledgeSourceListResource',
  'postV1KnowledgeSources response 200': 'KnowledgeSourceResource',
  'postV1KnowledgeSearch response 200': 'KnowledgeSearchResponse',
  'getV1Attention response 200': 'AttentionBriefing',
  'postV1AudioTranscriptions response 200': 'SpeechTranscriptionResource',
  'postV1Attachments response 200': 'AttachmentResource',
  'getV1RunsIdEvents response 200': 'RunEventsResource',
  'getV1ArtifactsIdApplications response 200': 'ChangeApplicationListResource',
  'postV1ArtifactsIdApplications response 202': 'ChangeApplicationResource',
  'getV1ChangeApplicationsIdEvents response 200':
    'ChangeApplicationEventsResource',
  'getV1ChangeApplicationsIdPublications response 200':
    'SoftwareChangePublicationListResource',
  'postV1ChangeApplicationsIdPublications response 202':
    'SoftwareChangePublicationResource',
  'getV1SoftwareChangePublicationsIdEvents response 200':
    'SoftwareChangePublicationEventsResource',
  'getV1DevelopmentCampaignPolicies response 200':
    'DevelopmentCampaignPolicyListResource',
  'getV1DevelopmentCampaigns response 200': 'DevelopmentCampaignListResource',
  'postV1DevelopmentCampaigns response 202': 'DevelopmentCampaignResource',
  'getV1MissionPolicies response 200': 'MissionPolicyListResource',
  'getV1Missions response 200': 'MissionListResource',
  'postV1Missions response 202': 'MissionResource',
  'getV1Routines response 200': 'RoutineListResource',
  'postV1Routines response 202': 'RoutineResource',
  'getV1RoutinesIdRuns response 200': 'RoutineRunListResource',
  'postV1RoutinesIdRuns response 202': 'RoutineRunResource',
  'getV1ExternalSignals response 200': 'ExternalSignalListResource',
  'getV1ExternalSignalsIdResolution response 200':
    'ExternalSignalResolutionResource',
  'getV1RoutinesIdExternalSignals response 200': 'ExternalSignalListResource',
  'getV1PushNotificationsStatus response 200': 'PushNotificationStatus',
  'getV1NotificationDevices response 200': 'NotificationDeviceListResource',
  'postV1NotificationDevices response 200': 'NotificationDeviceResource',
  'postV1NotificationDevicesIdTest response 200': 'PushDeliveryResource',
  'getV1PushDeliveries response 200': 'PushDeliveryListResource',
};

function publicSchemaName(fallback: string): string {
  return publicSchemaNames[fallback] ?? fallback;
}

function componentizeOperationSchemas(document: OpenAPIV3.Document): void {
  document.components ??= {};
  document.components.schemas ??= {};
  const schemas = document.components.schemas;
  const componentBySchema = new Map<string, string>();

  for (const [name, schema] of Object.entries(schemas))
    componentBySchema.set(JSON.stringify(schema), name);

  const extract = (
    schema: OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject,
    preferredName: string,
  ): OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject => {
    if ('$ref' in schema) return schema;
    const serialized = JSON.stringify(schema);
    if (serialized.length < 160) return schema;
    const existing = componentBySchema.get(serialized);
    if (existing !== undefined)
      return { $ref: `#/components/schemas/${existing}` };

    let name = componentName(preferredName);
    let suffix = 2;
    while (schemas[name] !== undefined) {
      name = `${componentName(preferredName)}${String(suffix)}`;
      suffix += 1;
    }
    schemas[name] = schema;
    componentBySchema.set(serialized, name);
    return { $ref: `#/components/schemas/${name}` };
  };

  for (const pathItem of Object.values(document.paths)) {
    if (pathItem === undefined) continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (operation?.operationId === undefined) continue;
      const requestBody = operation.requestBody;
      if (requestBody !== undefined && !('$ref' in requestBody)) {
        for (const [contentType, media] of Object.entries(
          requestBody.content,
        )) {
          if (media.schema !== undefined)
            media.schema = extract(
              media.schema,
              publicSchemaName(
                `${operation.operationId} request${contentTypeSuffix(contentType)}`,
              ),
            );
        }
      }
      for (const [status, response] of Object.entries(operation.responses)) {
        if ('$ref' in response) continue;
        for (const [contentType, media] of Object.entries(
          response.content ?? {},
        )) {
          if (media.schema !== undefined)
            media.schema = extract(
              media.schema,
              publicSchemaName(
                `${operation.operationId} response ${status}${contentTypeSuffix(contentType)}`,
              ),
            );
        }
      }
    }
  }
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const singularSchemaKeys = [
  'not',
  'items',
  'contains',
  'propertyNames',
  'if',
  'then',
  'else',
  'additionalProperties',
] as const;
const arraySchemaKeys = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;
const mapSchemaKeys = [
  'properties',
  'patternProperties',
  'dependentSchemas',
] as const;

type NestedSchema = { schema: JsonObject; segment: string };

function literalProperty(
  schema: JsonObject,
  property: string,
): string | undefined {
  const properties = schema.properties;
  if (!isJsonObject(properties)) return undefined;
  const propertySchema = properties[property];
  if (!isJsonObject(propertySchema)) return undefined;
  const values = propertySchema.enum;
  return Array.isArray(values) &&
    values.length === 1 &&
    typeof values[0] === 'string'
    ? values[0]
    : undefined;
}

function nestedVariantSegment(schema: JsonObject, index: number): string {
  for (const discriminator of [
    'kind',
    'action',
    'capability',
    'type',
    'status',
    'reason',
  ]) {
    const value = literalProperty(schema, discriminator);
    if (value !== undefined) return componentName(value);
  }
  const properties = schema.properties;
  if (isJsonObject(properties)) {
    const capability = properties.capability;
    if (isJsonObject(capability)) {
      const capabilityName = literalProperty(capability, 'name');
      if (capabilityName !== undefined) return componentName(capabilityName);
    }
  }
  return `Variant${String(index + 1)}`;
}

function nestedSchemas(schema: JsonObject): NestedSchema[] {
  if ('$ref' in schema) return [];
  const nested: NestedSchema[] = [];
  for (const key of singularSchemaKeys) {
    const value = schema[key];
    if (isJsonObject(value))
      nested.push({ schema: value, segment: componentName(key) });
  }
  for (const key of arraySchemaKeys) {
    const value = schema[key];
    if (!Array.isArray(value)) continue;
    for (const [index, member] of value.entries())
      if (isJsonObject(member))
        nested.push({
          schema: member,
          segment: `${componentName(key)}${nestedVariantSegment(member, index)}`,
        });
  }
  for (const key of mapSchemaKeys) {
    const value = schema[key];
    if (!isJsonObject(value)) continue;
    for (const [name, member] of Object.entries(value))
      if (isJsonObject(member))
        nested.push({
          schema: member,
          segment:
            key === 'properties'
              ? componentName(name)
              : `${componentName(key)}${componentName(name)}`,
        });
  }
  return nested;
}

function intrinsicComponentName(schema: JsonObject): string | undefined {
  if (schema.type === 'string' && schema.format === 'date-time')
    return 'DateTime';
  if (schema.type === 'string' && typeof schema.pattern === 'string') {
    const idPrefix = /^\^([a-z][a-z0-9]*)_\.\*\$?$/u.exec(schema.pattern)?.[1];
    if (idPrefix !== undefined) return `${componentName(idPrefix)}Id`;
  }
  const kind = literalProperty(schema, 'kind');
  const properties = schema.properties;
  if (kind !== undefined && isJsonObject(properties)) {
    const capability = properties.capability;
    if (isJsonObject(capability)) {
      const capabilityName = literalProperty(capability, 'name');
      if (capabilityName !== undefined) {
        const suffix =
          kind === 'invoke_capability'
            ? 'InvocationDecision'
            : kind === 'approval_required'
              ? 'ApprovalRequiredDecision'
              : componentName(kind);
        return `${componentName(capabilityName)}${suffix}`;
      }
    }
  }
  if (
    kind !== undefined &&
    isJsonObject(properties) &&
    'decisionSummary' in properties
  )
    return `${componentName(kind)}Decision`;
  if (isJsonObject(properties)) {
    const capabilityName = literalProperty(schema, 'capability');
    if (
      capabilityName !== undefined &&
      'purpose' in properties &&
      'inputStepIds' in properties
    )
      return `${componentName(capabilityName)}GoalStep`;
  }
  const name = literalProperty(schema, 'name');
  if (name !== undefined && isJsonObject(properties) && 'version' in properties)
    return `${componentName(name)}Capability`;
  return undefined;
}

function contextualComponentName(
  root: string,
  path: readonly string[],
): string {
  const conciseRoot = root.replace(/ApplicationJson$/u, '');
  return componentName([conciseRoot, ...path.slice(-5)].join(' '));
}

function compactComponentSchemas(document: OpenAPIV3.Document): void {
  const schemas = document.components?.schemas;
  if (schemas === undefined) return;
  const countBySchema = new Map<string, number>();
  const valueBySchema = new Map<string, JsonObject>();
  const candidatesBySchema = new Map<string, Set<string>>();

  const count = (
    schema: JsonObject,
    root: string,
    path: readonly string[],
  ): void => {
    for (const nested of nestedSchemas(schema))
      count(nested.schema, root, [...path, nested.segment]);
    const serialized = JSON.stringify(schema);
    countBySchema.set(serialized, (countBySchema.get(serialized) ?? 0) + 1);
    valueBySchema.set(serialized, schema);
    const candidates = candidatesBySchema.get(serialized) ?? new Set<string>();
    candidates.add(contextualComponentName(root, path));
    candidatesBySchema.set(serialized, candidates);
  };
  for (const [root, schema] of Object.entries(schemas))
    if (isJsonObject(schema)) count(schema, root, []);

  const sharedNameBySchema = new Map<string, string>();
  const usedNames = new Set(Object.keys(schemas));
  const sharedSchemas = [...countBySchema]
    .filter(
      ([serialized, occurrences]) =>
        occurrences >= 2 && serialized.length >= 240,
    )
    .map(([serialized]) => {
      const schema = valueBySchema.get(serialized);
      if (schema === undefined)
        throw new Error('A counted OpenAPI schema is missing its value.');
      const contextualNames = [
        ...(candidatesBySchema.get(serialized) ?? []),
      ].sort(
        (left, right) =>
          left.length - right.length || left.localeCompare(right),
      );
      return {
        serialized,
        contextualNames,
        preferredName:
          intrinsicComponentName(schema) ??
          contextualNames[0] ??
          'AnonymousSchema',
      };
    })
    .sort(
      (left, right) =>
        left.preferredName.localeCompare(right.preferredName) ||
        left.serialized.localeCompare(right.serialized),
    );
  for (const { serialized, contextualNames, preferredName } of sharedSchemas) {
    let name = [preferredName, ...contextualNames].find(
      (candidate) => !usedNames.has(candidate),
    );
    name ??= preferredName;
    let variant = 2;
    while (usedNames.has(name)) {
      name = `${preferredName}Variant${String(variant)}`;
      variant += 1;
    }
    usedNames.add(name);
    sharedNameBySchema.set(serialized, name);
  }

  const rewrite = (schema: JsonObject, root = false): JsonObject => {
    if ('$ref' in schema) return schema;
    const serialized = JSON.stringify(schema);
    const sharedName = sharedNameBySchema.get(serialized);
    if (!root && sharedName !== undefined)
      return { $ref: `#/components/schemas/${sharedName}` };

    const rewritten: JsonObject = { ...schema };
    for (const key of singularSchemaKeys) {
      const value = schema[key];
      if (isJsonObject(value)) rewritten[key] = rewrite(value);
    }
    for (const key of arraySchemaKeys) {
      const value = schema[key];
      if (Array.isArray(value)) {
        const members: unknown[] = value;
        rewritten[key] = members.map((member) =>
          isJsonObject(member) ? rewrite(member) : member,
        );
      }
    }
    for (const key of mapSchemaKeys) {
      const value = schema[key];
      if (!isJsonObject(value)) continue;
      rewritten[key] = Object.fromEntries(
        Object.entries(value).map(([name, member]) => [
          name,
          isJsonObject(member) ? rewrite(member) : member,
        ]),
      );
    }
    return rewritten;
  };

  for (const [name, schema] of Object.entries(schemas))
    if (isJsonObject(schema)) schemas[name] = rewrite(schema, true);
  for (const [serialized, name] of sharedNameBySchema) {
    const schema = valueBySchema.get(serialized);
    if (schema !== undefined) schemas[name] = rewrite(schema, true);
  }
}

function completeDocument(document: OpenAPIV3.Document): OpenAPIV3.Document {
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (pathItem === undefined) continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (operation === undefined) continue;
      operation.operationId = operationId(method, path);
      operation.tags = [tagFor(path)];
      operation.summary ??= `${method.toUpperCase()} ${path}`;
      delete operation.responses.default;
      for (const status of errorStatuses(method, path, operation)) {
        if (operation.responses[String(status)] === undefined)
          operation.responses[String(status)] = errorResponse(status);
      }
      addLocationHeader(operation, operationKey(method, path));
    }
  }
  documentBinaryAndStreamingOperations(document);
  componentizeOperationSchemas(document);
  compactComponentSchemas(document);
  return document;
}

/** Registers OpenAPI discovery before routes on documentation-enabled apps. */
export function registerOpenApi(app: FastifyInstance): void {
  // buildApp is intentionally synchronous. Invoke the callback plugin directly
  // so its onRoute hook exists before the synchronous production route graph.
  swagger(
    app,
    {
      mode: 'dynamic',
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Vera API',
          version: '0.1.0',
          description:
            'The versioned owner-facing HTTP API for Vera. All JSON request and response schemas are generated from the same Zod contracts used by the running server.',
        },
        servers: [
          {
            url: 'http://127.0.0.1:4310',
            description: 'Default loopback server',
          },
        ],
        tags,
        security: [],
        components: {
          schemas: {
            ErrorResponse: ErrorResponseJsonSchema as OpenAPIV3.SchemaObject,
          },
        },
      },
      exposeHeadRoutes: false,
      transformObject(documentObject) {
        if (!('openapiObject' in documentObject))
          throw new Error('Vera OpenAPI generation requires OpenAPI mode.');
        return completeDocument(
          documentObject.openapiObject as OpenAPIV3.Document,
        );
      },
    },
    (error) => {
      if (error !== undefined) throw error;
    },
  );
}
