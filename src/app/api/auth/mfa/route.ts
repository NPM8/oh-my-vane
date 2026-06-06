import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyJwt } from '@/lib/auth/jwt';
import { getAuthConfig } from '@/lib/auth/authConfig';
import { getUserById } from '@/lib/auth/users';
import { verifyUserSecondFactor } from '@/lib/auth/twoFactor';
import { issueSessionOnResponse } from '@/lib/auth/sessionCookies';
import { isSecureRequest } from '@/lib/auth/cookies';
import { createRateLimiter } from '@/lib/auth/rateLimit';

export const runtime = 'nodejs';

// A 6-digit TOTP is brute-forceable without throttling. Limit attempts per user.
const mfaLimiter = createRateLimiter({ limit: 5, windowMs: 5 * 60 * 1000 });

const schema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().min(1).max(32),
});

export const POST = async (req: NextRequest) => {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'Invalid request.' }, { status: 400 });
    }

    let userId: string;
    try {
      const claims = await verifyJwt(parsed.data.mfaToken, getAuthConfig().secret, 'mfa');
      userId = claims.sub;
    } catch {
      return Response.json({ message: 'MFA session expired. Sign in again.' }, { status: 401 });
    }

    const limit = mfaLimiter.check(userId);
    if (!limit.allowed) {
      return Response.json({ message: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    const user = await getUserById(userId);
    if (!user || user.disabled || !user.totpEnabled) {
      return Response.json({ message: 'Invalid credentials.' }, { status: 401 });
    }

    const ok = await verifyUserSecondFactor(userId, parsed.data.code.trim());
    if (!ok) {
      return Response.json({ message: 'Invalid code.' }, { status: 401 });
    }
    mfaLimiter.reset(userId);

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
    await issueSessionOnResponse({
      res,
      user: { id: user.id, role: user.role, username: user.username },
      isSecure: isSecureRequest(req.headers.get('x-forwarded-proto')),
    });
    return res;
  } catch (err) {
    console.error('Error in MFA verify: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
