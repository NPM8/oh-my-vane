import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { revokeInvite } from '@/lib/auth/invites';

export const runtime = 'nodejs';

export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    await revokeInvite(id);
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Error revoking invite: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
