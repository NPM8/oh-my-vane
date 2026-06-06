import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '../rateLimit';

describe('rate limiter', () => {
  it('allows up to the limit then blocks within the window', () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => now });
    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(true);
    const blocked = limiter.check('k');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets after the window elapses', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });
    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(false);
    now += 1001;
    expect(limiter.check('k').allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
  });

  it('reset() clears a key (e.g. on successful login)', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });
    expect(limiter.check('k').allowed).toBe(true);
    limiter.reset('k');
    expect(limiter.check('k').allowed).toBe(true);
  });
});
