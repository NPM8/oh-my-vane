import { randomBytes } from 'node:crypto';

const MIN_SECRET_BYTES = 32;

export interface ResolvedSecret {
  secret: Uint8Array;
  generated?: string;
}

export const resolveJwtSecret = (opts: {
  envSecret?: string;
  storedSecret?: string;
}): ResolvedSecret => {
  const existing = opts.envSecret || opts.storedSecret;
  if (existing) {
    if (Buffer.byteLength(existing, 'utf8') < MIN_SECRET_BYTES) {
      throw new Error('JWT secret must be at least 32 bytes');
    }
    return { secret: new TextEncoder().encode(existing) };
  }
  const generated = randomBytes(48).toString('base64url');
  return { secret: new TextEncoder().encode(generated), generated };
};
