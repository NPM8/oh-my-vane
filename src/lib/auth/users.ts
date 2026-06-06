import { randomUUID } from 'node:crypto';
import { eq, isNull } from 'drizzle-orm';
import db from '@/lib/db';
import { users, chats } from '@/lib/db/schema';
import { hashPassword, verifyPassword } from './password';

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

export const listUsers = async (): Promise<PublicUser[]> => {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      disabled: users.disabled,
      totpEnabled: users.totpEnabled,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .orderBy(users.username);
  return rows as PublicUser[];
};

export const setUserDisabled = async (
  id: string,
  disabled: boolean,
): Promise<void> => {
  await db
    .update(users)
    .set({ disabled, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id));
};

export const deleteUser = async (id: string): Promise<void> => {
  await db.delete(users).where(eq(users.id, id));
};

export const adminSetPassword = async (
  id: string,
  newPassword: string,
): Promise<void> => {
  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: true, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id));
};

export const changeOwnPassword = async (
  id: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> => {
  const u = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!u) return false;
  if (!(await verifyPassword(u.passwordHash, currentPassword))) return false;
  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id));
  return true;
};
