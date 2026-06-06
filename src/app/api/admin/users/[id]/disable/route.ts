import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { getUserById, setUserDisabled } from '@/lib/auth/users';
import { revokeAllForUser } from '@/lib/auth/refreshStore';

export const runtime = 'nodejs';

const schema = z.object({ disabled: z.boolean() });

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const { id } = await params;
    if (id === auth.id) {
      return Response.json({ message: 'You cannot disable your own account.' }, { status: 400 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'disabled (boolean) required.' }, { status: 400 });
    }
    const target = await getUserById(id);
    if (!target) {
      return Response.json({ message: 'User not found.' }, { status: 404 });
    }

    await setUserDisabled(id, parsed.data.disabled);
    if (parsed.data.disabled) await revokeAllForUser(id);
    return Response.json({ ok: true, disabled: parsed.data.disabled }, { status: 200 });
  } catch (err) {
    console.error('Error setting user disabled: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
