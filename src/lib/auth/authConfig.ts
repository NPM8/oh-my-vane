import configManager from '@/lib/config';
import { resolveJwtSecret } from './secret';

export interface AuthConfig {
  secret: Uint8Array;
  accessTtlMin: number;
  refreshTtlDays: number;
  requireTwoFactor: boolean;
}

let cached: AuthConfig | null = null;

export const getAuthConfig = (): AuthConfig => {
  if (cached) return cached;

  const stored = configManager.getConfig('auth.jwtSecret') as
    | string
    | undefined;
  const { secret, generated } = resolveJwtSecret({
    envSecret: process.env.JWT_SECRET,
    storedSecret: stored,
  });
  if (generated) {
    configManager.updateConfig('auth.jwtSecret', generated);
  }

  cached = {
    secret,
    accessTtlMin: Number(configManager.getConfig('auth.accessTtlMin', 120)),
    refreshTtlDays: Number(configManager.getConfig('auth.refreshTtlDays', 30)),
    requireTwoFactor: Boolean(
      configManager.getConfig('auth.requireTwoFactor', false),
    ),
  };
  return cached;
};

export const resetAuthConfigCache = () => {
  cached = null;
};
