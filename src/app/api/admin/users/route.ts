import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { listUsers } from '@/lib/auth/users';

export const runtime = 'nodejs';

export const GET = async (req: NextRequest) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const list = await listUsers();
    return Response.json({ users: list }, { status: 200 });
  } catch (err) {
    console.error('Error listing users: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
