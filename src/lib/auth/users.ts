import { randomUUID } from 'node:crypto';
import { eq, isNull } from 'drizzle-orm';
import db from '@/lib/db';
import { users, chats } from '@/lib/db/schema';
import { hashPassword } from './password';

export type Role = 'admin' | 'user';

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
}

export const countUsers = async (): Promise<number> => {
  const rows = await db.select({ id: users.id }).from(users);
  return rows.length;
};

export const getUserByUsername = async (username: string) =>
  db.query.users.findFirst({ where: eq(users.username, username) });

export const getUserById = async (id: string) =>
  db.query.users.findFirst({ where: eq(users.id, id) });

export const createUser = async (input: {
  username: string;
  password: string;
  role: Role;
}): Promise<PublicUser> => {
  const id = randomUUID();
  const nowIso = new Date().toISOString();
  const passwordHash = await hashPassword(input.password);
  await db.insert(users).values({
    id,
    username: input.username,
    passwordHash,
    role: input.role,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  return {
    id,
    username: input.username,
    role: input.role,
    disabled: false,
    totpEnabled: false,
    mustChangePassword: false,
  };
};

export const claimOrphanChats = async (userId: string): Promise<number> => {
  const result = await db
    .update(chats)
    .set({ userId })
    .where(isNull(chats.userId));
  return (result as unknown as { changes?: number }).changes ?? 0;
};
