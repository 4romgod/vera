import { z } from 'zod';

import { GitHubIntegrationDefinition } from '../../../../domain/integrations/integration-connection.ts';
import type { IntegrationConnector } from '../../../../ports/integrations/integration-connector.ts';
import {
  defaultGitHubCommandRunner,
  type GitHubCommandRunner,
} from '../../github/github-cli.ts';

const GitHubAccountSchema = z.looseObject({
  id: z.number().int().positive(),
  login: z.string().trim().min(1).max(200),
  name: z.string().nullable(),
  html_url: z.url(),
});

export class GitHubCliConnector implements IntegrationConnector {
  public readonly adapterId = 'github_gh_cli';
  public readonly definition = GitHubIntegrationDefinition;
  public readonly credentialBinding = {
    kind: 'host_session' as const,
    host: 'github.com',
  };
  private readonly command: string;
  private readonly run: GitHubCommandRunner;

  public constructor(
    options: {
      command?: string;
      run?: GitHubCommandRunner;
    } = {},
  ) {
    this.command = options.command ?? 'gh';
    this.run = options.run ?? defaultGitHubCommandRunner;
  }

  public async inspectAccount() {
    let result;
    try {
      result = await this.run(this.command, ['api', 'user']);
    } catch (error) {
      throw new Error(
        'GitHub requires an authenticated gh session on the Vera host.',
        { cause: error },
      );
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(result.stdout) as unknown;
    } catch (error) {
      throw new Error('GitHub returned an invalid account response.', {
        cause: error,
      });
    }
    const account = GitHubAccountSchema.parse(candidate);
    return {
      providerAccountId: String(account.id),
      login: account.login,
      ...(account.name === null || account.name.trim().length === 0
        ? {}
        : { displayName: account.name.trim() }),
      profileUrl: account.html_url,
    };
  }
}
