import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { getUserById, adminSetPassword } from '@/lib/auth/users';
import { revokeAllForUser } from '@/lib/auth/refreshStore';

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

    const tempPassword = randomBytes(18).toString('base64url');
    await adminSetPassword(id, tempPassword);
    await revokeAllForUser(id);

    return Response.json({ tempPassword }, { status: 200 });
  } catch (err) {
    console.error('Error resetting password: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
