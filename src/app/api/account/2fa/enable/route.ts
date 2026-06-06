import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/getAuthUser';
import { confirmEnrollment } from '@/lib/auth/twoFactor';
import { createRateLimiter } from '@/lib/auth/rateLimit';

export const runtime = 'nodejs';

const schema = z.object({ code: z.string().min(1).max(32) });

const enableLimiter = createRateLimiter({ limit: 10, windowMs: 5 * 60 * 1000 });

export const POST = async (req: NextRequest) => {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    if (!enableLimiter.check(auth.id).allowed) {
      return Response.json({ message: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'Code required.' }, { status: 400 });
    }

    const result = await confirmEnrollment(auth.id, parsed.data.code.trim());
    if (!result.ok) {
      return Response.json({ message: 'Invalid code. Try again.' }, { status: 400 });
    }
    return Response.json({ recoveryCodes: result.recoveryCodes }, { status: 200 });
  } catch (err) {
    console.error('Error enabling 2FA: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
