import { NextRequest } from 'next/server';
import { z } from 'zod';
import { validateInvite } from '@/lib/auth/invites';

export const runtime = 'nodejs';

const schema = z.object({ token: z.string().min(1) });

export const POST = async (req: NextRequest) => {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ valid: false }, { status: 200 });
    }
    const result = await validateInvite(parsed.data.token);
    return Response.json(result, { status: 200 });
  } catch (err) {
    console.error('Error validating invite: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
