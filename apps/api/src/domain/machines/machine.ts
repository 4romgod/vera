import { z } from 'zod';

const IdentifierSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/)
  .max(100);

const SafeArgumentSchema = z
  .string()
  .max(1_000)
  .refine(
    (value) =>
      !value.includes(String.fromCharCode(0)) &&
      !value.includes('\n') &&
      !value.includes('\r'),
    'Command arguments must be single-line values.',
  );

const SafeExecutableSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !value.includes(String.fromCharCode(0)) &&
      !value.includes('\n') &&
      !value.includes('\r'),
    'Executables must be single-line values.',
  );

const SshHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^(?:[a-zA-Z0-9._-]+@)?(?:[a-zA-Z0-9][a-zA-Z0-9._-]*|\[[0-9a-fA-F:]+\])$/,
    'SSH hosts must be a hostname, an address, or user@host without options or whitespace.',
  );

export const MachineCommandSchema = z
  .object({
    executable: SafeExecutableSchema,
    arguments: z.array(SafeArgumentSchema).max(64).default([]),
    timeoutMs: z.number().int().min(250).max(120_000).default(10_000),
  })
  .strict();

export const MachineProbeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('command'),
      command: MachineCommandSchema,
      healthyExitCodes: z
        .array(z.number().int().min(0).max(255))
        .min(1)
        .max(8)
        .default([0]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('http'),
      url: z.url(),
      healthyStatuses: z
        .array(z.number().int().min(100).max(599))
        .min(1)
        .max(16)
        .default([200]),
      timeoutMs: z.number().int().min(250).max(30_000).default(3_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tcp'),
      host: z.string().trim().min(1).max(253),
      port: z.number().int().min(1).max(65_535),
      timeoutMs: z.number().int().min(250).max(30_000).default(3_000),
    })
    .strict(),
]);

const MachineAdapterSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }).strict(),
  z
    .object({
      kind: z.literal('ssh'),
      host: SshHostSchema,
      command: SafeExecutableSchema.default('ssh'),
      arguments: z.array(SafeArgumentSchema).max(32).default([]),
    })
    .strict(),
]);

export const RegisteredMachineSchema = z
  .object({
    id: IdentifierSchema,
    displayName: z.string().trim().min(1).max(200),
    adapter: MachineAdapterSchema,
    diagnostics: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            label: z.string().trim().min(1).max(200),
            command: MachineCommandSchema,
          })
          .strict(),
      )
      .max(20)
      .default([]),
    services: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            displayName: z.string().trim().min(1).max(200),
            probe: MachineProbeSchema,
            actions: z
              .object({
                start: MachineCommandSchema.optional(),
                stop: MachineCommandSchema.optional(),
                restart: MachineCommandSchema.optional(),
              })
              .strict(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .superRefine((machine, context) => {
    for (const collection of [machine.diagnostics, machine.services]) {
      const seen = new Set<string>();
      for (const entry of collection) {
        if (seen.has(entry.id)) {
          context.addIssue({
            code: 'custom',
            message: `Duplicate registered id ${entry.id}.`,
          });
        }
        seen.add(entry.id);
      }
    }
    if (
      machine.adapter.kind === 'ssh' &&
      machine.services.some(({ probe }) => probe.kind !== 'command')
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'SSH machines require command-based service probes executed on the remote host.',
      });
    }
  });

export const MachineCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    machines: z.array(RegisteredMachineSchema).max(50),
  })
  .strict()
  .superRefine((catalog, context) => {
    const seen = new Set<string>();
    for (const machine of catalog.machines) {
      if (seen.has(machine.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate machine id ${machine.id}.`,
        });
      }
      seen.add(machine.id);
    }
  });

export const MachineInspectionArgumentsSchema = z
  .object({
    machineId: IdentifierSchema,
    serviceIds: z.array(IdentifierSchema).max(20).optional(),
  })
  .strict();

export const MachineServiceActionArgumentsSchema = z
  .object({
    machineId: IdentifierSchema,
    serviceId: IdentifierSchema,
    action: z.enum(['start', 'stop', 'restart']),
  })
  .strict();

const ProbeObservationSchema = z
  .object({
    status: z.enum(['healthy', 'unhealthy', 'unknown']),
    checkedAt: z.iso.datetime(),
    durationMs: z.number().int().nonnegative(),
    summary: z.string().max(4_000),
    exitCode: z.number().int().nullable().optional(),
  })
  .strict();

export const MachineDiagnosticSchema = z
  .object({
    schemaVersion: z.literal(1),
    machine: z
      .object({ id: IdentifierSchema, displayName: z.string().min(1) })
      .strict(),
    adapter: z.enum(['local', 'ssh']),
    inspectedAt: z.iso.datetime(),
    system: z
      .object({
        hostname: z.string().min(1),
        platform: z.string().min(1),
        architecture: z.string().min(1),
        uptimeSeconds: z.number().nonnegative().optional(),
        freeMemoryBytes: z.number().int().nonnegative().optional(),
        totalMemoryBytes: z.number().int().nonnegative().optional(),
      })
      .strict(),
    diagnostics: z.array(
      z
        .object({
          id: IdentifierSchema,
          label: z.string().min(1),
          observation: ProbeObservationSchema,
        })
        .strict(),
    ),
    services: z.array(
      z
        .object({
          id: IdentifierSchema,
          displayName: z.string().min(1),
          observation: ProbeObservationSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const MachineServiceActionResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    machine: z
      .object({ id: IdentifierSchema, displayName: z.string().min(1) })
      .strict(),
    service: z
      .object({ id: IdentifierSchema, displayName: z.string().min(1) })
      .strict(),
    action: z.enum(['start', 'stop', 'restart']),
    before: ProbeObservationSchema,
    execution: z
      .object({
        exitCode: z.number().int().nullable(),
        summary: z.string().max(4_000),
      })
      .strict(),
    after: ProbeObservationSchema,
    verified: z.boolean(),
    completedAt: z.iso.datetime(),
  })
  .strict();

export const PublicMachineCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    machines: z.array(
      z
        .object({
          id: IdentifierSchema,
          displayName: z.string().min(1),
          adapter: z.enum(['local', 'ssh']),
          diagnostics: z.array(
            z
              .object({ id: IdentifierSchema, label: z.string().min(1) })
              .strict(),
          ),
          services: z.array(
            z
              .object({
                id: IdentifierSchema,
                displayName: z.string().min(1),
                actions: z.array(z.enum(['start', 'stop', 'restart'])),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export type MachineCatalog = z.infer<typeof MachineCatalogSchema>;
export type MachineCommand = z.infer<typeof MachineCommandSchema>;
export type RegisteredMachine = z.infer<typeof RegisteredMachineSchema>;
export type MachineInspectionArguments = z.infer<
  typeof MachineInspectionArgumentsSchema
>;
export type MachineServiceActionArguments = z.infer<
  typeof MachineServiceActionArgumentsSchema
>;
export type MachineDiagnostic = z.infer<typeof MachineDiagnosticSchema>;
export type MachineServiceActionResult = z.infer<
  typeof MachineServiceActionResultSchema
>;

export function publicMachineCatalog(catalog: MachineCatalog) {
  return PublicMachineCatalogSchema.parse({
    schemaVersion: 1 as const,
    machines: catalog.machines.map((machine) => ({
      id: machine.id,
      displayName: machine.displayName,
      adapter: machine.adapter.kind,
      diagnostics: machine.diagnostics.map(({ id, label }) => ({ id, label })),
      services: machine.services.map((service) => ({
        id: service.id,
        displayName: service.displayName,
        actions: (['start', 'stop', 'restart'] as const).filter(
          (action) => service.actions[action] !== undefined,
        ),
      })),
    })),
  });
}
