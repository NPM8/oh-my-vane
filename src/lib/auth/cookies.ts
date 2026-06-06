export const ACCESS_COOKIE = 'vane_access';
export const REFRESH_COOKIE = 'vane_refresh';

export interface CookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
}

// Cookie `Secure` cannot be sent over plain HTTP, and many self-hosters run
// Vane on a LAN/localhost without TLS. So Secure is adaptive: on for HTTPS
// requests (or when FORCE_SECURE_COOKIES is set), off otherwise.
export const buildCookieOptions = (opts: {
  maxAgeSeconds: number;
  isSecureRequest: boolean;
  forceSecure?: boolean;
}): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: Boolean(opts.forceSecure) || opts.isSecureRequest,
  path: '/',
  maxAge: opts.maxAgeSeconds,
});

export const isSecureRequest = (forwardedProto: string | null): boolean =>
  forwardedProto === 'https';
