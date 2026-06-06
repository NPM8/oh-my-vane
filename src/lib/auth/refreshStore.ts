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
