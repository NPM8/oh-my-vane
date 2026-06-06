interface Bucket {
  count: number;
  windowStart: number;
}

export interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterMs: number };
  reset(key: string): void;
}

export const createRateLimiter = (opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter => {
  const now = opts.now ?? (() => Date.now());
  const buckets = new Map<string, Bucket>();

  return {
    check(key: string) {
      const t = now();
      const b = buckets.get(key);
      if (!b || t - b.windowStart >= opts.windowMs) {
        buckets.set(key, { count: 1, windowStart: t });
        return { allowed: true, retryAfterMs: 0 };
      }
      if (b.count < opts.limit) {
        b.count += 1;
        return { allowed: true, retryAfterMs: 0 };
      }
      return { allowed: false, retryAfterMs: opts.windowMs - (t - b.windowStart) };
    },
    reset(key: string) {
      buckets.delete(key);
    },
  };
};
