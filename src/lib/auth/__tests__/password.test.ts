import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../password';

describe('password hashing', () => {
  it('produces an argon2id hash that verifies against the original', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(
      true,
    );
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'wrong password')).toBe(false);
  });

  it('produces different hashes for the same input (random salt)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });

  it('returns false instead of throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});
