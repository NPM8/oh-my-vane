import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { createInvite, listInvites } from '@/lib/auth/invites';

export const runtime = 'nodejs';

const createSchema = z.object({
  role: z.enum(['admin', 'user']).optional().default('user'),
  ttlHours: z.number().int().min(1).max(720).optional().default(48),
});

export const POST = async (req: NextRequest) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'Invalid invite options.' }, { status: 400 });
    }

    const { rawToken, invite } = await createInvite({
      role: parsed.data.role,
      ttlHours: parsed.data.ttlHours,
      createdBy: auth.id,
    });

    const origin = req.nextUrl.origin;
    return Response.json(
      { invite, link: `${origin}/invite/${rawToken}` },
      { status: 201 },
    );
  } catch (err) {
    console.error('Error creating invite: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};

export const GET = async (req: NextRequest) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const list = await listInvites();
    const now = Date.now();
    const withStatus = list.map((i) => ({
      ...i,
      status: i.usedAt
        ? 'used'
        : new Date(i.expiresAt).getTime() <= now
          ? 'expired'
          : 'pending',
    }));
    return Response.json({ invites: withStatus }, { status: 200 });
  } catch (err) {
    console.error('Error listing invites: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
