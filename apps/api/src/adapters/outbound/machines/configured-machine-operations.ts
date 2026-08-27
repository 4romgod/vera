import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { hostname, arch, platform, uptime, freemem, totalmem } from 'node:os';
import { connect } from 'node:net';
import { delimiter, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

import {
  MachineDiagnosticSchema,
  MachineInspectionArgumentsSchema,
  MachineServiceActionArgumentsSchema,
  MachineServiceActionResultSchema,
  type MachineCatalog,
  type MachineCommand,
  type RegisteredMachine,
} from '../../../domain/machines/machine.ts';
import {
  sameCapabilityDestination,
  type CapabilityDestination,
} from '../../../domain/capabilities/capability-destination.ts';
import type { MachineOperations } from '../../../ports/machines/machine-operations.ts';

const executeFile = promisify(execFile);
const OUTPUT_LIMIT = 4_000;
const INSPECTION_CONCURRENCY = 4;

function bounded(value: string | Buffer | undefined): string {
  const normalized = String(value ?? '')
    .replaceAll(/\s+/gu, ' ')
    .trim();
  return normalized.length <= OUTPUT_LIMIT
    ? normalized
    : `${normalized.slice(0, OUTPUT_LIMIT - 1)}…`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new DOMException('Machine operation was aborted.', 'AbortError');
  }
}

async function mapConcurrent<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(inputs.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(inputs[index] as Input);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () =>
      worker(),
    ),
  );
  return results;
}

async function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(finish, milliseconds);
    function finish() {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Machine operation was aborted.', 'AbortError'));
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function assertExecutable(executable: string): Promise<void> {
  const candidates = isAbsolute(executable)
    ? [executable]
    : (process.env.PATH ?? '')
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, executable));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return;
    } catch {
      // Continue through the explicit PATH candidates.
    }
  }
  throw new Error(`Registered executable ${executable} is unavailable.`);
}

function machineDestination(machine: RegisteredMachine): CapabilityDestination {
  return {
    schemaVersion: 1,
    adapterId: `machine.${machine.id}`,
    provider: machine.adapter.kind,
    transport: machine.adapter.kind === 'local' ? 'in_process' : 'ssh',
    dataBoundary: 'owner_controlled',
  };
}

async function runCommand(
  machine: RegisteredMachine,
  command: MachineCommand,
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; summary: string; durationMs: number }> {
  throwIfAborted(signal);
  const started = Date.now();
  const executable =
    machine.adapter.kind === 'local'
      ? command.executable
      : machine.adapter.command;
  const arguments_ =
    machine.adapter.kind === 'local'
      ? command.arguments
      : [
          ...machine.adapter.arguments,
          machine.adapter.host,
          [command.executable, ...command.arguments].map(shellQuote).join(' '),
        ];
  try {
    const result = await executeFile(executable, arguments_, {
      timeout: command.timeoutMs,
      maxBuffer: 64 * 1024,
      signal,
      encoding: 'utf8',
    });
    return {
      exitCode: 0,
      summary:
        bounded(result.stdout) ||
        bounded(result.stderr) ||
        'Command completed successfully.',
      durationMs: Date.now() - started,
    };
  } catch (error) {
    if (signal?.aborted === true) throwIfAborted(signal);
    const failure = error as {
      code?: string | number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      exitCode: typeof failure.code === 'number' ? failure.code : null,
      summary:
        bounded(failure.stdout) ||
        bounded(failure.stderr) ||
        bounded(failure.message) ||
        'Command failed without output.',
      durationMs: Date.now() - started,
    };
  }
}

async function tcpProbe(
  host: string,
  port: number,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const started = Date.now();
  throwIfAborted(signal);
  return new Promise<{ healthy: boolean; summary: string; durationMs: number }>(
    (resolve) => {
      const socket = connect({ host, port });
      let settled = false;
      const finish = (healthy: boolean, summary: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({ healthy, summary, durationMs: Date.now() - started });
      };
      const timeout = setTimeout(
        () =>
          finish(false, `TCP probe timed out after ${String(timeoutMs)}ms.`),
        timeoutMs,
      );
      const abort = () => finish(false, 'TCP probe was aborted.');
      signal?.addEventListener('abort', abort, { once: true });
      socket.once('connect', () =>
        finish(true, `TCP ${host}:${String(port)} accepted a connection.`),
      );
      socket.once('error', (error) => finish(false, bounded(error.message)));
      socket.once('close', () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      });
    },
  );
}

export class ConfiguredMachineOperations implements MachineOperations {
  public constructor(public readonly catalog: MachineCatalog) {}

  private machine(machineId: string): RegisteredMachine {
    const machine = this.catalog.machines.find(({ id }) => id === machineId);
    if (machine === undefined)
      throw new Error(`Machine ${machineId} is not registered.`);
    return machine;
  }

  public destinationFor(machineId: string): CapabilityDestination {
    return machineDestination(this.machine(machineId));
  }

  public resolve(destination: CapabilityDestination): string | null {
    const machine = this.catalog.machines.find((candidate) =>
      sameCapabilityDestination(machineDestination(candidate), destination),
    );
    return machine?.id ?? null;
  }

  public async checkReadiness(): Promise<void> {
    const executables = new Set<string>();
    for (const machine of this.catalog.machines) {
      if (machine.adapter.kind === 'ssh')
        executables.add(machine.adapter.command);
      for (const diagnostic of machine.diagnostics) {
        if (machine.adapter.kind === 'local') {
          executables.add(diagnostic.command.executable);
        }
      }
      for (const service of machine.services) {
        if (
          machine.adapter.kind === 'local' &&
          service.probe.kind === 'command'
        ) {
          executables.add(service.probe.command.executable);
        }
        if (machine.adapter.kind === 'local') {
          for (const action of Object.values(service.actions)) {
            if (action !== undefined) executables.add(action.executable);
          }
        }
      }
    }
    await Promise.all([...executables].map(assertExecutable));
  }

  private async observe(
    machine: RegisteredMachine,
    probe: RegisteredMachine['services'][number]['probe'],
    signal?: AbortSignal,
  ) {
    const checkedAt = new Date().toISOString();
    if (probe.kind === 'command') {
      const result = await runCommand(machine, probe.command, signal);
      return {
        status: probe.healthyExitCodes.includes(result.exitCode ?? -1)
          ? ('healthy' as const)
          : ('unhealthy' as const),
        checkedAt,
        durationMs: result.durationMs,
        summary: result.summary,
        exitCode: result.exitCode,
      };
    }
    if (probe.kind === 'tcp') {
      const result = await tcpProbe(
        probe.host,
        probe.port,
        probe.timeoutMs,
        signal,
      );
      throwIfAborted(signal);
      return {
        status: result.healthy ? ('healthy' as const) : ('unhealthy' as const),
        checkedAt,
        durationMs: result.durationMs,
        summary: result.summary,
      };
    }
    const started = Date.now();
    try {
      const response = await fetch(probe.url, {
        signal: AbortSignal.any([
          signal ?? new AbortController().signal,
          AbortSignal.timeout(probe.timeoutMs),
        ]),
      });
      await response.body?.cancel();
      return {
        status: probe.healthyStatuses.includes(response.status)
          ? ('healthy' as const)
          : ('unhealthy' as const),
        checkedAt,
        durationMs: Date.now() - started,
        summary: `HTTP probe returned ${String(response.status)}.`,
      };
    } catch (error) {
      throwIfAborted(signal);
      return {
        status: 'unhealthy' as const,
        checkedAt,
        durationMs: Date.now() - started,
        summary: bounded(
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
  }

  public async inspect(
    arguments_: unknown,
    options?: { signal?: AbortSignal },
  ) {
    const input = MachineInspectionArgumentsSchema.parse(arguments_);
    const machine = this.machine(input.machineId);
    const selectedServices =
      input.serviceIds === undefined
        ? machine.services
        : input.serviceIds.map((id) => {
            const service = machine.services.find(
              (candidate) => candidate.id === id,
            );
            if (service === undefined)
              throw new Error(
                `Service ${id} is not registered on ${machine.id}.`,
              );
            return service;
          });
    const diagnostics = await mapConcurrent(
      machine.diagnostics,
      INSPECTION_CONCURRENCY,
      async (diagnostic) => {
        const result = await runCommand(
          machine,
          diagnostic.command,
          options?.signal,
        );
        return {
          id: diagnostic.id,
          label: diagnostic.label,
          observation: {
            status:
              result.exitCode === 0
                ? ('healthy' as const)
                : ('unhealthy' as const),
            checkedAt: new Date().toISOString(),
            durationMs: result.durationMs,
            summary: result.summary,
            exitCode: result.exitCode,
          },
        };
      },
    );
    const services = await mapConcurrent(
      selectedServices,
      INSPECTION_CONCURRENCY,
      async (service) => ({
        id: service.id,
        displayName: service.displayName,
        observation: await this.observe(
          machine,
          service.probe,
          options?.signal,
        ),
      }),
    );
    return MachineDiagnosticSchema.parse({
      schemaVersion: 1,
      machine: { id: machine.id, displayName: machine.displayName },
      adapter: machine.adapter.kind,
      inspectedAt: new Date().toISOString(),
      system:
        machine.adapter.kind === 'local'
          ? {
              hostname: hostname(),
              platform: platform(),
              architecture: arch(),
              uptimeSeconds: uptime(),
              freeMemoryBytes: freemem(),
              totalMemoryBytes: totalmem(),
            }
          : {
              hostname: machine.adapter.host,
              platform: 'remote',
              architecture: 'unknown',
            },
      diagnostics,
      services,
    });
  }

  public async manageService(
    arguments_: unknown,
    options: { recovery: boolean; signal?: AbortSignal },
  ) {
    const input = MachineServiceActionArgumentsSchema.parse(arguments_);
    const machine = this.machine(input.machineId);
    const service = machine.services.find(({ id }) => id === input.serviceId);
    if (service === undefined)
      throw new Error(
        `Service ${input.serviceId} is not registered on ${machine.id}.`,
      );
    const command = service.actions[input.action];
    if (command === undefined)
      throw new Error(
        `${input.action} is not registered for ${service.id} on ${machine.id}.`,
      );
    const before = await this.observe(machine, service.probe, options.signal);
    const desiredAlreadyReached =
      options.recovery &&
      (input.action === 'stop'
        ? before.status === 'unhealthy'
        : before.status === 'healthy');
    const execution = desiredAlreadyReached
      ? {
          exitCode: 0,
          summary:
            'Recovery found the approved postcondition already satisfied; the action was not repeated.',
          durationMs: 0,
        }
      : await runCommand(machine, command, options.signal);
    if (execution.exitCode !== 0)
      throw new Error(
        `The registered ${input.action} action failed for ${service.id} on ${machine.id}.`,
      );
    let after = before;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await abortableDelay(250, options.signal);
      after = await this.observe(machine, service.probe, options.signal);
      const verified =
        input.action === 'stop'
          ? after.status === 'unhealthy'
          : after.status === 'healthy';
      if (verified) break;
    }
    const verified =
      input.action === 'stop'
        ? after.status === 'unhealthy'
        : after.status === 'healthy';
    if (!verified)
      throw new Error(
        `The ${input.action} command completed but its registered postcondition was not met.`,
      );
    return MachineServiceActionResultSchema.parse({
      schemaVersion: 1,
      machine: { id: machine.id, displayName: machine.displayName },
      service: { id: service.id, displayName: service.displayName },
      action: input.action,
      before,
      execution: {
        exitCode: execution.exitCode,
        summary: desiredAlreadyReached
          ? execution.summary
          : `Registered ${input.action} action completed successfully.`,
      },
      after,
      verified,
      completedAt: new Date().toISOString(),
    });
  }
}
