import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/getAuthUser';
import { getUserPreferences, setUserPreferences } from '@/lib/auth/users';

export const runtime = 'nodejs';

export const GET = async (req: NextRequest) => {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    return Response.json({ preferences: await getUserPreferences(auth.id) }, { status: 200 });
  } catch (err) {
    console.error('Error reading preferences: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};

const schema = z.object({
  chatModelKey: z.string().max(200).optional(),
  chatModelProviderId: z.string().max(200).optional(),
  embeddingModelKey: z.string().max(200).optional(),
  embeddingModelProviderId: z.string().max(200).optional(),
  systemInstructions: z.string().max(10000).optional(),
});

export const PUT = async (req: NextRequest) => {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'Invalid preferences.' }, { status: 400 });
    }
    const preferences = await setUserPreferences(auth.id, parsed.data);
    return Response.json({ preferences }, { status: 200 });
  } catch (err) {
    console.error('Error saving preferences: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
