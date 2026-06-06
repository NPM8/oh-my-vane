import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByUsername } from '@/lib/auth/users';
import { verifyPassword } from '@/lib/auth/password';
import { issueSession } from '@/lib/auth/session';
import { getAuthConfig } from '@/lib/auth/authConfig';
import { signJwt } from '@/lib/auth/jwt';
import { saveRefresh } from '@/lib/auth/refreshStore';
import { createRateLimiter } from '@/lib/auth/rateLimit';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  buildCookieOptions,
  isSecureRequest,
} from '@/lib/auth/cookies';

export const runtime = 'nodejs';

// Module-scoped so the window persists across requests in a process.
const loginLimiter = createRateLimiter({ limit: 10, windowMs: 5 * 60 * 1000 });

const bodySchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

export const POST = async (req: NextRequest) => {
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ message: 'Invalid credentials.' }, { status: 401 });
    }
    const { username, password } = parsed.data;

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const limit = loginLimiter.check(`${ip}:${username}`);
    if (!limit.allowed) {
      return Response.json(
        { message: 'Too many attempts. Try again later.' },
        { status: 429 },
      );
    }

    const user = await getUserByUsername(username);
    const ok = user && !user.disabled && (await verifyPassword(user.passwordHash, password));
    if (!user || !ok) {
      return Response.json({ message: 'Invalid credentials.' }, { status: 401 });
    }
    loginLimiter.reset(`${ip}:${username}`);

    if (user.totpEnabled) {
      const cfg = getAuthConfig();
      const mfaToken = await signJwt(
        { sub: user.id, type: 'mfa' },
        cfg.secret,
        '300s',
      );
      return Response.json({ mfaRequired: true, mfaToken }, { status: 200 });
    }

    const cfg = getAuthConfig();
    const session = await issueSession({
      user: { id: user.id, role: user.role, username: user.username },
      secret: cfg.secret,
      accessTtlMin: cfg.accessTtlMin,
      refreshTtlDays: cfg.refreshTtlDays,
      now: Date.now(),
      refreshId: randomUUID(),
    });
    await saveRefresh({
      id: session.refreshRecord.id,
      userId: user.id,
      tokenHash: session.refreshRecord.tokenHash,
      expiresAt: session.refreshRecord.expiresAt,
    });

    const secure = isSecureRequest(req.headers.get('x-forwarded-proto'));
    const forceSecure = process.env.FORCE_SECURE_COOKIES === 'true';
    const res = NextResponse.json(
      {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
        },
      },
      { status: 200 },
    );
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
    console.error('Error in login: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
