import { NextRequest, NextResponse } from 'next/server';
import { findRefreshByToken, revokeRefresh } from '@/lib/auth/refreshStore';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/cookies';

export const runtime = 'nodejs';

export const POST = async (req: NextRequest) => {
  try {
    const raw = req.cookies.get(REFRESH_COOKIE)?.value;
    if (raw) {
      const row = await findRefreshByToken(raw);
      if (row && !row.revokedAt) await revokeRefresh(row.id);
    }
    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.cookies.delete(ACCESS_COOKIE);
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  } catch (err) {
    console.error('Error in logout: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
