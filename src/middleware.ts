import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, type AuthUser } from '@/lib/auth/getAuthUser';
import { countUsers, getUserById } from '@/lib/auth/users';
import { getRequireTwoFactor } from '@/lib/auth/authConfig';
import { silentRefresh } from '@/lib/auth/silentRefresh';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  buildCookieOptions,
  isSecureRequest,
} from '@/lib/auth/cookies';

export const runtime = 'nodejs';

// Public API prefixes that must not be guarded.
const PUBLIC_API = ['/api/auth/'];

export const middleware = async (req: NextRequest) => {
  const { pathname } = req.nextUrl;

  // Resolve the caller from the access token. When it is missing/expired but a
  // valid refresh cookie is still present, mint a fresh access token (mint-only,
  // no rotation — see silentRefresh) and (a) inject it into the forwarded request
  // so the same-pass RSC layout gate sees an authenticated user, and (b) set it
  // on the response so the browser carries it forward. This keeps the session
  // alive up to the refresh token's lifetime instead of logging the user out the
  // moment the short-lived access token expires — covering page loads AND APIs.
  let user: AuthUser | null = await getAuthUser(req);
  let refreshedAccess: string | null = null;
  let refreshedMaxAge = 0;
  let refreshedRefresh: string | null = null;
  let refreshedRefreshMaxAge = 0;
  if (!user) {
    const refreshed = await silentRefresh(
      req.cookies.get(REFRESH_COOKIE)?.value,
      Date.now(),
    );
    if (refreshed) {
      user = refreshed.user;
      refreshedAccess = refreshed.accessToken;
      refreshedMaxAge = refreshed.accessMaxAgeSec;
      // Same (unrotated) refresh token with a fresh maxAge — slides the browser
      // cookie's expiry forward in step with the DB row (see silentRefresh).
      refreshedRefresh = refreshed.refreshToken;
      refreshedRefreshMaxAge = refreshed.refreshMaxAgeSec;
      // Update the forwarded request so downstream (RSC layout, route handlers)
      // observe the freshly-minted access token within this same request.
      req.cookies.set(ACCESS_COOKIE, refreshed.accessToken);
    }
  }

  // Propagate the pathname so the root-layout auth gate can identify public
  // page routes (/invite, /login) and render them while logged out. Built AFTER
  // any cookie injection above so the new access cookie rides along.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-vane-pathname', pathname);

  const pass = () => {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    if (refreshedAccess) {
      const secure = isSecureRequest(req.headers.get('x-forwarded-proto'));
      const forceSecure = process.env.FORCE_SECURE_COOKIES === 'true';
      res.cookies.set(
        ACCESS_COOKIE,
        refreshedAccess,
        buildCookieOptions({
          maxAgeSeconds: refreshedMaxAge,
          isSecureRequest: secure,
          forceSecure,
        }),
      );
      if (refreshedRefresh) {
        res.cookies.set(
          REFRESH_COOKIE,
          refreshedRefresh,
          buildCookieOptions({
            maxAgeSeconds: refreshedRefreshMaxAge,
            isSecureRequest: secure,
            forceSecure,
          }),
        );
      }
    }
    return res;
  };

  // Page routes: no API guard here (the root-layout gate enforces auth). We
  // still fall through to pass() so a silently-refreshed access cookie is set.
  if (!pathname.startsWith('/api/')) return pass();
  if (PUBLIC_API.some((p) => pathname.startsWith(p))) return pass();

  // Before the first account exists the instance is unsecured and in the
  // setup/bootstrap phase — allow API access so setup can complete.
  if ((await countUsers()) === 0) return pass();

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
