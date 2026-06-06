import { eq } from 'drizzle-orm';
import db from '@/lib/db';
import { users } from '@/lib/db/schema';
import { generateTotpSecret, buildOtpAuthUri, verifyTotp } from './totp';
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCode,
} from './recoveryCodes';

const ISSUER = 'Vane';
const nowIso = () => new Date().toISOString();

export const startEnrollment = async (
  userId: string,
  username: string,
): Promise<{ secret: string; otpauthUri: string }> => {
  const secret = generateTotpSecret();
  await db
    .update(users)
    .set({ totpSecret: secret, totpEnabled: false, recoveryCodes: null, updatedAt: nowIso() })
    .where(eq(users.id, userId));
  return { secret, otpauthUri: buildOtpAuthUri(secret, username, ISSUER) };
};

export const confirmEnrollment = async (
  userId: string,
  code: string,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false }> => {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u?.totpSecret) return { ok: false };
  if (!verifyTotp(code, u.totpSecret)) return { ok: false };

  const codes = await generateRecoveryCodes();
  const hashes = await hashRecoveryCodes(codes);
  await db
    .update(users)
    .set({ totpEnabled: true, recoveryCodes: hashes, updatedAt: nowIso() })
    .where(eq(users.id, userId));
  return { ok: true, recoveryCodes: codes };
};

export const verifyUserSecondFactor = async (
  userId: string,
  code: string,
): Promise<boolean> => {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u?.totpEnabled || !u.totpSecret) return false;
  if (verifyTotp(code, u.totpSecret)) return true;

  const hashes = u.recoveryCodes ?? [];
  const result = await consumeRecoveryCode(code, hashes);
  if (!result.ok) return false;
  await db
    .update(users)
    .set({ recoveryCodes: result.remaining, updatedAt: nowIso() })
    .where(eq(users.id, userId));
  return true;
};

export const remainingRecoveryCodes = async (userId: string): Promise<number> => {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return (u?.recoveryCodes ?? []).length;
};

export const disableTwoFactor = async (userId: string): Promise<void> => {
  await db
    .update(users)
    .set({ totpEnabled: false, totpSecret: null, recoveryCodes: null, updatedAt: nowIso() })
    .where(eq(users.id, userId));
};
