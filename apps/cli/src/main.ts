import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

import {
  VeraClient,
  type Approval,
  type ChangeApplicationResource,
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
  vera capability list
  vera capability show <capability-name>
  vera personal-task list [--status <all|open|completed>] [--limit <number>]
  vera personal-task show <personal-task-id>
  vera reminder list [--status <all|scheduled|delivered|acknowledged|cancelled>] [--limit <number>]
  vera reminder show <reminder-id>
  vera notification list [--after <cursor>] [--limit <number>]
  vera notification watch [--after <cursor>]
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
  vera application show <application-id>
  vera application wait <application-id> [--timeout-ms <milliseconds>]
  vera application events <application-id>
  vera application cancel <application-id>
  vera plan --project <project-id> --message <message> [--key <key>] [--approve]
  vera change --project <project-id> --message <message> [--key <key>] [--approve]
  vera research --message <message> [--key <key>] [--approve]
  vera change apply --artifact <artifact-id> [--key <key>] [--approve]

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
    authority: approval.authority,
    proposedArguments: approval.proposedArguments,
    contextManifest: approval.contextManifest,
    inputArtifacts: approval.inputArtifacts,
    decisionEvidence: approval.decisionEvidence,
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

function isApplicationTerminal(
  application: ChangeApplicationResource,
): boolean {
  return [
    'succeeded',
    'rejected',
    'failed',
    'review_required',
    'cancelled',
  ].includes(application.status);
}

async function resolveApproval(input: {
  task: TaskResource;
  client: VeraApi;
  autoApprove: boolean;
  confirm: (question: string) => Promise<boolean>;
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
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
  if (isTerminal(decided)) return decided;
  input.stderr.write(
    `Approval recorded. Waiting for run ${decided.runId} to finish...\n`,
  );
  const decidedApprovalId = input.task.approval.id;
  return input.client.waitForRun(decided.runId, {
    until: (task) =>
      isTerminal(task) ||
      (task.runStatus === 'awaiting_approval' &&
        task.approval?.status === 'pending' &&
        task.approval.id !== decidedApprovalId),
  });
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

  if (resource === 'capability' && action === 'list') {
    print(stdout, await client.listCapabilities());
    return 0;
  }
  if (resource === 'capability' && action === 'show') {
    const name = positional(args, 2, 'capability-name');
    const catalog = await client.listCapabilities();
    const capability = catalog.capabilities.find(
      (candidate) => candidate.name === name,
    );
    if (capability === undefined) {
      throw new Error(`Capability ${name} was not found.`);
    }
    print(stdout, capability);
    return 0;
  }

  if (resource === 'personal-task' && action === 'list') {
    const status = option(args, '--status');
    if (
      status !== undefined &&
      !['all', 'open', 'completed'].includes(status)
    ) {
      throw new Error('--status must be all, open, or completed.');
    }
    const limit = positiveIntegerOption(args, '--limit');
    print(
      stdout,
      await client.listPersonalTasks({
        ...(status === undefined
          ? {}
          : { status: status as 'all' | 'open' | 'completed' }),
        ...(limit === undefined ? {} : { limit }),
      }),
    );
    return 0;
  }
  if (resource === 'personal-task' && action === 'show') {
    print(
      stdout,
      await client.getPersonalTask(positional(args, 2, 'personal-task-id')),
    );
    return 0;
  }

  if (resource === 'reminder' && action === 'list') {
    const status = option(args, '--status');
    if (
      status !== undefined &&
      !['all', 'scheduled', 'delivered', 'acknowledged', 'cancelled'].includes(
        status,
      )
    ) {
      throw new Error(
        '--status must be all, scheduled, delivered, acknowledged, or cancelled.',
      );
    }
    const limit = positiveIntegerOption(args, '--limit');
    print(
      stdout,
      await client.listReminders({
        ...(status === undefined
          ? {}
          : {
              status: status as
                | 'all'
                | 'scheduled'
                | 'delivered'
                | 'acknowledged'
                | 'cancelled',
            }),
        ...(limit === undefined ? {} : { limit }),
      }),
    );
    return 0;
  }
  if (resource === 'reminder' && action === 'show') {
    print(stdout, await client.getReminder(positional(args, 2, 'reminder-id')));
    return 0;
  }

  if (resource === 'notification' && action === 'list') {
    const after = option(args, '--after');
    const limit = positiveIntegerOption(args, '--limit');
    print(
      stdout,
      await client.listNotifications({
        ...(after === undefined ? {} : { after }),
        ...(limit === undefined ? {} : { limit }),
      }),
    );
    return 0;
  }
  if (resource === 'notification' && action === 'watch') {
    const after = option(args, '--after');
    for await (const event of client.streamNotifications({
      ...(after === undefined ? {} : { after }),
    })) {
      print(stdout, event);
    }
    return 0;
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
    let completed = review;
    while (completed.runStatus === 'awaiting_approval') {
      completed = await resolveApproval({
        task: completed,
        client,
        autoApprove: args.includes('--approve'),
        confirm,
        stdout,
        stderr,
      });
    }
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

  if (resource === 'application' && action === 'show') {
    print(
      stdout,
      await client.getChangeApplication(positional(args, 2, 'application-id')),
    );
    return 0;
  }
  if (resource === 'application' && action === 'wait') {
    const timeout = positiveIntegerOption(args, '--timeout-ms');
    print(
      stdout,
      await client.waitForChangeApplication(
        positional(args, 2, 'application-id'),
        timeout === undefined ? undefined : { timeoutMs: timeout },
      ),
    );
    return 0;
  }
  if (resource === 'application' && action === 'events') {
    print(
      stdout,
      await client.getChangeApplicationEvents(
        positional(args, 2, 'application-id'),
      ),
    );
    return 0;
  }
  if (resource === 'application' && action === 'cancel') {
    print(
      stdout,
      await client.cancelChangeApplication(
        positional(args, 2, 'application-id'),
      ),
    );
    return 0;
  }

  if (resource === 'change' && action === 'apply') {
    const application = await client.createChangeApplication({
      artifactId: requiredOption(args, '--artifact'),
      idempotencyKey: option(args, '--key') ?? createKey(),
    });
    print(stdout, {
      approval: {
        approvalId: application.approval.id,
        reason: application.approval.reason,
        sourceArtifact: application.approval.sourceArtifact,
        project: application.approval.project,
        effect: application.approval.effect,
      },
    });
    const approved =
      args.includes('--approve') ||
      (await confirm(
        'Apply and stage this exact patch in the disclosed managed Git worktree?',
      ));
    let current = await client.decideChangeApplication({
      applicationId: application.id,
      decision: approved ? 'approved' : 'rejected',
    });
    if (!isApplicationTerminal(current)) {
      stderr.write(
        `Approval recorded. Waiting for change application ${current.id} to finish...\n`,
      );
      current = await client.waitForChangeApplication(current.id);
    }
    print(stdout, current);
    return current.status === 'succeeded' ? 0 : 2;
  }

  if (resource === 'plan' || resource === 'change' || resource === 'research') {
    const expectedCapability =
      resource === 'plan'
        ? 'development_planning'
        : resource === 'change'
          ? 'software_change'
          : 'web_research';
    const projectId =
      resource === 'research' ? undefined : requiredOption(args, '--project');
    const submitted = await client.submitTask({
      message: requiredOption(args, '--message'),
      ...(projectId === undefined ? {} : { projectId }),
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
    if (review.approval.capability.name !== expectedCapability) {
      throw new Error(
        `Vera proposed ${review.approval.capability.name}, but the ${resource} command only permits ${expectedCapability}.`,
      );
    }
    const completed = await resolveApproval({
      task: review,
      client,
      autoApprove: args.includes('--approve'),
      confirm,
      stdout,
      stderr,
    });
    print(stdout, completed);
    if (completed.output !== undefined && 'artifact' in completed.output) {
      print(stdout, await client.getArtifact(completed.output.artifact.id));
    }
    return completed.runStatus === 'succeeded' ? 0 : 2;
  }

  stderr.write(usage);
  throw new Error(`Unknown command: ${args.join(' ')}`);
}
