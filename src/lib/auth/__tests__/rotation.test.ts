import { describe, it, expect } from 'vitest';
import { decideRefresh } from '../rotation';

const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();
const now = Date.now();

describe('decideRefresh', () => {
  it('returns invalid when the row is missing', () => {
    expect(decideRefresh(undefined, now).action).toBe('invalid');
  });

  it('detects reuse when the row is already revoked', () => {
    expect(
      decideRefresh({ revokedAt: past, expiresAt: future }, now).action,
    ).toBe('reuse_detected');
  });

  it('returns invalid when expired', () => {
    expect(
      decideRefresh({ revokedAt: null, expiresAt: past }, now).action,
    ).toBe('invalid');
  });

  it('rotates a valid, unrevoked, unexpired row', () => {
    expect(
      decideRefresh({ revokedAt: null, expiresAt: future }, now).action,
    ).toBe('rotate');
  });
});
