import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/getAuthUser';
import { getUserById, changeOwnPassword } from '@/lib/auth/users';
import { revokeAllForUser } from '@/lib/auth/refreshStore';
import { issueSessionOnResponse } from '@/lib/auth/sessionCookies';
import { isSecureRequest } from '@/lib/auth/cookies';

export const runtime = 'nodejs';

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(200),
});

export const POST = async (req: NextRequest) => {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json(
        { message: 'Current password and a new password (min 10) are required.' },
        { status: 400 },
      );
    }

    const ok = await changeOwnPassword(
      auth.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    if (!ok) {
      return Response.json({ message: 'Current password is incorrect.' }, { status: 401 });
    }

    await revokeAllForUser(auth.id);
    const user = await getUserById(auth.id);

    const res = NextResponse.json({ ok: true }, { status: 200 });
    if (user) {
      await issueSessionOnResponse({
        res,
        user: { id: user.id, role: user.role, username: user.username },
        isSecure: isSecureRequest(req.headers.get('x-forwarded-proto')),
      });
    }
    return res;
  } catch (err) {
    console.error('Error changing password: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
