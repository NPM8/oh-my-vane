import { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { requireAuth } from '@/lib/auth/getAuthUser';
import { startEnrollment } from '@/lib/auth/twoFactor';

export const runtime = 'nodejs';

export const POST = async (req: NextRequest) => {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const { secret, otpauthUri } = await startEnrollment(auth.id, auth.username);
    const qrDataUrl = await QRCode.toDataURL(otpauthUri);
    return Response.json({ secret, otpauthUri, qrDataUrl }, { status: 200 });
  } catch (err) {
    console.error('Error starting 2FA enrollment: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
