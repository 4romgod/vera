import { z } from 'zod';
import { AttachmentReferenceSchema } from '../attachments/attachment.ts';

export const ConversationMessageSchema = z
  .object({
    id: z.string().startsWith('message_'),
    requestKey: z.string().min(1),
    role: z.enum(['owner', 'vera']),
    content: z.string().trim().min(1).max(20_000),
    projectId: z.string().startsWith('project_').optional(),
    taskId: z.string().startsWith('task_').optional(),
    attachments: z.array(AttachmentReferenceSchema).max(5).optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const ConversationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('conversation_'),
    principalId: z.string().min(1),
    creationKey: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    status: z.enum(['active', 'removed']),
    messages: z.array(ConversationMessageSchema),
    removedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const ConversationDeletionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('conversation_'),
    status: z.literal('removed'),
    removedAt: z.iso.datetime(),
  })
  .strict();

export const ConversationSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('conversation_'),
    title: z.string().trim().min(1).max(200),
    status: z.literal('active'),
    messageCount: z.number().int().nonnegative(),
    lastMessage: ConversationMessageSchema.omit({
      requestKey: true,
    }).optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type Conversation = z.infer<typeof ConversationSchema>;
export type ConversationDeletion = z.infer<typeof ConversationDeletionSchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
