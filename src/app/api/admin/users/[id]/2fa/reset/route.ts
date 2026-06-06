import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { getUserById } from '@/lib/auth/users';
import { disableTwoFactor } from '@/lib/auth/twoFactor';

export const runtime = 'nodejs';

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const { id } = await params;
    const target = await getUserById(id);
    if (!target) {
      return Response.json({ message: 'User not found.' }, { status: 404 });
    }

    await disableTwoFactor(id);
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Error resetting 2FA: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
