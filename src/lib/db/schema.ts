import { sql } from 'drizzle-orm';
import { text, integer, sqliteTable } from 'drizzle-orm/sqlite-core';
import { Block } from '../types';
import { SearchSources } from '../agents/search/types';

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey(),
  messageId: text('messageId').notNull(),
  chatId: text('chatId').notNull(),
  backendId: text('backendId').notNull(),
  query: text('query').notNull(),
  createdAt: text('createdAt').notNull(),
  responseBlocks: text('responseBlocks', { mode: 'json' })
    .$type<Block[]>()
    .default(sql`'[]'`),
  status: text({ enum: ['answering', 'completed', 'error'] }).default(
    'answering',
  ),
});

interface DBFile {
  name: string;
  fileId: string;
}

export const chats = sqliteTable('chats', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: text('createdAt').notNull(),
  sources: text('sources', {
    mode: 'json',
  })
    .$type<SearchSources[]>()
    .default(sql`'[]'`),
  files: text('files', { mode: 'json' })
    .$type<DBFile[]>()
    .default(sql`'[]'`),
  userId: text('userId'),
  shared: integer('shared', { mode: 'boolean' }).notNull().default(false),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('passwordHash').notNull(),
  role: text('role', { enum: ['admin', 'user'] })
    .notNull()
    .default('user'),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  mustChangePassword: integer('mustChangePassword', { mode: 'boolean' })
    .notNull()
    .default(false),
  totpSecret: text('totpSecret'),
  totpEnabled: integer('totpEnabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  recoveryCodes: text('recoveryCodes', { mode: 'json' }).$type<string[]>(),
  preferences: text('preferences', { mode: 'json' }).$type<{
    chatModelKey?: string;
    chatModelProviderId?: string;
    embeddingModelKey?: string;
    embeddingModelProviderId?: string;
    systemInstructions?: string;
  }>(),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
});

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  tokenHash: text('tokenHash').notNull().unique(),
  role: text('role', { enum: ['admin', 'user'] })
    .notNull()
    .default('user'),
  createdBy: text('createdBy').notNull(),
  expiresAt: text('expiresAt').notNull(),
  usedAt: text('usedAt'),
  usedBy: text('usedBy'),
  createdAt: text('createdAt').notNull(),
});

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  tokenHash: text('tokenHash').notNull().unique(),
  expiresAt: text('expiresAt').notNull(),
  revokedAt: text('revokedAt'),
  replacedBy: text('replacedBy'),
  createdAt: text('createdAt').notNull(),
});
