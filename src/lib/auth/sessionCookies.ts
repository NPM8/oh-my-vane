import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { issueSession } from './session';
import { saveRefresh } from './refreshStore';
import { getAuthConfig } from './authConfig';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  buildCookieOptions,
} from './cookies';

// Issue a session for `user`, persist its refresh row, and set both auth
// cookies on `res`. Shared so cookie attributes and rotation stay identical.
export const issueSessionOnResponse = async (params: {
  res: NextResponse;
  user: { id: string; role: string; username: string };
  isSecure: boolean;
  forceSecure?: boolean;
}): Promise<void> => {
  const cfg = getAuthConfig();
  const session = await issueSession({
    user: params.user,
    secret: cfg.secret,
    accessTtlMin: cfg.accessTtlMin,
    refreshTtlDays: cfg.refreshTtlDays,
    now: Date.now(),
    refreshId: randomUUID(),
  });
  await saveRefresh({
    id: session.refreshRecord.id,
    userId: params.user.id,
    tokenHash: session.refreshRecord.tokenHash,
    expiresAt: session.refreshRecord.expiresAt,
  });

  const forceSecure =
    params.forceSecure ?? process.env.FORCE_SECURE_COOKIES === 'true';
  params.res.cookies.set(
    ACCESS_COOKIE,
    session.accessToken,
    buildCookieOptions({
      maxAgeSeconds: session.accessMaxAgeSec,
      isSecureRequest: params.isSecure,
      forceSecure,
    }),
  );
  params.res.cookies.set(
    REFRESH_COOKIE,
    session.refreshToken,
    buildCookieOptions({
      maxAgeSeconds: session.refreshMaxAgeSec,
      isSecureRequest: params.isSecure,
      forceSecure,
    }),
  );
};
