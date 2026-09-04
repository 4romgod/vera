import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';

import { InMemoryAttachmentStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-attachment-store.ts';
import { InMemoryKnowledgeStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-knowledge-store.ts';
import { InMemoryOwnerResourceStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { createAttachmentService } from '../../../src/application/attachments/attachment-service.ts';
import { createKnowledgeService } from '../../../src/application/knowledge/knowledge-service.ts';
import { ResourceError } from '../../../src/application/shared/resource-error.ts';
import type { KnowledgeStore } from '../../../src/ports/persistence/knowledge-store.ts';

function harness(store: KnowledgeStore = new InMemoryKnowledgeStore()) {
  const attachments = new InMemoryAttachmentStore();
  const resources = new InMemoryOwnerResourceStore();
  return {
    attachments,
    resources,
    knowledge: createKnowledgeService({
      store,
      attachments,
      artifacts: resources,
      projects: resources,
      createId: () => 'knowledge_test',
      clock: () => '2026-09-04T12:00:00.000Z',
    }),
  };
}

void describe('grounded knowledge service', () => {
  void it('requires validated visual evidence before indexing an image', async () => {
    const state = harness();
    const image = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: '#ffcc00',
      },
    })
      .png()
      .toBuffer();
    const uploaded = await createAttachmentService({
      store: state.attachments,
    }).upload({
      principalId: 'owner_v1',
      filename: 'whiteboard.png',
      mediaType: 'image/png',
      bytes: image,
    });

    await assert.rejects(
      state.knowledge.add({
        principalId: 'owner_v1',
        requestKey: 'knowledge-image-without-analysis',
        title: 'Whiteboard',
        scope: { kind: 'global' },
        attachmentIds: [uploaded.attachment.id],
      }),
      (error) =>
        error instanceof ResourceError &&
        error.code === 'knowledge_analysis_required',
    );
  });

  void it('fails closed if indexed source text changes after ingestion', async () => {
    const backing = new InMemoryKnowledgeStore();
    const state = harness(backing);
    const uploaded = await createAttachmentService({
      store: state.attachments,
    }).upload({
      principalId: 'owner_v1',
      filename: 'trusted.txt',
      mediaType: 'text/plain',
      bytes: new TextEncoder().encode(
        'The trusted launch code is yellow-seven.',
      ),
    });
    await state.knowledge.add({
      principalId: 'owner_v1',
      requestKey: 'knowledge-integrity-source',
      title: 'Trusted note',
      scope: { kind: 'global' },
      attachmentIds: [uploaded.attachment.id],
    });
    const corruptStore: KnowledgeStore = {
      create: backing.create.bind(backing),
      findById: backing.findById.bind(backing),
      findByRequestKey: backing.findByRequestKey.bind(backing),
      async list(principalId, options) {
        const sources = await backing.list(principalId, options);
        const first = sources[0];
        if (first?.chunks[0] !== undefined) {
          first.chunks[0].text = 'A substituted launch code.';
        }
        return sources;
      },
      remove: backing.remove.bind(backing),
      checkReadiness: backing.checkReadiness.bind(backing),
      close: backing.close.bind(backing),
    };
    const corrupted = createKnowledgeService({
      store: corruptStore,
      attachments: state.attachments,
      artifacts: state.resources,
      projects: state.resources,
    });

    await assert.rejects(
      corrupted.search({ principalId: 'owner_v1', query: 'launch code' }),
      (error) =>
        error instanceof ResourceError &&
        error.code === 'knowledge_integrity_failure',
    );
  });

  void it("never discloses one owner's source to another owner", async () => {
    const state = harness();
    const uploaded = await createAttachmentService({
      store: state.attachments,
    }).upload({
      principalId: 'owner_one',
      filename: 'private.txt',
      mediaType: 'text/plain',
      bytes: new TextEncoder().encode('Only owner one knows the amber phrase.'),
    });
    const added = await state.knowledge.add({
      principalId: 'owner_one',
      requestKey: 'knowledge-owner-isolation',
      title: 'Private source',
      scope: { kind: 'global' },
      attachmentIds: [uploaded.attachment.id],
    });

    await assert.rejects(
      state.knowledge.get('owner_two', added.source.id),
      (error) =>
        error instanceof ResourceError &&
        error.code === 'knowledge_source_not_found',
    );
    const search = await state.knowledge.search({
      principalId: 'owner_two',
      query: 'amber phrase',
    });
    assert.deepEqual(search.citations, []);
  });

  void it('searches the whole library by default and isolates explicit project scope', async () => {
    const backing = new InMemoryKnowledgeStore();
    const attachments = new InMemoryAttachmentStore();
    const resources = new InMemoryOwnerResourceStore();
    let sequence = 0;
    const knowledge = createKnowledgeService({
      store: backing,
      attachments,
      artifacts: resources,
      projects: resources,
      createId: () => `knowledge_scope_${String(++sequence)}`,
      clock: () => '2026-09-04T12:00:00.000Z',
    });
    const project = (id: string, displayName: string) => ({
      schemaVersion: 1 as const,
      id,
      principalId: 'owner_v1',
      registrationKey: `registration-${id}`,
      displayName,
      normalizedName: displayName.toLocaleLowerCase('en'),
      source: { kind: 'local_git' as const, rootPath: `/tmp/${id}` },
      status: 'active' as const,
      createdAt: '2026-09-04T12:00:00.000Z',
      updatedAt: '2026-09-04T12:00:00.000Z',
    });
    await resources.createProject(project('project_alpha', 'Alpha'));
    await resources.createProject(project('project_beta', 'Beta'));
    const attachmentService = createAttachmentService({ store: attachments });
    for (const [name, scope] of [
      ['global', { kind: 'global' as const }],
      ['alpha', { kind: 'project' as const, projectId: 'project_alpha' }],
      ['beta', { kind: 'project' as const, projectId: 'project_beta' }],
    ] as const) {
      const uploaded = await attachmentService.upload({
        principalId: 'owner_v1',
        filename: `${name}.txt`,
        mediaType: 'text/plain',
        bytes: new TextEncoder().encode(
          `${name} contains the shared launchphrase.`,
        ),
      });
      await knowledge.add({
        principalId: 'owner_v1',
        requestKey: `knowledge-scope-${name}`,
        title: `${name} source`,
        scope,
        attachmentIds: [uploaded.attachment.id],
      });
    }

    assert.equal(
      (
        await knowledge.search({
          principalId: 'owner_v1',
          query: 'launchphrase',
        })
      ).citations.length,
      3,
    );
    assert.deepEqual(
      (
        await knowledge.search({
          principalId: 'owner_v1',
          query: 'launchphrase',
          scope: { kind: 'global' },
        })
      ).citations.map(({ sourceTitle }) => sourceTitle),
      ['global source'],
    );
    assert.deepEqual(
      new Set(
        (
          await knowledge.search({
            principalId: 'owner_v1',
            query: 'launchphrase',
            scope: { kind: 'project', projectId: 'project_alpha' },
          })
        ).citations.map(({ sourceTitle }) => sourceTitle),
      ),
      new Set(['global source', 'alpha source']),
    );
  });
});
