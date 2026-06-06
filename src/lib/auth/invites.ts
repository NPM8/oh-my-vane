import { randomUUID } from 'node:crypto';
import { eq, and, isNull, sql } from 'drizzle-orm';
import db from '@/lib/db';
import { invites } from '@/lib/db/schema';
import { generateToken, hashToken } from './tokens';
import type { Role } from './users';

export interface InviteRow {
  id: string;
  role: Role;
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  createdAt: string;
}

export const createInvite = async (input: {
  role: Role;
  ttlHours: number;
  createdBy: string;
}): Promise<{ rawToken: string; invite: InviteRow }> => {
  const rawToken = generateToken();
  const id = randomUUID();
  const nowMs = Date.now();
  const expiresAt = new Date(nowMs + input.ttlHours * 3600 * 1000).toISOString();
  const createdAt = new Date(nowMs).toISOString();
  await db.insert(invites).values({
    id,
    tokenHash: hashToken(rawToken),
    role: input.role,
    createdBy: input.createdBy,
    expiresAt,
    createdAt,
  });
  return {
    rawToken,
    invite: { id, role: input.role, createdBy: input.createdBy, expiresAt, usedAt: null, usedBy: null, createdAt },
  };
};

const findByToken = (rawToken: string) =>
  db.query.invites.findFirst({ where: eq(invites.tokenHash, hashToken(rawToken)) });

export type ValidateResult =
  | { valid: true; role: Role }
  | { valid: false; reason: 'unknown' | 'used' | 'expired' };

export const validateInvite = async (rawToken: string): Promise<ValidateResult> => {
  const row = await findByToken(rawToken);
  if (!row) return { valid: false, reason: 'unknown' };
  if (row.usedAt) return { valid: false, reason: 'used' };
  if (new Date(row.expiresAt).getTime() <= Date.now()) return { valid: false, reason: 'expired' };
  return { valid: true, role: row.role as Role };
};

// Atomic single-use claim: only succeeds if still unused AND unexpired.
export const consumeInvite = async (
  rawToken: string,
  usedBy: string,
): Promise<{ ok: true; role: Role } | { ok: false }> => {
  const row = await findByToken(rawToken);
  if (!row) return { ok: false };
  if (new Date(row.expiresAt).getTime() <= Date.now()) return { ok: false };
  const result = await db
    .update(invites)
    .set({ usedAt: new Date().toISOString(), usedBy })
    .where(and(eq(invites.id, row.id), isNull(invites.usedAt)));
  const changes = (result as unknown as { changes?: number }).changes ?? 0;
  if (changes !== 1) return { ok: false };
  return { ok: true, role: row.role as Role };
};

export const listInvites = async (): Promise<InviteRow[]> => {
  const rows = await db
    .select({
      id: invites.id, role: invites.role, createdBy: invites.createdBy,
      expiresAt: invites.expiresAt, usedAt: invites.usedAt, usedBy: invites.usedBy, createdAt: invites.createdAt,
    })
    .from(invites)
    .orderBy(sql`${invites.createdAt} DESC`);
  return rows as InviteRow[];
};

// Revoke an unused invite by marking it used. No-op if already used.
export const revokeInvite = async (id: string): Promise<void> => {
  await db
    .update(invites)
    .set({ usedAt: new Date().toISOString(), usedBy: 'revoked' })
    .where(and(eq(invites.id, id), isNull(invites.usedAt)));
};

export const validateInviteById = (id: string) =>
  db.query.invites.findFirst({ where: eq(invites.id, id) });
