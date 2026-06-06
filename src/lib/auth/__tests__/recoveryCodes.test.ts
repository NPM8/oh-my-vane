import { describe, it, expect } from 'vitest';
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCode,
} from '../recoveryCodes';

describe('recovery codes', () => {
  it('generates 10 distinct formatted codes', async () => {
    const codes = await generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    codes.forEach((c) => expect(c).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/));
  });

  it('hashes each plaintext code', async () => {
    const hashes = await hashRecoveryCodes(['aaaa-bbbb', 'cccc-dddd']);
    expect(hashes).toHaveLength(2);
    hashes.forEach((h) => expect(h).toMatch(/^\$argon2id\$/));
  });

  it('consumes a valid code and returns remaining hashes', async () => {
    const codes = ['aaaa-bbbb', 'cccc-dddd'];
    const hashes = await hashRecoveryCodes(codes);
    const result = await consumeRecoveryCode('aaaa-bbbb', hashes);
    expect(result.ok).toBe(true);
    expect(result.remaining).toHaveLength(1);
    // the remaining hash must NOT match the consumed code
    const reuse = await consumeRecoveryCode('aaaa-bbbb', result.remaining);
    expect(reuse.ok).toBe(false);
  });

  it('rejects an unknown code without altering the set', async () => {
    const hashes = await hashRecoveryCodes(['aaaa-bbbb']);
    const result = await consumeRecoveryCode('zzzz-zzzz', hashes);
    expect(result.ok).toBe(false);
    expect(result.remaining).toHaveLength(1);
  });
});
