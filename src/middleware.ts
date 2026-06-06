import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth/getAuthUser';
import { countUsers, getUserById } from '@/lib/auth/users';
import { getRequireTwoFactor } from '@/lib/auth/authConfig';

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

  // Load the live user row once and use it for all downstream checks. This makes
  // `disabled` and role take effect immediately — the access token alone is not
  // trusted, so a disabled/deleted user (or revoked admin) loses API access at
  // once rather than lingering until the access token expires.
  const row = await getUserById(user.id);
  if (!row || row.disabled) {
    return Response.json({ message: 'Unauthorized' }, { status: 401 });
  }
  if (pathname.startsWith('/api/admin/') && row.role !== 'admin') {
    return Response.json({ message: 'Forbidden' }, { status: 403 });
  }

  // When the admin requires 2FA org-wide, block data APIs for users who haven't
  // enrolled — except /api/account/* (so they can enroll), /api/auth/* (already
  // public above), and /api/admin/settings (so an admin can always reverse the
  // policy without being locked out). Makes the gate real at the API layer.
  if (
    !pathname.startsWith('/api/account/') &&
    pathname !== '/api/admin/settings' &&
    getRequireTwoFactor() &&
    !row.totpEnabled
  ) {
    return Response.json(
      { message: 'Two-factor enrollment required.' },
      { status: 403 },
    );
  }
  return pass();
};

export const config = {
  // Run on everything except Next internals + static assets, so the pathname
  // header is set for page routes too (needed by the layout gate).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
