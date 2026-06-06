import { describe, it, expect } from 'vitest';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  buildCookieOptions,
  isSecureRequest,
} from '../cookies';

describe('cookies', () => {
  it('exposes stable cookie names', () => {
    expect(ACCESS_COOKIE).toBe('vane_access');
    expect(REFRESH_COOKIE).toBe('vane_refresh');
  });

  it('always sets httpOnly, sameSite=lax, path=/', () => {
    const o = buildCookieOptions({ maxAgeSeconds: 60, isSecureRequest: false });
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe('lax');
    expect(o.path).toBe('/');
    expect(o.maxAge).toBe(60);
  });

  it('sets secure only for https requests', () => {
    expect(buildCookieOptions({ maxAgeSeconds: 1, isSecureRequest: true }).secure).toBe(true);
    expect(buildCookieOptions({ maxAgeSeconds: 1, isSecureRequest: false }).secure).toBe(false);
  });

  it('forceSecure overrides an http request', () => {
    expect(
      buildCookieOptions({ maxAgeSeconds: 1, isSecureRequest: false, forceSecure: true }).secure,
    ).toBe(true);
  });

  it('detects https from x-forwarded-proto', () => {
    expect(isSecureRequest('https')).toBe(true);
    expect(isSecureRequest('http')).toBe(false);
    expect(isSecureRequest(null)).toBe(false);
  });
});
