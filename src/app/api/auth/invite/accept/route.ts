import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import { consumeInvite } from '@/lib/auth/invites';
import { createUser, getUserByUsername } from '@/lib/auth/users';
import { issueSessionOnResponse } from '@/lib/auth/sessionCookies';
import { isSecureRequest } from '@/lib/auth/cookies';
import { createRateLimiter } from '@/lib/auth/rateLimit';

export const runtime = 'nodejs';

const acceptLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

const schema = z.object({
  token: z.string().min(1),
  username: z.string().min(3).max(64),
  password: z.string().min(10).max(200),
});

export const POST = async (req: NextRequest) => {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!acceptLimiter.check(ip).allowed) {
      return Response.json({ message: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json(
        { message: 'Username (3-64) and password (10-200) required.' },
        { status: 400 },
      );
    }
    const { token, username, password } = parsed.data;

    // Reject duplicate username before consuming the invite.
    if (await getUserByUsername(username)) {
      return Response.json({ message: 'Username already taken.' }, { status: 409 });
    }

    // Atomic single-use claim. If this fails the invite is used/expired/unknown.
    const claim = await consumeInvite(token, username);
    if (!claim.ok) {
      return Response.json(
        { message: 'This invitation is invalid or has already been used.' },
        { status: 400 },
      );
    }

    const user = await createUser({ username, password, role: claim.role });

    const res = NextResponse.json({ user }, { status: 201 });
    await issueSessionOnResponse({
      res,
      user: { id: user.id, role: user.role, username: user.username },
      isSecure: isSecureRequest(req.headers.get('x-forwarded-proto')),
    });
    return res;
  } catch (err) {
    console.error('Error accepting invite: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
