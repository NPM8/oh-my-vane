import { eq, and, isNull } from 'drizzle-orm';
import db from '@/lib/db';
import { refreshTokens } from '@/lib/db/schema';
import { hashToken } from './tokens';

export const saveRefresh = async (row: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
}) => {
  await db.insert(refreshTokens).values({
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    createdAt: new Date().toISOString(),
  });
};

export const findRefreshByToken = async (rawToken: string) =>
  db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, hashToken(rawToken)),
  });

// Slide a still-valid refresh row's expiry forward WITHOUT rotating it. Used by
// the silent-refresh path so active use keeps a session alive indefinitely
// instead of hard-capping at refreshTtlDays from the original login. Guarded on
// `revokedAt IS NULL` so it can never resurrect a revoked/reused token. Safe
// under concurrency: several requests each set expiresAt to ~the same value
// (last write wins); it never touches the token hash or revokedAt, so it does
// not trip reuse-detection the way rotation would.
export const touchRefreshExpiry = async (id: string, expiresAt: string) => {
  await db
    .update(refreshTokens)
    .set({ expiresAt })
    .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)));
};

export const revokeRefresh = async (id: string, replacedBy?: string) => {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date().toISOString(), replacedBy: replacedBy ?? null })
    .where(eq(refreshTokens.id, id));
};

export const revokeAllForUser = async (userId: string) => {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
};
