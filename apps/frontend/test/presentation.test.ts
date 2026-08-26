import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  ConversationSummaryResource,
  ProjectResource,
} from '@vera/client';

import {
  displayConversationTitle,
  filterConversations,
  groupConversations,
  projectContextLabel,
} from '../src/components/assistant/presentation';

function summary(
  id: string,
  title: string,
  updatedAt: string,
  lastMessage = 'Latest message',
): ConversationSummaryResource {
  return {
    schemaVersion: 1,
    id,
    title,
    status: 'active',
    messageCount: 2,
    lastMessage: {
      id: `message_${id}`,
      role: 'vera',
      content: lastMessage,
      createdAt: updatedAt,
    },
    createdAt: updatedAt,
    updatedAt,
  };
}

void describe('assistant presentation', () => {
  void it('normalizes and truncates titles at a readable boundary', () => {
    assert.equal(
      displayConversationTitle('  Plan   a focused day  '),
      'Plan a focused day',
    );
    assert.equal(displayConversationTitle(undefined), 'New conversation');
    assert.equal(
      displayConversationTitle(
        'Research the safest way to expose the Vera API to my phone',
        34,
      ),
      'Research the safest way to…',
    );
  });

  void it('groups conversations by recency in descending order', () => {
    const now = new Date(2026, 7, 26, 12);
    const today = summary(
      'conversation_today',
      'Today',
      new Date(2026, 7, 26, 9).toISOString(),
    );
    const recent = summary(
      'conversation_recent',
      'Recent',
      new Date(2026, 7, 22, 9).toISOString(),
    );
    const earlier = summary(
      'conversation_earlier',
      'Earlier',
      new Date(2026, 6, 1, 9).toISOString(),
    );

    assert.deepEqual(
      groupConversations([earlier, recent, today], now).map((group) => [
        group.label,
        group.conversations.map((conversation) => conversation.id),
      ]),
      [
        ['Today', ['conversation_today']],
        ['Previous 7 days', ['conversation_recent']],
        ['Earlier', ['conversation_earlier']],
      ],
    );
  });

  void it('searches titles and last-message previews case-insensitively', () => {
    const conversations = [
      summary('conversation_one', 'Project planning', new Date().toISOString()),
      summary(
        'conversation_two',
        'Morning',
        new Date().toISOString(),
        'Research Redis durability',
      ),
    ];

    assert.deepEqual(
      filterConversations(conversations, 'redis').map((item) => item.id),
      ['conversation_two'],
    );
    assert.deepEqual(
      filterConversations(conversations, 'PROJECT').map((item) => item.id),
      ['conversation_one'],
    );
  });

  void it('uses a human label for personal and selected project context', () => {
    const project = {
      id: 'project_vera',
      displayName: 'Vera',
    } as ProjectResource;

    assert.equal(projectContextLabel(undefined, [project]), 'Personal');
    assert.equal(projectContextLabel(project.id, [project]), 'Vera');
    assert.equal(projectContextLabel('project_missing', [project]), 'Project');
  });
});
