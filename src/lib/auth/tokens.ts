import { randomBytes, createHash } from 'node:crypto';

// 32 bytes of CSPRNG entropy, base64url-encoded without padding.
export const generateToken = (): string =>
  randomBytes(32).toString('base64url');

// SHA-256 hex digest. Tokens are high-entropy, so a fast hash is appropriate
// (unlike passwords) and enables constant-time DB lookup by hash.
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
