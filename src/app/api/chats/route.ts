import { NextRequest } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { getAuthUser } from '@/lib/auth/getAuthUser';

export const runtime = 'nodejs';

export const GET = async (req: NextRequest) => {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return Response.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const userChats = await db
      .select()
      .from(chats)
      .where(eq(chats.userId, user.id))
      .orderBy(desc(chats.createdAt));

    return Response.json({ chats: userChats }, { status: 200 });
  } catch (err) {
    console.error('Error in getting chats: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
