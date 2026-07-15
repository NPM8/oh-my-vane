import { describe, it, expect, vi, beforeEach } from 'vitest';

const findRefreshByToken = vi.fn();
const touchRefreshExpiry = vi.fn();
const getUserById = vi.fn();

vi.mock('../refreshStore', () => ({
  findRefreshByToken: (...a: unknown[]) => findRefreshByToken(...a),
  touchRefreshExpiry: (...a: unknown[]) => touchRefreshExpiry(...a),
}));
vi.mock('../users', () => ({
  getUserById: (...a: unknown[]) => getUserById(...a),
}));
vi.mock('../authConfig', () => ({
  getAuthConfig: () => ({
    secret: new TextEncoder().encode('test-secret-at-least-32-bytes-long!!'),
    accessTtlMin: 120,
    refreshTtlDays: 30,
    requireTwoFactor: false,
  }),
}));

import { silentRefresh } from '../silentRefresh';
import { verifyJwt } from '../jwt';

const secret = new TextEncoder().encode('test-secret-at-least-32-bytes-long!!');
const NOW = 1_000_000_000_000;
const future = new Date(NOW + 1_000_000).toISOString();
const past = new Date(NOW - 1_000).toISOString();

describe('silentRefresh', () => {
  beforeEach(() => {
    findRefreshByToken.mockReset();
    touchRefreshExpiry.mockReset();
    getUserById.mockReset();
  });

  it('returns null when no refresh cookie is present', async () => {
    expect(await silentRefresh(undefined, NOW)).toBeNull();
    expect(findRefreshByToken).not.toHaveBeenCalled();
  });

  it('returns null when the refresh row does not exist', async () => {
    findRefreshByToken.mockResolvedValue(undefined);
    expect(await silentRefresh('raw', NOW)).toBeNull();
  });

  it('returns null for a revoked refresh token (does not mint)', async () => {
    findRefreshByToken.mockResolvedValue({
      userId: 'u1',
      revokedAt: past,
      expiresAt: future,
    });
    expect(await silentRefresh('raw', NOW)).toBeNull();
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('returns null for an expired refresh token', async () => {
    findRefreshByToken.mockResolvedValue({
      userId: 'u1',
      revokedAt: null,
      expiresAt: past,
    });
    expect(await silentRefresh('raw', NOW)).toBeNull();
  });

  it('returns null when the user is missing or disabled', async () => {
    findRefreshByToken.mockResolvedValue({
      userId: 'u1',
      revokedAt: null,
      expiresAt: future,
    });
    getUserById.mockResolvedValueOnce(undefined);
    expect(await silentRefresh('raw', NOW)).toBeNull();

    getUserById.mockResolvedValueOnce({
      id: 'u1',
      username: 'alice',
      role: 'user',
      disabled: true,
    });
    expect(await silentRefresh('raw', NOW)).toBeNull();
  });

  it('mints a verifiable access token for a valid refresh + active user', async () => {
    findRefreshByToken.mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      revokedAt: null,
      expiresAt: future,
    });
    getUserById.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      role: 'admin',
      disabled: false,
    });

    const result = await silentRefresh('raw', NOW);
    expect(result).not.toBeNull();
    expect(result!.accessMaxAgeSec).toBe(120 * 60);
    expect(result!.refreshMaxAgeSec).toBe(30 * 24 * 60 * 60);
    // Same (unrotated) token value is returned so the caller can slide the cookie.
    expect(result!.refreshToken).toBe('raw');
    expect(result!.user).toEqual({ id: 'u1', role: 'admin', username: 'alice' });

    const claims = await verifyJwt(result!.accessToken, secret, 'access');
    expect(claims.sub).toBe('u1');
    expect(claims.role).toBe('admin');
    expect(claims.username).toBe('alice');
  });

  it('slides the refresh expiry forward WITHOUT rotating the token', async () => {
    findRefreshByToken.mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      revokedAt: null,
      expiresAt: future,
    });
    getUserById.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      role: 'user',
      disabled: false,
    });
    await silentRefresh('raw', NOW);
    // Sliding = one UPDATE of expiresAt on the same row; no revoke/save (rotation).
    expect(findRefreshByToken).toHaveBeenCalledTimes(1);
    expect(touchRefreshExpiry).toHaveBeenCalledTimes(1);
    const expectedExpiry = new Date(
      NOW + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(touchRefreshExpiry).toHaveBeenCalledWith('r1', expectedExpiry);
  });

  it('does not slide expiry for an invalid/revoked/expired refresh', async () => {
    findRefreshByToken.mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      revokedAt: past,
      expiresAt: future,
    });
    expect(await silentRefresh('raw', NOW)).toBeNull();
    expect(touchRefreshExpiry).not.toHaveBeenCalled();
  });
});
