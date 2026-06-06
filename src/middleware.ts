import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth/getAuthUser';
import { countUsers } from '@/lib/auth/users';

export const runtime = 'nodejs';

// Public API prefixes that must not be guarded.
const PUBLIC_API = ['/api/auth/'];

export const middleware = async (req: NextRequest) => {
  const { pathname } = req.nextUrl;

  // Propagate the pathname so the root-layout auth gate can identify public
  // page routes (/invite, /login) and render them while logged out.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-vane-pathname', pathname);
  const pass = () => NextResponse.next({ request: { headers: requestHeaders } });

  // Page routes: just propagate the header, no API guard here.
  if (!pathname.startsWith('/api/')) return pass();
  if (PUBLIC_API.some((p) => pathname.startsWith(p))) return pass();

  // Before the first account exists the instance is unsecured and in the
  // setup/bootstrap phase — allow API access so setup can complete.
  if ((await countUsers()) === 0) return pass();

  const user = await getAuthUser(req);
  if (!user) {
    return Response.json({ message: 'Unauthorized' }, { status: 401 });
  }
  if (pathname.startsWith('/api/admin/') && user.role !== 'admin') {
    return Response.json({ message: 'Forbidden' }, { status: 403 });
  }
  return pass();
};

export const config = {
  // Run on everything except Next internals + static assets, so the pathname
  // header is set for page routes too (needed by the layout gate).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
