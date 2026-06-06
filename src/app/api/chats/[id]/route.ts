import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { getAuthUser } from '@/lib/auth/getAuthUser';
import { canViewChat, isChatOwner } from '@/lib/auth/chatAccess';

export const runtime = 'nodejs';

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return Response.json({ message: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const chat = await db.query.chats.findFirst({ where: eq(chats.id, id) });

    if (!chat || !canViewChat(chat, user.id)) {
      return Response.json({ message: 'Chat not found' }, { status: 404 });
    }

    const chatMessages = await db.query.messages.findMany({
      where: eq(messages.chatId, id),
    });

    return Response.json(
      {
        chat,
        messages: chatMessages,
        readOnly: !isChatOwner(chat, user.id),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in getting chat by id: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};

export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return Response.json({ message: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const chat = await db.query.chats.findFirst({ where: eq(chats.id, id) });

    if (!chat || !isChatOwner(chat, user.id)) {
      return Response.json({ message: 'Chat not found' }, { status: 404 });
    }

    await db.delete(chats).where(eq(chats.id, id)).execute();
    await db.delete(messages).where(eq(messages.chatId, id)).execute();

    return Response.json({ message: 'Chat deleted successfully' }, { status: 200 });
  } catch (err) {
    console.error('Error in deleting chat by id: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};

const patchSchema = z.object({ shared: z.boolean() });

export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return Response.json({ message: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const chat = await db.query.chats.findFirst({ where: eq(chats.id, id) });
    if (!chat || !isChatOwner(chat, user.id)) {
      return Response.json({ message: 'Chat not found' }, { status: 404 });
    }

    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'shared (boolean) required.' }, { status: 400 });
    }

    await db.update(chats).set({ shared: parsed.data.shared }).where(eq(chats.id, id));
    return Response.json({ ok: true, shared: parsed.data.shared }, { status: 200 });
  } catch (err) {
    console.error('Error updating chat: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
