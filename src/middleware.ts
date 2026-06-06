import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth/getAuthUser';
import { countUsers } from '@/lib/auth/users';
import configManager from '@/lib/config';
import { getUserById } from '@/lib/auth/users';

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

  // When the admin requires 2FA org-wide, block data APIs for users who haven't
  // enrolled — except /api/account/* (so they can enroll) and /api/auth/* (already
  // public above). This makes the require-2FA gate real at the API layer, not just UI.
  if (
    !pathname.startsWith('/api/account/') &&
    Boolean(configManager.getConfig('auth.requireTwoFactor', false))
  ) {
    const row = await getUserById(user.id);
    if (row && !row.totpEnabled) {
      return Response.json(
        { message: 'Two-factor enrollment required.' },
        { status: 403 },
      );
    }
  }
  return pass();
};

export const config = {
  // Run on everything except Next internals + static assets, so the pathname
  // header is set for page routes too (needed by the layout gate).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
