import { z } from 'zod';

const IdentifierSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/)
  .max(100);

export const CapabilityDestinationSchema = z
  .object({
    schemaVersion: z.literal(1),
    adapterId: IdentifierSchema,
    provider: IdentifierSchema,
    transport: IdentifierSchema,
    dataBoundary: z.enum(['owner_controlled', 'third_party']),
  })
  .strict();

export type CapabilityDestination = z.infer<typeof CapabilityDestinationSchema>;

export function sameCapabilityDestination(
  left: CapabilityDestination,
  right: CapabilityDestination,
): boolean {
  return (
    left.adapterId === right.adapterId &&
    left.provider === right.provider &&
    left.transport === right.transport &&
    left.dataBoundary === right.dataBoundary
  );
}
