import fs from 'node:fs';
import path from 'node:path';
import configManager from '@/lib/config';
import { resolveJwtSecret } from './secret';

export interface AuthConfig {
  secret: Uint8Array;
  accessTtlMin: number;
  refreshTtlDays: number;
  requireTwoFactor: boolean;
}

const configFilePath = (): string =>
  path.join(process.env.DATA_DIR || process.cwd(), 'data/config.json');

// Read the persisted secret straight from disk. Route handlers and middleware
// load as SEPARATE module instances in Next.js, each with its own
// `configManager` singleton whose in-memory config is snapshotted at
// construction. Reading the file fresh guarantees every context observes the
// same secret instead of a stale per-context copy.
const readStoredSecret = (): string | undefined => {
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf-8');
    return JSON.parse(raw)?.auth?.jwtSecret || undefined;
  } catch {
    return undefined;
  }
};

// Generate + persist a JWT secret if none exists. Call this at startup
// (instrumentation) where configManager's in-memory config is freshly loaded,
// so the whole-config rewrite inside updateConfig cannot clobber other state.
// Idempotent: a no-op when an env or already-persisted secret is present.
export const ensureJwtSecret = (): void => {
  if (process.env.JWT_SECRET) return;
  if (readStoredSecret()) return;
  const { generated } = resolveJwtSecret({});
  configManager.updateConfig('auth.jwtSecret', generated);
};

export const getAuthConfig = (): AuthConfig => {
  // Self-heal if startup generation didn't run for some reason. Idempotent.
  ensureJwtSecret();

  const { secret } = resolveJwtSecret({
    envSecret: process.env.JWT_SECRET,
    storedSecret: readStoredSecret(),
  });

  return {
    secret,
    accessTtlMin: Number(configManager.getConfig('auth.accessTtlMin', 120)),
    refreshTtlDays: Number(configManager.getConfig('auth.refreshTtlDays', 30)),
    requireTwoFactor: Boolean(
      configManager.getConfig('auth.requireTwoFactor', false),
    ),
  };
};
