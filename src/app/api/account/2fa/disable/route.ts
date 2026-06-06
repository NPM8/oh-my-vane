import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/getAuthUser';
import { getUserById } from '@/lib/auth/users';
import { verifyPassword } from '@/lib/auth/password';
import { verifyUserSecondFactor, disableTwoFactor } from '@/lib/auth/twoFactor';

export const runtime = 'nodejs';

const schema = z.object({
  password: z.string().min(1),
  code: z.string().min(1).max(32),
});

export const POST = async (req: NextRequest) => {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'Password and code required.' }, { status: 400 });
    }

    const user = await getUserById(auth.id);
    if (!user) return Response.json({ message: 'Unauthorized' }, { status: 401 });

    const passwordOk = await verifyPassword(user.passwordHash, parsed.data.password);
    const codeOk = await verifyUserSecondFactor(auth.id, parsed.data.code.trim());
    if (!passwordOk || !codeOk) {
      return Response.json({ message: 'Invalid password or code.' }, { status: 401 });
    }

    await disableTwoFactor(auth.id);
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Error disabling 2FA: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
