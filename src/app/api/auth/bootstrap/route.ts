import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { countUsers, createUser, claimOrphanChats } from '@/lib/auth/users';
import { issueSession } from '@/lib/auth/session';
import { getAuthConfig } from '@/lib/auth/authConfig';
import { saveRefresh } from '@/lib/auth/refreshStore';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  buildCookieOptions,
  isSecureRequest,
} from '@/lib/auth/cookies';

export const runtime = 'nodejs';

const bodySchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(10).max(200),
});

export const POST = async (req: NextRequest) => {
  try {
    if ((await countUsers()) > 0) {
      return Response.json(
        { message: 'Admin already exists.' },
        { status: 409 },
      );
    }

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json(
        { message: 'Username (3-64) and password (10-200) required.' },
        { status: 400 },
      );
    }

    const user = await createUser({
      username: parsed.data.username,
      password: parsed.data.password,
      role: 'admin',
    });
    await claimOrphanChats(user.id);

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
    const res = NextResponse.json({ user }, { status: 201 });
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
    console.error('Error in bootstrap: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
