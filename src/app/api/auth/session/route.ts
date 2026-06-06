import { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth/getAuthUser';

export const runtime = 'nodejs';

export const GET = async (req: NextRequest) => {
  const user = await getAuthUser(req);
  if (!user) {
    return Response.json({ user: null }, { status: 200 });
  }
  return Response.json({ user }, { status: 200 });
};
