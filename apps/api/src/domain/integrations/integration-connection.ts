import { z } from 'zod';

const IdentifierSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/u)
  .max(100);

export const IntegrationDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: IdentifierSchema,
    provider: IdentifierSchema,
    displayName: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(500),
    credentialManagement: z.literal('host_session'),
    capabilities: z.array(IdentifierSchema).min(1).max(20),
    operations: z.array(IdentifierSchema).min(1).max(20),
  })
  .strict();

export const IntegrationAccountSchema = z
  .object({
    providerAccountId: z.string().trim().min(1).max(200),
    login: z.string().trim().min(1).max(200),
    displayName: z.string().trim().min(1).max(200).optional(),
    profileUrl: z.url().optional(),
  })
  .strict();

export const IntegrationConnectionEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('event_'),
    sequence: z.number().int().positive(),
    type: z.enum([
      'connection_enabled',
      'connection_verified',
      'connection_revoked',
    ]),
    occurredAt: z.iso.datetime(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

const IntegrationConnectionFieldsSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    id: z.string().startsWith('connection_'),
    requestKey: z.string().min(1).max(200),
    principalId: z.string().min(1),
    integrationId: IdentifierSchema,
    adapterId: IdentifierSchema,
    status: z.enum(['active', 'revoked']),
    credentialBinding: z
      .object({
        kind: z.literal('host_session'),
        host: z.string().min(1).max(253),
      })
      .strict(),
    account: IntegrationAccountSchema,
    operations: z.array(IdentifierSchema).min(1).max(20),
    lastVerifiedAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().optional(),
    events: z.array(IntegrationConnectionEventSchema).min(1).max(10_000),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const IntegrationConnectionSchema =
  IntegrationConnectionFieldsSchema.superRefine((connection, context) => {
    if (
      (connection.status === 'revoked') !==
      (connection.revokedAt !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['revokedAt'],
        message: 'Only revoked connections require a revocation time.',
      });
    }
  });

export const PublicIntegrationConnectionSchema =
  IntegrationConnectionFieldsSchema.omit({
    principalId: true,
    requestKey: true,
    events: true,
  });

export const IntegrationCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    integrations: z.array(IntegrationDefinitionSchema),
  })
  .strict();

export const IntegrationConnectionListSchema = z
  .object({
    schemaVersion: z.literal(1),
    connections: z.array(PublicIntegrationConnectionSchema),
  })
  .strict();

export type IntegrationDefinition = z.infer<typeof IntegrationDefinitionSchema>;
export type IntegrationAccount = z.infer<typeof IntegrationAccountSchema>;
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;
export type PublicIntegrationConnection = z.infer<
  typeof PublicIntegrationConnectionSchema
>;

export const IntegrationConnectionJsonSchema = z.toJSONSchema(
  IntegrationConnectionSchema,
  { target: 'draft-7', unrepresentable: 'throw' },
);

export const GitHubReadOnlyIntegrationDefinition: IntegrationDefinition = {
  schemaVersion: 1,
  id: 'github',
  provider: 'github',
  displayName: 'GitHub',
  description:
    'Let Vera watch registered GitHub projects through approved standing routines.',
  credentialManagement: 'host_session',
  capabilities: ['external_awareness'],
  operations: ['notifications_read', 'pull_request_checks_read'],
};

export const GitHubIntegrationDefinition: IntegrationDefinition = {
  ...GitHubReadOnlyIntegrationDefinition,
  description:
    'Let Vera watch registered GitHub projects and manage their issues through separately governed capabilities.',
  capabilities: ['external_awareness', 'work_item_management'],
  operations: [
    'issues_read',
    'issues_create',
    'issues_comment',
    'issues_close',
    'issues_reopen',
    'notifications_read',
    'pull_request_checks_read',
  ],
};

export const IntegrationDefinitions = [GitHubIntegrationDefinition];
