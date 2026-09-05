import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GitHubAwarenessSource } from '../../../../src/adapters/outbound/external-awareness/github/github-awareness-source.ts';
import type { GitHubCommandRunner } from '../../../../src/adapters/outbound/github/github-cli.ts';

void describe('GitHub awareness source', () => {
  void it('reads bounded notifications and failed checks without invoking a write command', async () => {
    const calls: string[][] = [];
    const run: GitHubCommandRunner = (_command, args) => {
      calls.push(args);
      const joined = args.join(' ');
      if (joined === 'api user')
        return Promise.resolve({
          stdout: JSON.stringify({ id: 123 }),
          stderr: '',
          exitCode: 0,
        });
      if (joined.startsWith('repo view'))
        return Promise.resolve({
          stdout: JSON.stringify({ nameWithOwner: '4romgod/vera' }),
          stderr: '',
          exitCode: 0,
        });
      if (joined.includes('/notifications'))
        return Promise.resolve({
          stdout: JSON.stringify([
            {
              id: 'notification-one',
              reason: 'review_requested',
              updated_at: '2026-09-05T10:00:00.000Z',
              subject: {
                title: 'Review the awareness slice',
                url: 'https://api.github.com/repos/4romgod/vera/pulls/42',
                type: 'PullRequest',
              },
            },
            {
              id: 'ignored-comment',
              reason: 'comment',
              updated_at: '2026-09-05T09:00:00.000Z',
              subject: {
                title: 'Ordinary comment',
                url: 'https://api.github.com/repos/4romgod/vera/issues/1',
                type: 'Issue',
              },
            },
          ]),
          stderr: '',
          exitCode: 0,
        });
      return Promise.resolve({
        stdout: JSON.stringify([
          {
            number: 42,
            title: 'External awareness',
            url: 'https://github.com/4romgod/vera/pull/42',
            updatedAt: '2026-09-05T10:01:00.000Z',
            statusCheckRollup: [
              { name: 'quality-gate', conclusion: 'FAILURE' },
              { name: 'build', conclusion: 'SUCCESS' },
            ],
          },
        ]),
        stderr: '',
        exitCode: 0,
      });
    };
    const source = new GitHubAwarenessSource({ run });
    const result = await source.observe({
      principalId: 'owner_v1',
      connectionId: 'connection_test',
      account: { providerAccountId: '123', login: '4romgod' },
      repository: { provider: 'github', owner: '4romgod', name: 'vera' },
      categories: ['review_requested', 'failed_check'],
    });

    assert.deepEqual(
      result.observations.map(({ category }) => category).sort(),
      ['failed_check', 'review_requested'],
    );
    assert.equal(
      result.observations.find(
        ({ category }) => category === 'review_requested',
      )?.url,
      'https://github.com/4romgod/vera/pull/42',
    );
    assert.ok(
      calls.every(
        (args) =>
          !['create', 'edit', 'close', 'merge'].some((word) =>
            args.includes(word),
          ),
      ),
    );
  });

  void it('fails closed before repository reads when the host account drifts', async () => {
    const calls: string[][] = [];
    const source = new GitHubAwarenessSource({
      run: (_command, args) => {
        calls.push(args);
        return Promise.resolve({
          stdout: JSON.stringify({ id: 999 }),
          stderr: '',
          exitCode: 0,
        });
      },
    });
    await assert.rejects(
      source.observe({
        principalId: 'owner_v1',
        connectionId: 'connection_test',
        account: { providerAccountId: '123', login: 'approved-owner' },
        repository: { provider: 'github', owner: '4romgod', name: 'vera' },
        categories: ['assigned'],
      }),
      /differs from the account approved/u,
    );
    assert.deepEqual(calls, [['api', 'user']]);
  });

  void it('suppresses absence-based resolution when a provider page is full', async () => {
    const source = new GitHubAwarenessSource({
      run: (_command, args) => {
        const joined = args.join(' ');
        const value =
          joined === 'api user'
            ? { id: 123 }
            : joined.startsWith('repo view')
              ? { nameWithOwner: '4romgod/vera' }
              : Array.from({ length: 100 }, (_, index) => ({
                  id: `mention-${String(index)}`,
                  reason: 'mention',
                  updated_at: '2026-09-05T10:00:00.000Z',
                  subject: {
                    title: `Mention ${String(index)}`,
                    url: `https://api.github.com/repos/4romgod/vera/issues/${String(index + 1)}`,
                    type: 'Issue',
                  },
                }));
        return Promise.resolve({
          stdout: JSON.stringify(value),
          stderr: '',
          exitCode: 0,
        });
      },
    });
    const result = await source.observe({
      principalId: 'owner_v1',
      connectionId: 'connection_test',
      account: { providerAccountId: '123', login: '4romgod' },
      repository: { provider: 'github', owner: '4romgod', name: 'vera' },
      categories: ['mentioned'],
    });
    assert.equal(result.observations.length, 100);
    assert.equal(result.complete, false);
  });
});
