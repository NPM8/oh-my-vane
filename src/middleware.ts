import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth/getAuthUser';

export const runtime = 'nodejs';

// Public API prefixes that must not be guarded.
const PUBLIC_API = ['/api/auth/'];

export const middleware = async (req: NextRequest) => {
  const { pathname } = req.nextUrl;

  // Only guard API routes here; page gating happens in the root layout.
  if (!pathname.startsWith('/api/')) return NextResponse.next();
  if (PUBLIC_API.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const user = await getAuthUser(req);
  if (!user) {
    return Response.json({ message: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.next();
};

export const config = {
  matcher: ['/api/:path*'],
};
