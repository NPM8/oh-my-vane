import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from '../jwt';

const secret = new TextEncoder().encode('test-secret-at-least-32-bytes-long!!');

describe('jwt', () => {
  it('signs and verifies an access token round-trip', async () => {
    const token = await signJwt(
      { sub: 'user-1', role: 'admin', username: 'alice', type: 'access' },
      secret,
      '2h',
    );
    const payload = await verifyJwt(token, secret, 'access');
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('admin');
    expect(payload.username).toBe('alice');
  });

  it('rejects a token signed with a different secret', async () => {
    const other = new TextEncoder().encode('a-totally-different-secret-value!!');
    const token = await signJwt({ sub: 'u', type: 'access' }, secret, '2h');
    await expect(verifyJwt(token, other, 'access')).rejects.toThrow();
  });

  it('rejects when the token type does not match', async () => {
    const token = await signJwt({ sub: 'u', type: 'mfa' }, secret, '5m');
    await expect(verifyJwt(token, secret, 'access')).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signJwt({ sub: 'u', type: 'access' }, secret, '0s');
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verifyJwt(token, secret, 'access')).rejects.toThrow();
  });
});
