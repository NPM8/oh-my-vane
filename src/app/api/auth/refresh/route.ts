import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { decideRefresh } from '@/lib/auth/rotation';
import {
  findRefreshByToken,
  revokeRefresh,
  revokeAllForUser,
  saveRefresh,
} from '@/lib/auth/refreshStore';
import { getUserById } from '@/lib/auth/users';
import { issueSession } from '@/lib/auth/session';
import { getAuthConfig } from '@/lib/auth/authConfig';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  buildCookieOptions,
  isSecureRequest,
} from '@/lib/auth/cookies';

export const runtime = 'nodejs';

const clearAuthCookies = (res: NextResponse) => {
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
};

export const POST = async (req: NextRequest) => {
  try {
    const raw = req.cookies.get(REFRESH_COOKIE)?.value;
    if (!raw) {
      return Response.json({ message: 'No session.' }, { status: 401 });
    }

    const row = await findRefreshByToken(raw);
    const decision = decideRefresh(
      row ? { revokedAt: row.revokedAt, expiresAt: row.expiresAt } : undefined,
      Date.now(),
    );

    if (decision.action === 'reuse_detected') {
      if (row) await revokeAllForUser(row.userId);
      const res = NextResponse.json({ message: 'Session revoked.' }, { status: 401 });
      clearAuthCookies(res);
      return res;
    }
    if (decision.action === 'invalid' || !row) {
      const res = NextResponse.json({ message: 'Invalid session.' }, { status: 401 });
      clearAuthCookies(res);
      return res;
    }

    const user = await getUserById(row.userId);
    if (!user || user.disabled) {
      const res = NextResponse.json({ message: 'Invalid session.' }, { status: 401 });
      clearAuthCookies(res);
      return res;
    }

    const cfg = getAuthConfig();
    const newId = randomUUID();
    const session = await issueSession({
      user: { id: user.id, role: user.role, username: user.username },
      secret: cfg.secret,
      accessTtlMin: cfg.accessTtlMin,
      refreshTtlDays: cfg.refreshTtlDays,
      now: Date.now(),
      refreshId: newId,
    });
    await saveRefresh({
      id: newId,
      userId: user.id,
      tokenHash: session.refreshRecord.tokenHash,
      expiresAt: session.refreshRecord.expiresAt,
    });
    await revokeRefresh(row.id, newId); // rotate: old row revoked, points to new

    const secure = isSecureRequest(req.headers.get('x-forwarded-proto'));
    const forceSecure = process.env.FORCE_SECURE_COOKIES === 'true';
    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.cookies.set(
      ACCESS_COOKIE,
      session.accessToken,
      buildCookieOptions({ maxAgeSeconds: session.accessMaxAgeSec, isSecureRequest: secure, forceSecure }),
    );
    res.cookies.set(
      REFRESH_COOKIE,
      session.refreshToken,
      buildCookieOptions({ maxAgeSeconds: session.refreshMaxAgeSec, isSecureRequest: secure, forceSecure }),
    );
    return res;
  } catch (err) {
    console.error('Error in refresh: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
