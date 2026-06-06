import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { getUserById, deleteUser } from '@/lib/auth/users';
import { revokeAllForUser } from '@/lib/auth/refreshStore';

export const runtime = 'nodejs';

export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const { id } = await params;
    if (id === auth.id) {
      return Response.json({ message: 'You cannot delete your own account.' }, { status: 400 });
    }
    const target = await getUserById(id);
    if (!target) {
      return Response.json({ message: 'User not found.' }, { status: 404 });
    }

    await revokeAllForUser(id);
    await deleteUser(id);
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Error deleting user: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
