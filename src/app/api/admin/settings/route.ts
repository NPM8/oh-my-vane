import { NextRequest } from 'next/server';
import { z } from 'zod';
import configManager from '@/lib/config';
import { requireAdmin } from '@/lib/auth/getAuthUser';

export const runtime = 'nodejs';

export const GET = async (req: NextRequest) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    return Response.json(
      { requireTwoFactor: Boolean(configManager.getConfig('auth.requireTwoFactor', false)) },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error reading admin settings: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};

const schema = z.object({ requireTwoFactor: z.boolean() });

export const POST = async (req: NextRequest) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'requireTwoFactor (boolean) required.' }, { status: 400 });
    }
    configManager.updateConfig('auth.requireTwoFactor', parsed.data.requireTwoFactor);
    return Response.json({ requireTwoFactor: parsed.data.requireTwoFactor }, { status: 200 });
  } catch (err) {
    console.error('Error updating admin settings: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
