import { describe, it, expect } from 'vitest';
import { issueSession } from '../session';
import { verifyJwt } from '../jwt';
import { hashToken } from '../tokens';

const secret = new TextEncoder().encode('a-test-secret-that-is-32-bytes-min!!');

describe('issueSession', () => {
  it('issues an access JWT carrying the user claims', async () => {
    const s = await issueSession({
      user: { id: 'u1', role: 'admin', username: 'alice' },
      secret,
      accessTtlMin: 120,
      refreshTtlDays: 30,
      now: 1_000_000_000_000,
      refreshId: 'refresh-row-1',
    });
    const claims = await verifyJwt(s.accessToken, secret, 'access');
    expect(claims.sub).toBe('u1');
    expect(claims.role).toBe('admin');
    expect(claims.username).toBe('alice');
  });

  it('computes cookie max-ages from the TTLs', async () => {
    const s = await issueSession({
      user: { id: 'u1', role: 'user', username: 'bob' },
      secret,
      accessTtlMin: 120,
      refreshTtlDays: 30,
      now: 0,
      refreshId: 'r',
    });
    expect(s.accessMaxAgeSec).toBe(120 * 60);
    expect(s.refreshMaxAgeSec).toBe(30 * 24 * 60 * 60);
  });

  it('builds a refresh record whose hash matches the opaque token', async () => {
    const now = 1_700_000_000_000;
    const s = await issueSession({
      user: { id: 'u1', role: 'user', username: 'bob' },
      secret,
      accessTtlMin: 120,
      refreshTtlDays: 30,
      now,
      refreshId: 'refresh-row-9',
    });
    expect(s.refreshRecord.id).toBe('refresh-row-9');
    expect(s.refreshRecord.tokenHash).toBe(hashToken(s.refreshToken));
    expect(new Date(s.refreshRecord.expiresAt).getTime()).toBe(
      now + 30 * 24 * 60 * 60 * 1000,
    );
  });
});
