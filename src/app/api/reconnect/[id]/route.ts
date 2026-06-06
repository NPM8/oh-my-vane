import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import SessionManager from '@/lib/session';
import db from '@/lib/db';
import { messages, chats } from '@/lib/db/schema';
import { getAuthUser } from '@/lib/auth/getAuthUser';
import { isChatOwner } from '@/lib/auth/chatAccess';

export const runtime = 'nodejs';

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return Response.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // `id` is the session/backendId. Resolve the chat it belongs to and require
    // ownership: reconnecting attaches to a live answer stream, which only the
    // chat's owner may resume. (Non-owners viewing a shared chat get the
    // persisted messages via GET /api/chats/:id, not the live stream.) The
    // backendId is disclosed to a viewer only through that GET — i.e. once a
    // message row exists — so an unknown id with no row is treated as not found.
    const msg = await db.query.messages.findFirst({
      where: eq(messages.backendId, id),
    });
    if (!msg) {
      return Response.json({ message: 'Session not found' }, { status: 404 });
    }
    const ownerChat = await db.query.chats.findFirst({
      where: eq(chats.id, msg.chatId),
    });
    if (!ownerChat || !isChatOwner(ownerChat, user.id)) {
      return Response.json({ message: 'Session not found' }, { status: 404 });
    }

    const session = SessionManager.getSession(id);

    if (!session) {
      return Response.json({ message: 'Session not found' }, { status: 404 });
    }

    const responseStream = new TransformStream();
    const writer = responseStream.writable.getWriter();
    const encoder = new TextEncoder();

    const disconnect = session.subscribe((event, data) => {
      if (event === 'data') {
        if (data.type === 'block') {
          writer.write(
            encoder.encode(
              JSON.stringify({
                type: 'block',
                block: data.block,
              }) + '\n',
            ),
          );
        } else if (data.type === 'updateBlock') {
          writer.write(
            encoder.encode(
              JSON.stringify({
                type: 'updateBlock',
                blockId: data.blockId,
                patch: data.patch,
              }) + '\n',
            ),
          );
        } else if (data.type === 'researchComplete') {
          writer.write(
            encoder.encode(
              JSON.stringify({
                type: 'researchComplete',
              }) + '\n',
            ),
          );
        }
      } else if (event === 'end') {
        writer.write(
          encoder.encode(
            JSON.stringify({
              type: 'messageEnd',
            }) + '\n',
          ),
        );
        writer.close();
        disconnect();
      } else if (event === 'error') {
        writer.write(
          encoder.encode(
            JSON.stringify({
              type: 'error',
              data: data.data,
            }) + '\n',
          ),
        );
        writer.close();
        disconnect();
      }
    });

    req.signal.addEventListener('abort', () => {
      disconnect();
      writer.close();
    });

    return new Response(responseStream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    console.error('Error in reconnecting to session stream: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
