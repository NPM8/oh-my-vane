import { describe, it, expect } from 'vitest';
import { generateToken, hashToken } from '../tokens';

describe('opaque tokens', () => {
  it('generates URL-safe tokens of high entropy', () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    expect(t.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });

  it('generates a unique token each call', () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it('hashes deterministically to 64 hex chars (sha256)', () => {
    const t = 'fixed-token-value';
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different tokens', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});
