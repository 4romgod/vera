import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

import {
  VeraClient,
  type Approval,
  type TaskResource,
  type VeraApi,
} from '@vera/client';

export type CliDependencies = {
  client?: VeraApi;
  baseUrl?: string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
  confirm?: (question: string) => Promise<boolean>;
  createIdempotencyKey?: () => string;
};

const usage = `Usage:
  vera project add --name <name> --path <absolute-git-root> [--key <key>]
  vera project list
  vera project show <project-id>
  vera conversation create [--title <title>] [--key <key>]
  vera conversation list
  vera conversation show <conversation-id>
  vera conversation message <conversation-id> --content <content> [--project <project-id>] [--key <key>]
  vera chat --message <message> [--conversation <conversation-id>] [--title <title>] [--project <project-id>] [--key <key>] [--approve]
  vera task submit --message <message> [--project <project-id>] [--key <key>]
  vera task show <task-id>
  vera run show <run-id>
  vera run wait <run-id> [--timeout-ms <milliseconds>]
  vera run events <run-id>
  vera run cancel <run-id>
  vera approval decide <approval-id> <approved|rejected>
  vera artifact show <artifact-id>
  vera plan --project <project-id> --message <message> [--key <key>] [--approve]

Global options:
  --url <base-url>   Defaults to VERA_API_URL or http://127.0.0.1:4310
`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function requiredOption(args: string[], name: string): string {
  const value = option(args, name);
  if (value === undefined) throw new Error(`${name} is required.`);
  return value;
}

function positional(args: string[], index: number, label: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function positiveIntegerOption(
  args: string[],
  name: string,
): number | undefined {
  const value = option(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function print(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  value: unknown,
): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function approvalDisclosure(approval: Approval): Record<string, unknown> {
  return {
    approvalId: approval.id,
    reason: approval.reason,
    capability: approval.capability,
    project: approval.project,
    destination: approval.destination,
    proposedArguments: approval.proposedArguments,
    contextManifest: approval.contextManifest,
  };
}

function isTerminal(task: TaskResource): boolean {
  return ['succeeded', 'rejected', 'failed', 'cancelled'].includes(
    task.runStatus,
  );
}

function isConversationTerminal(task: TaskResource): boolean {
  return isTerminal(task) && task.conversationReply?.status === 'projected';
}

async function resolveApproval(input: {
  task: TaskResource;
  client: VeraApi;
  autoApprove: boolean;
  confirm: (question: string) => Promise<boolean>;
  stdout: Pick<NodeJS.WriteStream, 'write'>;
}): Promise<TaskResource> {
  if (
    input.task.runStatus !== 'awaiting_approval' ||
    input.task.approval === undefined
  ) {
    return input.task;
  }
  print(input.stdout, { approval: approvalDisclosure(input.task.approval) });
  const approved =
    input.autoApprove ||
    (await input.confirm('Approve this exact specialist invocation?'));
  const decided = await input.client.decideApproval(
    input.task.approval.id,
    approved ? 'approved' : 'rejected',
  );
  return isTerminal(decided) ? decided : input.client.waitForRun(decided.runId);
}

async function interactiveConfirm(question: string): Promise<boolean> {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await terminal.question(`${question} [y/N] `);
    return ['y', 'yes'].includes(answer.trim().toLowerCase());
  } finally {
    terminal.close();
  }
}

export async function runCli(
  argv: string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const baseUrl =
    dependencies.baseUrl ??
    option(argv, '--url') ??
    process.env.VERA_API_URL ??
    'http://127.0.0.1:4310';
  const client = dependencies.client ?? new VeraClient({ baseUrl });
  const createKey =
    dependencies.createIdempotencyKey ?? (() => `cli-${randomUUID()}`);
  const confirm = dependencies.confirm ?? interactiveConfirm;
  const args = argv.filter(
    (value, index) =>
      value !== '--url' && (index === 0 || argv[index - 1] !== '--url'),
  );
  const [resource, action] = args;

  if (resource === undefined || ['help', '--help', '-h'].includes(resource)) {
    stderr.write(usage);
    return resource === undefined ? 1 : 0;
  }

  if (resource === 'project' && action === 'add') {
    const project = await client.registerProject({
      displayName: requiredOption(args, '--name'),
      rootPath: requiredOption(args, '--path'),
      idempotencyKey: option(args, '--key') ?? createKey(),
    });
    print(stdout, project);
    return 0;
  }
  if (resource === 'project' && action === 'list') {
    print(stdout, await client.listProjects());
    return 0;
  }
  if (resource === 'project' && action === 'show') {
    print(stdout, await client.getProject(positional(args, 2, 'project-id')));
    return 0;
  }

  if (resource === 'conversation' && action === 'create') {
    const title = option(args, '--title');
    print(
      stdout,
      await client.createConversation({
        idempotencyKey: option(args, '--key') ?? createKey(),
        ...(title === undefined ? {} : { title }),
      }),
    );
    return 0;
  }
  if (resource === 'conversation' && action === 'list') {
    print(stdout, await client.listConversations());
    return 0;
  }
  if (resource === 'conversation' && action === 'show') {
    print(
      stdout,
      await client.getConversation(positional(args, 2, 'conversation-id')),
    );
    return 0;
  }
  if (resource === 'conversation' && action === 'message') {
    const projectId = option(args, '--project');
    print(
      stdout,
      await client.appendMessage({
        conversationId: positional(args, 2, 'conversation-id'),
        content: requiredOption(args, '--content'),
        idempotencyKey: option(args, '--key') ?? createKey(),
        ...(projectId === undefined ? {} : { projectId }),
      }),
    );
    return 0;
  }

  if (resource === 'chat') {
    const message = requiredOption(args, '--message').trim();
    if (message.length === 0) {
      throw new Error('--message must contain non-whitespace text.');
    }
    const projectId = option(args, '--project');
    const requestedConversationId = option(args, '--conversation');
    const conversation =
      requestedConversationId === undefined
        ? await client.createConversation({
            idempotencyKey: createKey(),
            title: option(args, '--title') ?? message.slice(0, 200),
          })
        : await client.getConversation(requestedConversationId);
    const submitted = await client.appendMessage({
      conversationId: conversation.id,
      content: message,
      idempotencyKey: option(args, '--key') ?? createKey(),
      ...(projectId === undefined ? {} : { projectId }),
    });
    const review = await client.waitForRun(submitted.runId, {
      until: (task) =>
        task.runStatus === 'awaiting_approval' || isConversationTerminal(task),
    });
    const completed = await resolveApproval({
      task: review,
      client,
      autoApprove: args.includes('--approve'),
      confirm,
      stdout,
    });
    const finalTask = isConversationTerminal(completed)
      ? completed
      : await client.waitForRun(completed.runId);
    const refreshed = await client.getConversation(conversation.id);
    const reply = refreshed.messages.find(
      (candidate) =>
        candidate.role === 'vera' && candidate.taskId === finalTask.taskId,
    );
    if (reply === undefined) {
      throw new Error(
        `Vera completed task ${finalTask.taskId} without projecting its conversation reply.`,
      );
    }
    print(stdout, {
      conversationId: conversation.id,
      taskId: finalTask.taskId,
      runId: finalTask.runId,
      runStatus: finalTask.runStatus,
      reply,
      ...(finalTask.conversationContextManifest === undefined
        ? {}
        : { conversationContext: finalTask.conversationContextManifest }),
    });
    return finalTask.runStatus === 'succeeded' ? 0 : 2;
  }

  if (resource === 'task' && action === 'submit') {
    const projectId = option(args, '--project');
    const task = await client.submitTask({
      message: requiredOption(args, '--message'),
      idempotencyKey: option(args, '--key') ?? createKey(),
      ...(projectId === undefined ? {} : { projectId }),
    });
    print(stdout, task);
    return 0;
  }
  if (resource === 'task' && action === 'show') {
    print(stdout, await client.getTask(positional(args, 2, 'task-id')));
    return 0;
  }

  if (resource === 'run' && action === 'show') {
    print(stdout, await client.getRun(positional(args, 2, 'run-id')));
    return 0;
  }
  if (resource === 'run' && action === 'wait') {
    const timeout = positiveIntegerOption(args, '--timeout-ms');
    print(
      stdout,
      await client.waitForRun(positional(args, 2, 'run-id'), {
        ...(timeout === undefined ? {} : { timeoutMs: timeout }),
      }),
    );
    return 0;
  }
  if (resource === 'run' && action === 'events') {
    print(stdout, await client.getRunEvents(positional(args, 2, 'run-id')));
    return 0;
  }
  if (resource === 'run' && action === 'cancel') {
    print(stdout, await client.cancelRun(positional(args, 2, 'run-id')));
    return 0;
  }

  if (resource === 'approval' && action === 'decide') {
    const decision = positional(args, 3, 'decision');
    if (!['approved', 'rejected'].includes(decision)) {
      throw new Error('decision must be approved or rejected.');
    }
    print(
      stdout,
      await client.decideApproval(
        positional(args, 2, 'approval-id'),
        decision as 'approved' | 'rejected',
      ),
    );
    return 0;
  }

  if (resource === 'artifact' && action === 'show') {
    print(stdout, await client.getArtifact(positional(args, 2, 'artifact-id')));
    return 0;
  }

  if (resource === 'plan') {
    const submitted = await client.submitTask({
      message: requiredOption(args, '--message'),
      projectId: requiredOption(args, '--project'),
      idempotencyKey: option(args, '--key') ?? createKey(),
    });
    const review = await client.waitForRun(submitted.runId, {
      until: (task) =>
        task.runStatus === 'awaiting_approval' || isTerminal(task),
    });
    if (
      review.runStatus !== 'awaiting_approval' ||
      review.approval === undefined
    ) {
      print(stdout, review);
      return review.runStatus === 'succeeded' ? 0 : 2;
    }
    const completed = await resolveApproval({
      task: review,
      client,
      autoApprove: args.includes('--approve'),
      confirm,
      stdout,
    });
    print(stdout, completed);
    if (completed.output?.artifact !== undefined) {
      print(stdout, await client.getArtifact(completed.output.artifact.id));
    }
    return completed.runStatus === 'succeeded' ? 0 : 2;
  }

  stderr.write(usage);
  throw new Error(`Unknown command: ${args.join(' ')}`);
}
