# JWT Auth — Phase 2: Core Auth + Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make login work end-to-end: an invitation-less bootstrap creates the first admin, users authenticate with username+password, sessions ride in httpOnly cookies with silent refresh-token rotation, and the app UI is gated behind authentication.

**Architecture:** Thin HTTP route handlers (`/api/auth/*`) wrap a set of testable core modules in `src/lib/auth/` (built on the Phase 1 primitives). The JWT secret is resolved from env or persisted config. Page access is gated in the node-runtime root layout (which can read config + DB); data APIs are guarded by a `requireAuth` helper and a node-runtime middleware. 2FA hooks exist but stay inert until Phase 4 (no user can have `totpEnabled` yet).

**Tech Stack:** TypeScript, Next.js 16 (App Router, route handlers + middleware), Drizzle ORM + better-sqlite3, `jose`, `argon2` (via Phase 1 `password.ts`), `vitest`.

---

## Dependencies on Phase 1

These modules already exist and are tested — reuse them, do not reimplement:

- `src/lib/auth/password.ts` — `hashPassword`, `verifyPassword`
- `src/lib/auth/jwt.ts` — `signJwt`, `verifyJwt`, `AuthClaims`, `TokenType`
- `src/lib/auth/tokens.ts` — `generateToken`, `hashToken`
- DB schema: `users`, `invites`, `refreshTokens`, `chats.userId`, `chats.shared` (migration 0003 applied).

`src/lib/config/index.ts` exposes `configManager.getConfig(key, default)`, `updateConfig(key, val)`, `getCurrentConfig()`, `isSetupComplete()`, `markSetupComplete()`.

Existing route conventions (follow them): handlers use `Response.json(body, { status })` or `NextResponse.json`, wrap in try/catch, `console.error` on failure, return generic `{ message: 'An error has occurred.' }` with 500.

---

## Cross-cutting requirements (from spec §10–11)

- **API docs:** Task 17 creates `docs/API/AUTH.md` documenting every endpoint added here, in the style of `docs/API/SEARCH.md`.
- **UI consistency + mobile:** the bootstrap and login screens (Tasks 14–16) use theme tokens (`light/dark-primary|secondary`, `border-light-200/dark-200`, accent `#24A0ED`), Montserrat, `framer-motion`, `lucide-react`, `sonner` toasts, and follow `SetupWizard.tsx`'s full-screen centered pattern. Responsive from 320px.

---

## File Structure (Phase 2)

Core (testable):
- Create `src/lib/auth/secret.ts` — resolve/validate the JWT secret.
- Create `src/lib/auth/authConfig.ts` — assemble auth config (secret + TTLs + flags) from `configManager`/env, caching.
- Create `src/lib/auth/cookies.ts` — cookie names + adaptive cookie options.
- Create `src/lib/auth/rateLimit.ts` — in-memory token-bucket limiter.
- Create `src/lib/auth/session.ts` — `issueSession` (build access JWT + refresh record).
- Create `src/lib/auth/rotation.ts` — `decideRefresh` pure decision.
- Create `src/lib/auth/users.ts` — user repository + `claimOrphanChats`.
- Create `src/lib/auth/refreshStore.ts` — refresh-token persistence (save/find/revoke/revokeChain).
- Create `src/lib/auth/getAuthUser.ts` — read+verify access cookie; `requireAuth` wrapper.

HTTP:
- Create `src/app/api/auth/bootstrap/route.ts`
- Create `src/app/api/auth/login/route.ts`
- Create `src/app/api/auth/refresh/route.ts`
- Create `src/app/api/auth/logout/route.ts`
- Create `src/app/api/auth/session/route.ts` — GET current user (for client auth state).
- Create `src/middleware.ts`

UI:
- Create `src/components/Auth/Login.tsx`
- Create `src/components/Auth/BootstrapAdmin.tsx`
- Create `src/app/login/page.tsx`
- Modify `src/app/layout.tsx` — gate on users-exist + authentication.

Docs:
- Create `docs/API/AUTH.md`

---

## Task 1: JWT secret resolution + auth config

**Files:**
- Create `src/lib/auth/secret.ts`
- Create `src/lib/auth/authConfig.ts`
- Test `src/lib/auth/__tests__/secret.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/auth/__tests__/secret.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveJwtSecret } from '../secret';

describe('resolveJwtSecret', () => {
  it('prefers the env secret when present', () => {
    const r = resolveJwtSecret({
      envSecret: 'env-secret-that-is-at-least-32-bytes!!',
      storedSecret: 'stored-secret-also-32-bytes-long-xx',
    });
    expect(new TextDecoder().decode(r.secret)).toBe(
      'env-secret-that-is-at-least-32-bytes!!',
    );
    expect(r.generated).toBeUndefined();
  });

  it('falls back to the stored secret', () => {
    const r = resolveJwtSecret({
      storedSecret: 'stored-secret-also-32-bytes-long-xx',
    });
    expect(new TextDecoder().decode(r.secret)).toBe(
      'stored-secret-also-32-bytes-long-xx',
    );
    expect(r.generated).toBeUndefined();
  });

  it('generates a >=32 byte secret when none provided', () => {
    const r = resolveJwtSecret({});
    expect(r.generated).toBeDefined();
    expect(Buffer.byteLength(r.generated as string, 'utf8')).toBeGreaterThanOrEqual(32);
    expect(r.secret.length).toBeGreaterThanOrEqual(32);
  });

  it('throws when a provided secret is too short', () => {
    expect(() => resolveJwtSecret({ envSecret: 'too-short' })).toThrow();
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `yarn vitest run src/lib/auth/__tests__/secret.test.ts` → cannot resolve `../secret`.

- [ ] **Step 3: Implement** — `src/lib/auth/secret.ts`:

```ts
import { randomBytes } from 'node:crypto';

const MIN_SECRET_BYTES = 32;

export interface ResolvedSecret {
  secret: Uint8Array;
  generated?: string; // set only when a new secret was created (caller persists it)
}

export const resolveJwtSecret = (opts: {
  envSecret?: string;
  storedSecret?: string;
}): ResolvedSecret => {
  const existing = opts.envSecret || opts.storedSecret;
  if (existing) {
    if (Buffer.byteLength(existing, 'utf8') < MIN_SECRET_BYTES) {
      throw new Error('JWT secret must be at least 32 bytes');
    }
    return { secret: new TextEncoder().encode(existing) };
  }
  const generated = randomBytes(48).toString('base64url'); // ~64 chars
  return { secret: new TextEncoder().encode(generated), generated };
};
```

- [ ] **Step 4: Run, verify PASS** (4 tests).

- [ ] **Step 5: Implement the config assembler** — `src/lib/auth/authConfig.ts`:

```ts
import configManager from '@/lib/config';
import { resolveJwtSecret } from './secret';

export interface AuthConfig {
  secret: Uint8Array;
  accessTtlMin: number;
  refreshTtlDays: number;
  requireTwoFactor: boolean;
}

let cached: AuthConfig | null = null;

export const getAuthConfig = (): AuthConfig => {
  if (cached) return cached;

  const stored = configManager.getConfig('auth.jwtSecret') as
    | string
    | undefined;
  const { secret, generated } = resolveJwtSecret({
    envSecret: process.env.JWT_SECRET,
    storedSecret: stored,
  });
  if (generated) {
    configManager.updateConfig('auth.jwtSecret', generated);
  }

  cached = {
    secret,
    accessTtlMin: Number(configManager.getConfig('auth.accessTtlMin', 120)),
    refreshTtlDays: Number(configManager.getConfig('auth.refreshTtlDays', 30)),
    requireTwoFactor: Boolean(
      configManager.getConfig('auth.requireTwoFactor', false),
    ),
  };
  return cached;
};

// For tests / secret rotation: drop the memoized config.
export const resetAuthConfigCache = () => {
  cached = null;
};
```

- [ ] **Step 6: Typecheck.** `yarn tsc --noEmit` → no new errors.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/auth/secret.ts src/lib/auth/authConfig.ts src/lib/auth/__tests__/secret.test.ts
git commit -m "feat(auth): resolve and validate JWT secret with config/env fallback"
```

---

## Task 2: Cookie options (adaptive Secure)

**Files:**
- Create `src/lib/auth/cookies.ts`
- Test `src/lib/auth/__tests__/cookies.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/auth/__tests__/cookies.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — `src/lib/auth/cookies.ts`:

```ts
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
```

- [ ] **Step 4: Run, verify PASS** (5 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/cookies.ts src/lib/auth/__tests__/cookies.test.ts
git commit -m "feat(auth): add cookie names and adaptive Secure cookie options"
```

---

## Task 3: Rate limiter

**Files:**
- Create `src/lib/auth/rateLimit.ts`
- Test `src/lib/auth/__tests__/rateLimit.test.ts`

In-memory fixed-window limiter keyed by an arbitrary string (login uses `ip:username`). Per-process only (documented limitation).

- [ ] **Step 1: Write the failing test** — `src/lib/auth/__tests__/rateLimit.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — `src/lib/auth/rateLimit.ts`:

```ts
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
```

- [ ] **Step 4: Run, verify PASS** (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/rateLimit.ts src/lib/auth/__tests__/rateLimit.test.ts
git commit -m "feat(auth): add in-memory fixed-window rate limiter"
```

---

## Task 4: Session issuance

**Files:**
- Create `src/lib/auth/session.ts`
- Test `src/lib/auth/__tests__/session.test.ts`

`issueSession` builds the access JWT and the data for a refresh-token row. `now` and `refreshId` are injected for testability. The refresh token is an opaque random token (NOT a JWT); only its hash is persisted.

- [ ] **Step 1: Write the failing test** — `src/lib/auth/__tests__/session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { issueSession } from '../session';
import { verifyJwt } from '../jwt';
import { hashToken } from '../tokens';

const secret = new TextEncoder().encode('a-test-secret-that-is-32-bytes-min!!');

describe('issueSession', () => {
  it('issues an access JWT carrying the user claims', async () => {
    const s = await issueSession({
      user: { id: 'u1', role: 'admin', username: 'alice' },
      secret,
      accessTtlMin: 120,
      refreshTtlDays: 30,
      now: 1_000_000_000_000,
      refreshId: 'refresh-row-1',
    });
    const claims = await verifyJwt(s.accessToken, secret, 'access');
    expect(claims.sub).toBe('u1');
    expect(claims.role).toBe('admin');
    expect(claims.username).toBe('alice');
  });

  it('computes cookie max-ages from the TTLs', async () => {
    const s = await issueSession({
      user: { id: 'u1', role: 'user', username: 'bob' },
      secret,
      accessTtlMin: 120,
      refreshTtlDays: 30,
      now: 0,
      refreshId: 'r',
    });
    expect(s.accessMaxAgeSec).toBe(120 * 60);
    expect(s.refreshMaxAgeSec).toBe(30 * 24 * 60 * 60);
  });

  it('builds a refresh record whose hash matches the opaque token', async () => {
    const now = 1_700_000_000_000;
    const s = await issueSession({
      user: { id: 'u1', role: 'user', username: 'bob' },
      secret,
      accessTtlMin: 120,
      refreshTtlDays: 30,
      now,
      refreshId: 'refresh-row-9',
    });
    expect(s.refreshRecord.id).toBe('refresh-row-9');
    expect(s.refreshRecord.tokenHash).toBe(hashToken(s.refreshToken));
    expect(new Date(s.refreshRecord.expiresAt).getTime()).toBe(
      now + 30 * 24 * 60 * 60 * 1000,
    );
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — `src/lib/auth/session.ts`:

```ts
import { signJwt } from './jwt';
import { generateToken, hashToken } from './tokens';

export interface IssuedSession {
  accessToken: string;
  accessMaxAgeSec: number;
  refreshToken: string;
  refreshMaxAgeSec: number;
  refreshRecord: { id: string; tokenHash: string; expiresAt: string };
}

export const issueSession = async (params: {
  user: { id: string; role: string; username: string };
  secret: Uint8Array;
  accessTtlMin: number;
  refreshTtlDays: number;
  now: number;
  refreshId: string;
}): Promise<IssuedSession> => {
  const accessMaxAgeSec = params.accessTtlMin * 60;
  const refreshMaxAgeSec = params.refreshTtlDays * 24 * 60 * 60;

  const accessToken = await signJwt(
    {
      sub: params.user.id,
      role: params.user.role,
      username: params.user.username,
      type: 'access',
    },
    params.secret,
    `${accessMaxAgeSec}s`,
  );

  const refreshToken = generateToken();
  const expiresAt = new Date(params.now + refreshMaxAgeSec * 1000).toISOString();

  return {
    accessToken,
    accessMaxAgeSec,
    refreshToken,
    refreshMaxAgeSec,
    refreshRecord: {
      id: params.refreshId,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    },
  };
};
```

- [ ] **Step 4: Run, verify PASS** (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/session.ts src/lib/auth/__tests__/session.test.ts
git commit -m "feat(auth): add session issuance (access JWT + opaque refresh record)"
```

---

## Task 5: Refresh rotation decision

**Files:**
- Create `src/lib/auth/rotation.ts`
- Test `src/lib/auth/__tests__/rotation.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/auth/__tests__/rotation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decideRefresh } from '../rotation';

const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();
const now = Date.now();

describe('decideRefresh', () => {
  it('returns invalid when the row is missing', () => {
    expect(decideRefresh(undefined, now).action).toBe('invalid');
  });

  it('detects reuse when the row is already revoked', () => {
    expect(
      decideRefresh({ revokedAt: past, expiresAt: future }, now).action,
    ).toBe('reuse_detected');
  });

  it('returns invalid when expired', () => {
    expect(
      decideRefresh({ revokedAt: null, expiresAt: past }, now).action,
    ).toBe('invalid');
  });

  it('rotates a valid, unrevoked, unexpired row', () => {
    expect(
      decideRefresh({ revokedAt: null, expiresAt: future }, now).action,
    ).toBe('rotate');
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — `src/lib/auth/rotation.ts`:

```ts
export type RotationDecision =
  | { action: 'rotate' }
  | { action: 'reuse_detected' }
  | { action: 'invalid' };

export const decideRefresh = (
  row: { revokedAt: string | null; expiresAt: string } | undefined,
  now: number,
): RotationDecision => {
  if (!row) return { action: 'invalid' };
  if (row.revokedAt) return { action: 'reuse_detected' };
  if (new Date(row.expiresAt).getTime() <= now) return { action: 'invalid' };
  return { action: 'rotate' };
};
```

- [ ] **Step 4: Run, verify PASS** (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/rotation.ts src/lib/auth/__tests__/rotation.test.ts
git commit -m "feat(auth): add refresh-token rotation decision with reuse detection"
```

---

## Task 6: User repository + orphan-chat claim

**Files:**
- Create `src/lib/auth/users.ts`
- Test `src/lib/auth/__tests__/users.integration.test.ts`

This module touches the DB. The test spins up an isolated temp SQLite DB, runs the migrations, and dynamically imports the module so the `db` singleton picks up the temp `DATA_DIR`.

- [ ] **Step 1: Write the failing integration test** — `src/lib/auth/__tests__/users.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let users: typeof import('../users');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-users-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  // Run migrations against the temp DB.
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: 'inherit',
  });
  users = await import('../users');
});

describe('user repository', () => {
  it('counts zero users on a fresh DB', async () => {
    expect(await users.countUsers()).toBe(0);
  });

  it('creates a user and finds it by username', async () => {
    const created = await users.createUser({
      username: 'alice',
      password: 'a-strong-password-123',
      role: 'admin',
    });
    expect(created.id).toBeTruthy();
    expect(created.role).toBe('admin');
    const found = await users.getUserByUsername('alice');
    expect(found?.id).toBe(created.id);
    expect(found?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await users.countUsers()).toBe(1);
  });

  it('rejects a duplicate username', async () => {
    await expect(
      users.createUser({ username: 'alice', password: 'another-pass-123', role: 'user' }),
    ).rejects.toThrow();
  });

  it('claims orphan chats for a user', async () => {
    const db = (await import('@/lib/db')).default;
    const { chats } = await import('@/lib/db/schema');
    await db.insert(chats).values({ id: 'c-orphan', title: 't', createdAt: new Date().toISOString() });
    const admin = await users.getUserByUsername('alice');
    const claimed = await users.claimOrphanChats(admin!.id);
    expect(claimed).toBeGreaterThanOrEqual(1);
    const row = await db.query.chats.findFirst({ where: (c, { eq }) => eq(c.id, 'c-orphan') });
    expect(row?.userId).toBe(admin!.id);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `yarn vitest run src/lib/auth/__tests__/users.integration.test.ts` → cannot resolve `../users`.

- [ ] **Step 3: Implement** — `src/lib/auth/users.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq, isNull } from 'drizzle-orm';
import db from '@/lib/db';
import { users, chats } from '@/lib/db/schema';
import { hashPassword } from './password';

export type Role = 'admin' | 'user';

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
}

export const countUsers = async (): Promise<number> => {
  const rows = await db.select({ id: users.id }).from(users);
  return rows.length;
};

export const getUserByUsername = async (username: string) =>
  db.query.users.findFirst({ where: eq(users.username, username) });

export const getUserById = async (id: string) =>
  db.query.users.findFirst({ where: eq(users.id, id) });

export const createUser = async (input: {
  username: string;
  password: string;
  role: Role;
}): Promise<PublicUser> => {
  const id = randomUUID();
  const nowIso = new Date().toISOString();
  const passwordHash = await hashPassword(input.password);
  await db.insert(users).values({
    id,
    username: input.username,
    passwordHash,
    role: input.role,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  return {
    id,
    username: input.username,
    role: input.role,
    disabled: false,
    totpEnabled: false,
    mustChangePassword: false,
  };
};

// Assign every chat with no owner to `userId`. Used once, when the first admin
// is bootstrapped on an upgraded single-user install. Returns rows affected.
export const claimOrphanChats = async (userId: string): Promise<number> => {
  const result = await db
    .update(chats)
    .set({ userId })
    .where(isNull(chats.userId));
  // better-sqlite3 driver returns { changes } on the run result.
  return (result as unknown as { changes?: number }).changes ?? 0;
};
```

> Note: drizzle's better-sqlite3 `update().set().where()` returns the driver run info; `changes` is the affected-row count. If the return shape differs in this drizzle version, adapt the cast and report it as a concern — do not change the test's `>= 1` assertion.

- [ ] **Step 4: Run, verify PASS** (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/users.ts src/lib/auth/__tests__/users.integration.test.ts
git commit -m "feat(auth): add user repository and orphan-chat claim"
```

---

## Task 7: Refresh-token store

**Files:**
- Create `src/lib/auth/refreshStore.ts`
- Test `src/lib/auth/__tests__/refreshStore.integration.test.ts`

- [ ] **Step 1: Write the failing integration test** — `src/lib/auth/__tests__/refreshStore.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashToken } from '../tokens';

let store: typeof import('../refreshStore');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-refresh-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: 'inherit',
  });
  store = await import('../refreshStore');
});

describe('refresh store', () => {
  it('saves and finds a refresh row by token hash', async () => {
    await store.saveRefresh({
      id: 'r1',
      userId: 'u1',
      tokenHash: hashToken('raw-token-1'),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    const found = await store.findRefreshByToken('raw-token-1');
    expect(found?.id).toBe('r1');
    expect(found?.revokedAt).toBeNull();
  });

  it('rotates: revokes old row pointing to the new one', async () => {
    await store.saveRefresh({
      id: 'r2',
      userId: 'u1',
      tokenHash: hashToken('raw-token-2'),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    await store.revokeRefresh('r2', 'r3');
    const found = await store.findRefreshByToken('raw-token-2');
    expect(found?.revokedAt).not.toBeNull();
    expect(found?.replacedBy).toBe('r3');
  });

  it('revokes the whole chain for a user (reuse response)', async () => {
    await store.saveRefresh({
      id: 'r4',
      userId: 'u2',
      tokenHash: hashToken('raw-token-4'),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    await store.revokeAllForUser('u2');
    const found = await store.findRefreshByToken('raw-token-4');
    expect(found?.revokedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — `src/lib/auth/refreshStore.ts`:

```ts
import { eq, and, isNull } from 'drizzle-orm';
import db from '@/lib/db';
import { refreshTokens } from '@/lib/db/schema';
import { hashToken } from './tokens';

export const saveRefresh = async (row: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
}) => {
  await db.insert(refreshTokens).values({
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    createdAt: new Date().toISOString(),
  });
};

export const findRefreshByToken = async (rawToken: string) =>
  db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, hashToken(rawToken)),
  });

export const revokeRefresh = async (id: string, replacedBy?: string) => {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date().toISOString(), replacedBy: replacedBy ?? null })
    .where(eq(refreshTokens.id, id));
};

// Reuse-detection response: kill every still-active refresh row for the user.
export const revokeAllForUser = async (userId: string) => {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
};
```

- [ ] **Step 4: Run, verify PASS** (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/refreshStore.ts src/lib/auth/__tests__/refreshStore.integration.test.ts
git commit -m "feat(auth): add refresh-token store with rotation and chain revocation"
```

---

## Task 8: getAuthUser + requireAuth

**Files:**
- Create `src/lib/auth/getAuthUser.ts`

Thin glue over the already-tested `verifyJwt`. `getAuthUser` reads the access cookie from a `NextRequest` and returns the claims or null. `requireAuth` returns either the user or a ready-to-return 401 `Response`.

- [ ] **Step 1: Implement** — `src/lib/auth/getAuthUser.ts`:

```ts
import { NextRequest } from 'next/server';
import { verifyJwt } from './jwt';
import { getAuthConfig } from './authConfig';
import { ACCESS_COOKIE } from './cookies';

export interface AuthUser {
  id: string;
  role: string;
  username: string;
}

export const getAuthUser = async (
  req: NextRequest,
): Promise<AuthUser | null> => {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    const claims = await verifyJwt(token, getAuthConfig().secret, 'access');
    return {
      id: claims.sub,
      role: claims.role ?? 'user',
      username: claims.username ?? '',
    };
  } catch {
    return null;
  }
};

// Helper for route handlers: returns the user, or a 401 Response to return.
export const requireAuth = async (
  req: NextRequest,
): Promise<AuthUser | Response> => {
  const user = await getAuthUser(req);
  if (!user) {
    return Response.json({ message: 'Unauthorized' }, { status: 401 });
  }
  return user;
};

export const isResponse = (v: unknown): v is Response => v instanceof Response;
```

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit` → no new errors.

- [ ] **Step 3: Commit.**

```bash
git add src/lib/auth/getAuthUser.ts
git commit -m "feat(auth): add getAuthUser and requireAuth route helpers"
```

---

## Task 9: Bootstrap route (first admin)

**Files:**
- Create `src/app/api/auth/bootstrap/route.ts`

Creates the first admin ONLY when no users exist. Claims orphan chats, issues a session, sets cookies. Idempotent guard: if any user already exists → 409.

- [ ] **Step 1: Implement** — `src/app/api/auth/bootstrap/route.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { countUsers, createUser, claimOrphanChats } from '@/lib/auth/users';
import { issueSession } from '@/lib/auth/session';
import { getAuthConfig } from '@/lib/auth/authConfig';
import { saveRefresh } from '@/lib/auth/refreshStore';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  buildCookieOptions,
  isSecureRequest,
} from '@/lib/auth/cookies';

export const runtime = 'nodejs';

const bodySchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(10).max(200),
});

export const POST = async (req: NextRequest) => {
  try {
    if ((await countUsers()) > 0) {
      return Response.json(
        { message: 'Admin already exists.' },
        { status: 409 },
      );
    }

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json(
        { message: 'Username (3-64) and password (10-200) required.' },
        { status: 400 },
      );
    }

    const user = await createUser({
      username: parsed.data.username,
      password: parsed.data.password,
      role: 'admin',
    });
    await claimOrphanChats(user.id);

    const cfg = getAuthConfig();
    const session = await issueSession({
      user: { id: user.id, role: user.role, username: user.username },
      secret: cfg.secret,
      accessTtlMin: cfg.accessTtlMin,
      refreshTtlDays: cfg.refreshTtlDays,
      now: Date.now(),
      refreshId: randomUUID(),
    });
    await saveRefresh({
      id: session.refreshRecord.id,
      userId: user.id,
      tokenHash: session.refreshRecord.tokenHash,
      expiresAt: session.refreshRecord.expiresAt,
    });

    const secure = isSecureRequest(req.headers.get('x-forwarded-proto'));
    const forceSecure = process.env.FORCE_SECURE_COOKIES === 'true';
    const res = NextResponse.json({ user }, { status: 201 });
    res.cookies.set(
      ACCESS_COOKIE,
      session.accessToken,
      buildCookieOptions({ maxAgeSeconds: session.accessMaxAgeSec, isSecureRequest: secure, forceSecure }),
    );
    res.cookies.set(
      REFRESH_COOKIE,
      session.refreshToken,
      buildCookieOptions({ maxAgeSeconds: session.refreshMaxAgeSec, isSecureRequest: secure, forceSecure }),
    );
    return res;
  } catch (err) {
    console.error('Error in bootstrap: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit`.

- [ ] **Step 3: Commit.**

```bash
git add src/app/api/auth/bootstrap/route.ts
git commit -m "feat(auth): add bootstrap route to create the first admin"
```

---

## Task 10: Login route

**Files:**
- Create `src/app/api/auth/login/route.ts`

Rate-limited (`ip:username`). Generic 401 on bad credentials or disabled account (no enumeration). 2FA branch is forward-compatible but inert in Phase 2 (no user has `totpEnabled`).

- [ ] **Step 1: Implement** — `src/app/api/auth/login/route.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByUsername } from '@/lib/auth/users';
import { verifyPassword } from '@/lib/auth/password';
import { issueSession } from '@/lib/auth/session';
import { getAuthConfig } from '@/lib/auth/authConfig';
import { saveRefresh } from '@/lib/auth/refreshStore';
import { createRateLimiter } from '@/lib/auth/rateLimit';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  buildCookieOptions,
  isSecureRequest,
} from '@/lib/auth/cookies';

export const runtime = 'nodejs';

// Module-scoped so the window persists across requests in a process.
const loginLimiter = createRateLimiter({ limit: 10, windowMs: 5 * 60 * 1000 });

const bodySchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

export const POST = async (req: NextRequest) => {
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ message: 'Invalid credentials.' }, { status: 401 });
    }
    const { username, password } = parsed.data;

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const limit = loginLimiter.check(`${ip}:${username}`);
    if (!limit.allowed) {
      return Response.json(
        { message: 'Too many attempts. Try again later.' },
        { status: 429 },
      );
    }

    const user = await getUserByUsername(username);
    const ok = user && !user.disabled && (await verifyPassword(user.passwordHash, password));
    if (!user || !ok) {
      return Response.json({ message: 'Invalid credentials.' }, { status: 401 });
    }
    loginLimiter.reset(`${ip}:${username}`);

    // Forward-compatible 2FA gate (inert until Phase 4 enables enrollment).
    if (user.totpEnabled) {
      return Response.json({ mfaRequired: true }, { status: 200 });
    }

    const cfg = getAuthConfig();
    const session = await issueSession({
      user: { id: user.id, role: user.role, username: user.username },
      secret: cfg.secret,
      accessTtlMin: cfg.accessTtlMin,
      refreshTtlDays: cfg.refreshTtlDays,
      now: Date.now(),
      refreshId: randomUUID(),
    });
    await saveRefresh({
      id: session.refreshRecord.id,
      userId: user.id,
      tokenHash: session.refreshRecord.tokenHash,
      expiresAt: session.refreshRecord.expiresAt,
    });

    const secure = isSecureRequest(req.headers.get('x-forwarded-proto'));
    const forceSecure = process.env.FORCE_SECURE_COOKIES === 'true';
    const res = NextResponse.json(
      {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
        },
      },
      { status: 200 },
    );
    res.cookies.set(
      ACCESS_COOKIE,
      session.accessToken,
      buildCookieOptions({ maxAgeSeconds: session.accessMaxAgeSec, isSecureRequest: secure, forceSecure }),
    );
    res.cookies.set(
      REFRESH_COOKIE,
      session.refreshToken,
      buildCookieOptions({ maxAgeSeconds: session.refreshMaxAgeSec, isSecureRequest: secure, forceSecure }),
    );
    return res;
  } catch (err) {
    console.error('Error in login: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit`.

- [ ] **Step 3: Commit.**

```bash
git add src/app/api/auth/login/route.ts
git commit -m "feat(auth): add rate-limited login route"
```

---

## Task 11: Refresh route

**Files:**
- Create `src/app/api/auth/refresh/route.ts`

Rotates the refresh token; on reuse of a revoked token, revokes the whole chain and clears cookies.

- [ ] **Step 1: Implement** — `src/app/api/auth/refresh/route.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { decideRefresh } from '@/lib/auth/rotation';
import {
  findRefreshByToken,
  revokeRefresh,
  revokeAllForUser,
  saveRefresh,
} from '@/lib/auth/refreshStore';
import { getUserById } from '@/lib/auth/users';
import { issueSession } from '@/lib/auth/session';
import { getAuthConfig } from '@/lib/auth/authConfig';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  buildCookieOptions,
  isSecureRequest,
} from '@/lib/auth/cookies';

export const runtime = 'nodejs';

const clearAuthCookies = (res: NextResponse) => {
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
};

export const POST = async (req: NextRequest) => {
  try {
    const raw = req.cookies.get(REFRESH_COOKIE)?.value;
    if (!raw) {
      return Response.json({ message: 'No session.' }, { status: 401 });
    }

    const row = await findRefreshByToken(raw);
    const decision = decideRefresh(
      row ? { revokedAt: row.revokedAt, expiresAt: row.expiresAt } : undefined,
      Date.now(),
    );

    if (decision.action === 'reuse_detected') {
      if (row) await revokeAllForUser(row.userId);
      const res = NextResponse.json({ message: 'Session revoked.' }, { status: 401 });
      clearAuthCookies(res);
      return res;
    }
    if (decision.action === 'invalid' || !row) {
      const res = NextResponse.json({ message: 'Invalid session.' }, { status: 401 });
      clearAuthCookies(res);
      return res;
    }

    const user = await getUserById(row.userId);
    if (!user || user.disabled) {
      const res = NextResponse.json({ message: 'Invalid session.' }, { status: 401 });
      clearAuthCookies(res);
      return res;
    }

    const cfg = getAuthConfig();
    const newId = randomUUID();
    const session = await issueSession({
      user: { id: user.id, role: user.role, username: user.username },
      secret: cfg.secret,
      accessTtlMin: cfg.accessTtlMin,
      refreshTtlDays: cfg.refreshTtlDays,
      now: Date.now(),
      refreshId: newId,
    });
    await saveRefresh({
      id: newId,
      userId: user.id,
      tokenHash: session.refreshRecord.tokenHash,
      expiresAt: session.refreshRecord.expiresAt,
    });
    await revokeRefresh(row.id, newId); // rotate: old row revoked, points to new

    const secure = isSecureRequest(req.headers.get('x-forwarded-proto'));
    const forceSecure = process.env.FORCE_SECURE_COOKIES === 'true';
    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.cookies.set(
      ACCESS_COOKIE,
      session.accessToken,
      buildCookieOptions({ maxAgeSeconds: session.accessMaxAgeSec, isSecureRequest: secure, forceSecure }),
    );
    res.cookies.set(
      REFRESH_COOKIE,
      session.refreshToken,
      buildCookieOptions({ maxAgeSeconds: session.refreshMaxAgeSec, isSecureRequest: secure, forceSecure }),
    );
    return res;
  } catch (err) {
    console.error('Error in refresh: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit`.

- [ ] **Step 3: Commit.**

```bash
git add src/app/api/auth/refresh/route.ts
git commit -m "feat(auth): add refresh route with rotation and reuse detection"
```

---

## Task 12: Logout + session routes

**Files:**
- Create `src/app/api/auth/logout/route.ts`
- Create `src/app/api/auth/session/route.ts`

- [ ] **Step 1: Implement logout** — `src/app/api/auth/logout/route.ts`:

```ts
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
```

- [ ] **Step 2: Implement session (current user)** — `src/app/api/auth/session/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth/getAuthUser';

export const runtime = 'nodejs';

export const GET = async (req: NextRequest) => {
  const user = await getAuthUser(req);
  if (!user) {
    return Response.json({ user: null }, { status: 200 });
  }
  return Response.json({ user }, { status: 200 });
};
```

- [ ] **Step 3: Typecheck.** `yarn tsc --noEmit`.

- [ ] **Step 4: Commit.**

```bash
git add src/app/api/auth/logout/route.ts src/app/api/auth/session/route.ts
git commit -m "feat(auth): add logout and current-session routes"
```

---

## Task 13: Middleware (API guard)

**Files:**
- Create `src/middleware.ts`

Guards `/api/*` data routes, leaving auth + public endpoints open. Runs in the Node runtime so it can read the config-stored JWT secret via `getAuthConfig`.

- [ ] **Step 1: Implement** — `src/middleware.ts`:

```ts
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
```

- [ ] **Step 2: Verify Node-runtime middleware is accepted.** Run `yarn build` (or `yarn dev` briefly) and confirm there is no error about `runtime = 'nodejs'` being unsupported in middleware.

Run: `yarn build 2>&1 | tail -30`
Expected: build completes; no "Middleware cannot use the Node.js runtime" error.

**CONTINGENCY:** If this Next.js version rejects `runtime='nodejs'` in middleware, STOP and report it. Fallback plan (do not implement without controller confirmation): remove `src/middleware.ts` and instead guard each existing protected data route (`/api/chats`, `/api/chat`, `/api/search`, `/api/chats/[id]`, `/api/uploads`, etc.) with `requireAuth` from `getAuthUser.ts`. The page-level gate in Task 14 still protects the UI regardless.

- [ ] **Step 3: Commit.**

```bash
git add src/middleware.ts
git commit -m "feat(auth): guard data APIs with node-runtime middleware"
```

---

## Task 14: Layout gating (bootstrap / login / app)

**Files:**
- Modify `src/app/layout.tsx`

Decision order in the server component: setup incomplete → SetupWizard (existing); else no users → BootstrapAdmin; else not authenticated → Login; else the app.

- [ ] **Step 1: Modify** `src/app/layout.tsx`. Add imports at the top alongside the existing ones:

```ts
import { cookies } from 'next/headers';
import { countUsers } from '@/lib/auth/users';
import { verifyJwt } from '@/lib/auth/jwt';
import { getAuthConfig } from '@/lib/auth/authConfig';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import Login from '@/components/Auth/Login';
import BootstrapAdmin from '@/components/Auth/BootstrapAdmin';
```

- [ ] **Step 2: Make the component async and compute auth state.** Replace the existing synchronous `export default function RootLayout(...) { const setupComplete = ...; const configSections = ...; return (...) }` body so it reads:

```tsx
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const setupComplete = configManager.isSetupComplete();
  const configSections = configManager.getUIConfigSections();

  const userCount = await countUsers();
  let authed = false;
  if (userCount > 0) {
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (token) {
      try {
        await verifyJwt(token, getAuthConfig().secret, 'access');
        authed = true;
      } catch {
        authed = false;
      }
    }
  }

  const renderGate = () => {
    if (!setupComplete) return <SetupWizard configSections={configSections} />;
    if (userCount === 0) return <BootstrapAdmin />;
    if (!authed) return <Login />;
    return (
      <ChatProvider>
        <Sidebar>{children}</Sidebar>
        <Toaster
          toastOptions={{
            unstyled: true,
            classNames: {
              toast:
                'bg-light-secondary dark:bg-dark-secondary dark:text-white/70 text-black-70 rounded-lg p-4 flex flex-row items-center space-x-2',
            },
          }}
        />
      </ChatProvider>
    );
  };

  return (
    <html className="h-full" lang="en" suppressHydrationWarning>
      <body className={cn('h-full antialiased', montserrat.className)}>
        <ThemeProvider>{renderGate()}</ThemeProvider>
      </body>
    </html>
  );
}
```

> Note: `layout.tsx` already declares `export const dynamic = 'force-dynamic'`, so reading cookies/DB per request is fine. Keep that line.

- [ ] **Step 3: Typecheck.** `yarn tsc --noEmit` (will fail until Task 15/16 create `Login`/`BootstrapAdmin`; that's expected — proceed to those, then re-check).

- [ ] **Step 4: Commit (after Tasks 15-16 exist and tsc passes).** Defer commit; bundle with Task 16.

---

## Task 15: BootstrapAdmin component

**Files:**
- Create `src/components/Auth/BootstrapAdmin.tsx`

Full-screen centered form (matches `SetupWizard` pattern, theme tokens, mobile-friendly) that POSTs to `/api/auth/bootstrap`, then reloads.

- [ ] **Step 1: Implement** — `src/components/Auth/BootstrapAdmin.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';

const BootstrapAdmin = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) {
      toast.error('Password must be at least 10 characters.');
      return;
    }
    try {
      setSubmitting(true);
      const res = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to create admin');
      }
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create admin');
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-light-primary dark:bg-dark-primary h-screen w-screen fixed inset-0 flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-light-primary dark:bg-dark-primary border border-light-200 dark:border-dark-200 rounded-xl shadow-sm p-6 flex flex-col space-y-5"
      >
        <div className="flex flex-col items-center text-center space-y-2">
          <ShieldCheck className="w-8 h-8 text-[#24A0ED]" />
          <h1 className="text-lg font-medium text-black dark:text-white">
            Create admin account
          </h1>
          <p className="text-xs text-black/50 dark:text-white/50">
            This is the first and only account with full control. There is no
            sign-up page — invite others later.
          </p>
        </div>
        <input
          type="text"
          autoComplete="username"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          className="w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]"
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder="Password (min 10 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={10}
          className="w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full px-4 py-2.5 rounded-lg bg-[#24A0ED] text-white hover:bg-[#1e8fd1] active:scale-95 transition-all duration-200 font-medium text-sm disabled:opacity-50 disabled:active:scale-100"
        >
          {submitting ? 'Creating…' : 'Create admin'}
        </button>
      </form>
    </div>
  );
};

export default BootstrapAdmin;
```

- [ ] **Step 2: Typecheck** deferred to Task 16 (Login still missing).

---

## Task 16: Login component + /login page

**Files:**
- Create `src/components/Auth/Login.tsx`
- Create `src/app/login/page.tsx`

- [ ] **Step 1: Implement** — `src/components/Auth/Login.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { LogIn } from 'lucide-react';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.status === 429) {
        throw new Error('Too many attempts. Try again later.');
      }
      if (!res.ok) {
        throw new Error('Invalid credentials.');
      }
      const data = await res.json();
      if (data.mfaRequired) {
        // 2FA is delivered in Phase 4; should not occur in Phase 2.
        toast.error('Two-factor authentication is not available yet.');
        setSubmitting(false);
        return;
      }
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-light-primary dark:bg-dark-primary h-screen w-screen fixed inset-0 flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-light-primary dark:bg-dark-primary border border-light-200 dark:border-dark-200 rounded-xl shadow-sm p-6 flex flex-col space-y-5"
      >
        <div className="flex flex-col items-center text-center space-y-2">
          <LogIn className="w-8 h-8 text-[#24A0ED]" />
          <h1 className="text-lg font-medium text-black dark:text-white">
            Sign in to Vane
          </h1>
        </div>
        <input
          type="text"
          autoComplete="username"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]"
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full px-4 py-2.5 rounded-lg bg-[#24A0ED] text-white hover:bg-[#1e8fd1] active:scale-95 transition-all duration-200 font-medium text-sm disabled:opacity-50 disabled:active:scale-100"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
};

export default Login;
```

- [ ] **Step 2: Implement** — `src/app/login/page.tsx` (a routable login page; the layout gate also renders `Login`, but a dedicated route is useful for redirects):

```tsx
import Login from '@/components/Auth/Login';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return <Login />;
}
```

- [ ] **Step 3: Typecheck the whole project.** `yarn tsc --noEmit` → exit 0 (layout, Login, BootstrapAdmin all resolve now).

- [ ] **Step 4: Commit Tasks 14-16 together.**

```bash
git add src/app/layout.tsx src/components/Auth/Login.tsx src/components/Auth/BootstrapAdmin.tsx src/app/login/page.tsx
git commit -m "feat(auth): gate app behind bootstrap/login with on-brand mobile UI"
```

---

## Task 17: API documentation

**Files:**
- Create `docs/API/AUTH.md`

- [ ] **Step 1: Write `docs/API/AUTH.md`** matching `docs/API/SEARCH.md`'s style. It MUST document, with method + path, full-URL example, purpose, request body (JSON + per-field params), response example(s), and an Error Handling status-code list:

  - **Overview**: cookie model (`vane_access` short-lived + `vane_refresh` rotating, both httpOnly + `SameSite=Lax`, `Secure` adaptive to HTTPS / `FORCE_SECURE_COOKIES`), and the 401→`/api/auth/refresh`→retry contract.
  - **POST `/api/auth/bootstrap`** — create first admin; body `{username, password}`; 201 `{user}` + sets cookies; 409 if an admin already exists; 400 on validation failure.
  - **POST `/api/auth/login`** — body `{username, password}`; 200 `{user}` + cookies, or 200 `{mfaRequired:true}` (Phase 4); 401 invalid; 429 rate-limited.
  - **POST `/api/auth/refresh`** — uses refresh cookie; 200 `{ok:true}` + rotated cookies; 401 + cleared cookies on invalid/reuse.
  - **POST `/api/auth/logout`** — revokes refresh, clears cookies; 200 `{ok:true}`.
  - **GET `/api/auth/session`** — 200 `{user}` or `{user:null}`.
  - **Auth requirement note**: all `/api/*` routes except `/api/auth/*` require a valid access cookie (else 401).

  Write complete, accurate content (no placeholders). Use the actual response shapes from Tasks 9-12.

- [ ] **Step 2: Commit.**

```bash
git add docs/API/AUTH.md
git commit -m "docs(api): document authentication endpoints"
```

---

## Task 18: Full suite green + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite.** `yarn test` → all Phase 1 + Phase 2 unit/integration tests pass.

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit` → exit 0.

- [ ] **Step 3: Manual smoke test against a throwaway data dir.** Document the commands and results. Start the app with a temp `DATA_DIR` (so the real DB is untouched), then:

```bash
# In one shell (temp data dir; migrations run via the app's normal path):
TMP=$(mktemp -d); mkdir -p "$TMP/data"; cp -r drizzle "$TMP/drizzle"
DATA_DIR="$TMP" npx tsx src/lib/db/migrate.ts
DATA_DIR="$TMP" yarn dev
```

Then verify with curl (second shell), capturing cookies:

```bash
# Bootstrap first admin
curl -s -c /tmp/vane.cookies -X POST localhost:3000/api/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"supersecret123"}' -w '\n%{http_code}\n'
# Expected: 201 with {"user":...}

# Session reflects logged-in user
curl -s -b /tmp/vane.cookies localhost:3000/api/auth/session -w '\n%{http_code}\n'
# Expected: 200 {"user":{"id":...,"username":"admin","role":"admin"}}

# Second bootstrap attempt is rejected
curl -s -X POST localhost:3000/api/auth/bootstrap -H 'Content-Type: application/json' \
  -d '{"username":"x","password":"supersecret123"}' -w '\n%{http_code}\n'
# Expected: 409

# Logout clears the session
curl -s -b /tmp/vane.cookies -c /tmp/vane.cookies -X POST localhost:3000/api/auth/logout -w '\n%{http_code}\n'
curl -s -b /tmp/vane.cookies localhost:3000/api/auth/session -w '\n%{http_code}\n'
# Expected: {"user":null}

# Login again
curl -s -c /tmp/vane.cookies -X POST localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"supersecret123"}' -w '\n%{http_code}\n'
# Expected: 200 with {"user":...}
```

Record the actual status codes. All must match. Stop the dev server and remove `$TMP` afterward.

- [ ] **Step 4: Commit (only if Steps produced fixes).**

```bash
git add -A
git commit -m "test(auth): verify phase 2 core auth suite and smoke test"
```

---

## Self-Review Notes

- **Spec coverage (Phase 2 scope):** JWT secret resolution + adaptive Secure cookies ✓; short access JWT + rotating opaque refresh with reuse detection ✓; login (rate-limited, no enumeration) ✓; bootstrap first admin + orphan-chat claim (backwards-compat) ✓; logout + current-session ✓; API guard middleware (+ documented fallback) ✓; page gating (setup → bootstrap → login → app) ✓; on-brand mobile UI ✓; `docs/API/AUTH.md` ✓. Invitations (Phase 3), 2FA enrollment/verify (Phase 4), per-user chat scoping + sharing (Phase 5), and admin user management + password reset/force-change (Phase 6) are intentionally out of scope; the login route's `mfaRequired` branch and the `mustChangePassword` field are present but inert until their phases.
- **Type consistency:** `issueSession` returns `IssuedSession` consumed identically by bootstrap/login/refresh; cookie names come only from `cookies.ts` (`ACCESS_COOKIE`/`REFRESH_COOKIE`); `getAuthConfig()` is the single secret/TTL source; `decideRefresh` actions (`rotate`/`reuse_detected`/`invalid`) match the refresh route's handling.
- **No placeholders:** every code step contains complete, runnable code. (Task 17 specifies exact doc content to write rather than prose-only.)
- **Watch-list carried to later phases:** TOTP secret encryption-at-rest, per-process rate-limiter (needs shared store for multi-process), middleware Node-runtime dependency.
