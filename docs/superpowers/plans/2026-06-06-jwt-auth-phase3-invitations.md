# JWT Auth — Phase 3: Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin invite new users via single-use, expiring links — with no registration page and no email. An invitee opens the link, sets a username + password, and is logged in automatically.

**Architecture:** An `invites` repository (over the Phase 1 `invites` table) backs admin-only management routes (`/api/admin/invites`) and public accept routes (`/api/auth/invite/*`). Admin authorization is enforced by a `requireAdmin` helper and at the middleware layer for `/api/admin/*`. Single-use is guaranteed by an atomic conditional UPDATE, not check-then-write. Accepting an invite reuses the Phase 2 session machinery via a shared cookie helper.

**Tech Stack:** TypeScript, Next.js 16 (route handlers + middleware), Drizzle ORM + better-sqlite3, `zod`, `vitest`.

---

## Dependencies on Phases 1-2 (reuse, do not reimplement)

- `src/lib/auth/tokens.ts` — `generateToken`, `hashToken` (invite raw token + sha256-at-rest).
- `src/lib/auth/users.ts` — `createUser`, `getUserByUsername`, `Role`.
- `src/lib/auth/session.ts` — `issueSession`.
- `src/lib/auth/refreshStore.ts` — `saveRefresh`.
- `src/lib/auth/authConfig.ts` — `getAuthConfig`.
- `src/lib/auth/cookies.ts` — `ACCESS_COOKIE`, `REFRESH_COOKIE`, `buildCookieOptions`, `isSecureRequest`.
- `src/lib/auth/getAuthUser.ts` — `getAuthUser`, `AuthUser`.
- DB: `invites` table (id, tokenHash UNIQUE, role, createdBy, expiresAt, usedAt, usedBy, createdAt).

Route conventions: `Response.json`/`NextResponse.json`, try/catch + `console.error`, generic 500, `export const runtime = 'nodejs'`.

Spec: `docs/superpowers/specs/2026-06-06-jwt-auth-multiuser-design.md` (§6 invitations).

---

## Cross-cutting requirements (spec §10-11)

- **API docs:** Task 8 updates `docs/API/AUTH.md` with the invite endpoints.
- **UI:** the `/invite/[token]` page (Task 7) uses the same theme tokens / mobile pattern as the Phase 2 `BootstrapAdmin`/`Login` screens.

---

## File Structure (Phase 3)

- Create `src/lib/auth/sessionCookies.ts` — shared "issue session + set cookies on a response" helper (used by accept; available to existing routes later).
- Create `src/lib/auth/invites.ts` — invite repository (create/list/revoke/validate/consume).
- Modify `src/lib/auth/getAuthUser.ts` — add `requireAdmin`.
- Modify `src/middleware.ts` — enforce admin role on `/api/admin/*`.
- Create `src/app/api/admin/invites/route.ts` — POST (create), GET (list).
- Create `src/app/api/admin/invites/[id]/route.ts` — DELETE (revoke).
- Create `src/app/api/auth/invite/validate/route.ts` — POST (public, check a token).
- Create `src/app/api/auth/invite/accept/route.ts` — POST (public, consume + create user + login).
- Create `src/components/Auth/AcceptInvite.tsx` — set-account form.
- Create `src/app/invite/[token]/page.tsx` — invite landing page.
- Modify `src/app/layout.tsx` — exempt public page routes (`/invite`, `/login`) from the auth gate.
- Modify `docs/API/AUTH.md`.

---

## Task 1: Shared session-cookie helper

**Files:**
- Create `src/lib/auth/sessionCookies.ts`
- Test `src/lib/auth/__tests__/sessionCookies.test.ts`

Extracts the repeated "issue session, persist refresh, set both cookies on a NextResponse" logic so the accept route (and future routes) don't duplicate it.

- [ ] **Step 1: Write the failing test** — `src/lib/auth/__tests__/sessionCookies.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';

let mod: typeof import('../sessionCookies');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-sesscookie-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  process.env.JWT_SECRET = 'a-fixed-test-secret-at-least-32-bytes!!';
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: 'inherit',
  });
  mod = await import('../sessionCookies');
});

describe('issueSessionOnResponse', () => {
  it('sets httpOnly access + refresh cookies and persists the refresh row', async () => {
    const res = NextResponse.json({ ok: true });
    await mod.issueSessionOnResponse({
      res,
      user: { id: 'u-1', role: 'user', username: 'inv' },
      isSecure: false,
    });
    const setCookie = res.headers.getSetCookie();
    const joined = setCookie.join('\n');
    expect(joined).toMatch(/vane_access=/);
    expect(joined).toMatch(/vane_refresh=/);
    expect(joined.toLowerCase()).toContain('httponly');
    expect(joined.toLowerCase()).toContain('samesite=lax');

    // refresh row persisted (findable by the raw cookie value)
    const store = await import('../refreshStore');
    const refreshCookie = setCookie.find((c) => c.startsWith('vane_refresh='));
    const raw = decodeURIComponent(
      refreshCookie!.split(';')[0].split('=')[1],
    );
    const row = await store.findRefreshByToken(raw);
    expect(row?.userId).toBe('u-1');
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `yarn vitest run src/lib/auth/__tests__/sessionCookies.test.ts`.

- [ ] **Step 3: Implement** — `src/lib/auth/sessionCookies.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { issueSession } from './session';
import { saveRefresh } from './refreshStore';
import { getAuthConfig } from './authConfig';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  buildCookieOptions,
} from './cookies';

// Issue a session for `user`, persist its refresh row, and set both auth
// cookies on `res`. Shared by login/bootstrap/refresh/accept so cookie
// attributes and rotation handling stay identical everywhere.
export const issueSessionOnResponse = async (params: {
  res: NextResponse;
  user: { id: string; role: string; username: string };
  isSecure: boolean;
  forceSecure?: boolean;
}): Promise<void> => {
  const cfg = getAuthConfig();
  const session = await issueSession({
    user: params.user,
    secret: cfg.secret,
    accessTtlMin: cfg.accessTtlMin,
    refreshTtlDays: cfg.refreshTtlDays,
    now: Date.now(),
    refreshId: randomUUID(),
  });
  await saveRefresh({
    id: session.refreshRecord.id,
    userId: params.user.id,
    tokenHash: session.refreshRecord.tokenHash,
    expiresAt: session.refreshRecord.expiresAt,
  });

  const forceSecure =
    params.forceSecure ?? process.env.FORCE_SECURE_COOKIES === 'true';
  params.res.cookies.set(
    ACCESS_COOKIE,
    session.accessToken,
    buildCookieOptions({
      maxAgeSeconds: session.accessMaxAgeSec,
      isSecureRequest: params.isSecure,
      forceSecure,
    }),
  );
  params.res.cookies.set(
    REFRESH_COOKIE,
    session.refreshToken,
    buildCookieOptions({
      maxAgeSeconds: session.refreshMaxAgeSec,
      isSecureRequest: params.isSecure,
      forceSecure,
    }),
  );
};
```

- [ ] **Step 4: Run, verify PASS** (1 test).

> Note: if `res.headers.getSetCookie()` is unavailable in the test's Next/undici version, read cookies via `res.cookies.getAll()` instead and assert on names/options; report the adaptation. Do not weaken the httpOnly/sameSite assertions.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/sessionCookies.ts src/lib/auth/__tests__/sessionCookies.test.ts
git commit -m "feat(auth): add shared issue-session-on-response cookie helper"
```

---

## Task 2: Invite repository

**Files:**
- Create `src/lib/auth/invites.ts`
- Test `src/lib/auth/__tests__/invites.integration.test.ts`

Core security property: `consumeInvite` must be single-use via an atomic conditional UPDATE (`... WHERE id = ? AND usedAt IS NULL`), returning whether it won the race.

- [ ] **Step 1: Write the failing integration test** — `src/lib/auth/__tests__/invites.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let invites: typeof import('../invites');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-invites-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: 'inherit',
  });
  invites = await import('../invites');
});

describe('invite repository', () => {
  it('creates an invite and returns the raw token only once', async () => {
    const { rawToken, invite } = await invites.createInvite({
      role: 'user',
      ttlHours: 48,
      createdBy: 'admin-1',
    });
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(invite.role).toBe('user');
    expect(invite.usedAt).toBeNull();
  });

  it('validates a fresh token and rejects unknown/expired/used', async () => {
    const { rawToken } = await invites.createInvite({ role: 'user', ttlHours: 48, createdBy: 'a' });
    const v = await invites.validateInvite(rawToken);
    expect(v.valid).toBe(true);
    const bad = await invites.validateInvite('not-a-real-token');
    expect(bad.valid).toBe(false);

    const { rawToken: expiredTok } = await invites.createInvite({ role: 'user', ttlHours: -1, createdBy: 'a' });
    expect((await invites.validateInvite(expiredTok)).valid).toBe(false);
  });

  it('consumes single-use: second consume of the same token fails', async () => {
    const { rawToken } = await invites.createInvite({ role: 'admin', ttlHours: 48, createdBy: 'a' });
    const first = await invites.consumeInvite(rawToken, 'new-user-1');
    expect(first.ok).toBe(true);
    expect(first.role).toBe('admin');
    const second = await invites.consumeInvite(rawToken, 'new-user-2');
    expect(second.ok).toBe(false);
  });

  it('lists invites without exposing token hashes as raw tokens, and revokes', async () => {
    const { invite } = await invites.createInvite({ role: 'user', ttlHours: 48, createdBy: 'a' });
    const list = await invites.listInvites();
    expect(list.find((i) => i.id === invite.id)).toBeTruthy();
    await invites.revokeInvite(invite.id);
    const after = await invites.validateInviteById(invite.id);
    expect(after?.usedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — `src/lib/auth/invites.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq, and, isNull, sql } from 'drizzle-orm';
import db from '@/lib/db';
import { invites } from '@/lib/db/schema';
import { generateToken, hashToken } from './tokens';
import type { Role } from './users';

export interface InviteRow {
  id: string;
  role: Role;
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  createdAt: string;
}

export const createInvite = async (input: {
  role: Role;
  ttlHours: number;
  createdBy: string;
}): Promise<{ rawToken: string; invite: InviteRow }> => {
  const rawToken = generateToken();
  const id = randomUUID();
  const nowMs = Date.now();
  const expiresAt = new Date(nowMs + input.ttlHours * 3600 * 1000).toISOString();
  const createdAt = new Date(nowMs).toISOString();
  await db.insert(invites).values({
    id,
    tokenHash: hashToken(rawToken),
    role: input.role,
    createdBy: input.createdBy,
    expiresAt,
    createdAt,
  });
  return {
    rawToken,
    invite: {
      id,
      role: input.role,
      createdBy: input.createdBy,
      expiresAt,
      usedAt: null,
      usedBy: null,
      createdAt,
    },
  };
};

const findByToken = (rawToken: string) =>
  db.query.invites.findFirst({
    where: eq(invites.tokenHash, hashToken(rawToken)),
  });

export type ValidateResult =
  | { valid: true; role: Role }
  | { valid: false; reason: 'unknown' | 'used' | 'expired' };

export const validateInvite = async (
  rawToken: string,
): Promise<ValidateResult> => {
  const row = await findByToken(rawToken);
  if (!row) return { valid: false, reason: 'unknown' };
  if (row.usedAt) return { valid: false, reason: 'used' };
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, role: row.role as Role };
};

// Atomic single-use claim: only succeeds if the invite is still unused AND
// unexpired. Returns the invite's role on success.
export const consumeInvite = async (
  rawToken: string,
  usedBy: string,
): Promise<{ ok: true; role: Role } | { ok: false }> => {
  const row = await findByToken(rawToken);
  if (!row) return { ok: false };
  if (new Date(row.expiresAt).getTime() <= Date.now()) return { ok: false };

  const result = await db
    .update(invites)
    .set({ usedAt: new Date().toISOString(), usedBy })
    .where(and(eq(invites.id, row.id), isNull(invites.usedAt)));
  const changes = (result as unknown as { changes?: number }).changes ?? 0;
  if (changes !== 1) return { ok: false };
  return { ok: true, role: row.role as Role };
};

export const listInvites = async (): Promise<InviteRow[]> => {
  const rows = await db
    .select({
      id: invites.id,
      role: invites.role,
      createdBy: invites.createdBy,
      expiresAt: invites.expiresAt,
      usedAt: invites.usedAt,
      usedBy: invites.usedBy,
      createdAt: invites.createdAt,
    })
    .from(invites)
    .orderBy(sql`${invites.createdAt} DESC`);
  return rows as InviteRow[];
};

// Revoke an unused invite by marking it used (a used invite can never be
// redeemed). No-op on an already-used invite.
export const revokeInvite = async (id: string): Promise<void> => {
  await db
    .update(invites)
    .set({ usedAt: new Date().toISOString(), usedBy: 'revoked' })
    .where(and(eq(invites.id, id), isNull(invites.usedAt)));
};

export const validateInviteById = (id: string) =>
  db.query.invites.findFirst({ where: eq(invites.id, id) });
```

- [ ] **Step 4: Run, verify PASS** (4 tests). If the `consumeInvite` update `changes` shape differs from the merged `users.ts`/`refreshStore.ts` pattern, match whatever those use (they read `.changes`); report any difference.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/invites.ts src/lib/auth/__tests__/invites.integration.test.ts
git commit -m "feat(auth): add invite repository with atomic single-use consume"
```

---

## Task 3: requireAdmin + middleware admin guard + pathname propagation

**Files:**
- Modify `src/lib/auth/getAuthUser.ts`
- Modify `src/middleware.ts`

This task also makes the middleware inject the request pathname as a header so
the root-layout auth gate (Task 7) can exempt public page routes (`/invite/*`,
`/login`). Without this, an unauthenticated invitee hitting `/invite/<token>`
would be shown the Login screen by the layout gate instead of the accept form.

- [ ] **Step 1: Add `requireAdmin` to `src/lib/auth/getAuthUser.ts`.** After the existing `requireAuth` export, add:

```ts
// Returns the user when they are an admin, otherwise a 401/403 Response.
export const requireAdmin = async (
  req: NextRequest,
): Promise<AuthUser | Response> => {
  const user = await getAuthUser(req);
  if (!user) return Response.json({ message: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') {
    return Response.json({ message: 'Forbidden' }, { status: 403 });
  }
  return user;
};
```

- [ ] **Step 2: Replace the entire contents of `src/middleware.ts`** with the version below. It (a) propagates the pathname to server components on every request, (b) keeps the API guard + setup-phase bypass, and (c) adds the `/api/admin/*` role check:

```ts
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
```

- [ ] **Step 3: Typecheck + build.** `yarn tsc --noEmit` (exit 0) and `yarn build 2>&1 | tail -15` (completes; middleware still registered). The broadened matcher means middleware runs on page navigations now — confirm no build error.

- [ ] **Step 4: Commit.**

```bash
git add src/lib/auth/getAuthUser.ts src/middleware.ts
git commit -m "feat(auth): admin authz + propagate pathname for layout public-route gating"
```

---

## Task 4: Admin invite routes (create + list)

**Files:**
- Create `src/app/api/admin/invites/route.ts`

- [ ] **Step 1: Implement** — `src/app/api/admin/invites/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { createInvite, listInvites } from '@/lib/auth/invites';

export const runtime = 'nodejs';

const createSchema = z.object({
  role: z.enum(['admin', 'user']).optional().default('user'),
  ttlHours: z.number().int().min(1).max(720).optional().default(48),
});

export const POST = async (req: NextRequest) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'Invalid invite options.' }, { status: 400 });
    }

    const { rawToken, invite } = await createInvite({
      role: parsed.data.role,
      ttlHours: parsed.data.ttlHours,
      createdBy: auth.id,
    });

    const origin = req.nextUrl.origin;
    return Response.json(
      { invite, link: `${origin}/invite/${rawToken}` },
      { status: 201 },
    );
  } catch (err) {
    console.error('Error creating invite: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};

export const GET = async (req: NextRequest) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const list = await listInvites();
    const now = Date.now();
    const withStatus = list.map((i) => ({
      ...i,
      status: i.usedAt
        ? 'used'
        : new Date(i.expiresAt).getTime() <= now
          ? 'expired'
          : 'pending',
    }));
    return Response.json({ invites: withStatus }, { status: 200 });
  } catch (err) {
    console.error('Error listing invites: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit`.

- [ ] **Step 3: Commit.**

```bash
git add src/app/api/admin/invites/route.ts
git commit -m "feat(auth): add admin invite create/list routes"
```

---

## Task 5: Admin invite revoke route

**Files:**
- Create `src/app/api/admin/invites/[id]/route.ts`

- [ ] **Step 1: Implement** — `src/app/api/admin/invites/[id]/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { revokeInvite } from '@/lib/auth/invites';

export const runtime = 'nodejs';

export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    await revokeInvite(id);
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Error revoking invite: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit`.

- [ ] **Step 3: Commit.**

```bash
git add 'src/app/api/admin/invites/[id]/route.ts'
git commit -m "feat(auth): add admin invite revoke route"
```

---

## Task 6: Public invite validate + accept routes

**Files:**
- Create `src/app/api/auth/invite/validate/route.ts`
- Create `src/app/api/auth/invite/accept/route.ts`

These are under `/api/auth/` so the middleware leaves them public (no session yet).

- [ ] **Step 1: Implement validate** — `src/app/api/auth/invite/validate/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { validateInvite } from '@/lib/auth/invites';

export const runtime = 'nodejs';

const schema = z.object({ token: z.string().min(1) });

export const POST = async (req: NextRequest) => {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ valid: false }, { status: 200 });
    }
    const result = await validateInvite(parsed.data.token);
    return Response.json(result, { status: 200 });
  } catch (err) {
    console.error('Error validating invite: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Implement accept** — `src/app/api/auth/invite/accept/route.ts`:

```ts
import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import { consumeInvite } from '@/lib/auth/invites';
import { createUser, getUserByUsername } from '@/lib/auth/users';
import { issueSessionOnResponse } from '@/lib/auth/sessionCookies';
import { isSecureRequest } from '@/lib/auth/cookies';

export const runtime = 'nodejs';

const schema = z.object({
  token: z.string().min(1),
  username: z.string().min(3).max(64),
  password: z.string().min(10).max(200),
});

export const POST = async (req: NextRequest) => {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json(
        { message: 'Username (3-64) and password (10-200) required.' },
        { status: 400 },
      );
    }
    const { token, username, password } = parsed.data;

    // Reject duplicate username before consuming the invite.
    if (await getUserByUsername(username)) {
      return Response.json({ message: 'Username already taken.' }, { status: 409 });
    }

    // Atomic single-use claim. If this fails the invite is used/expired/unknown.
    // We claim with a placeholder, then create the user and attach its id.
    const claim = await consumeInvite(token, username);
    if (!claim.ok) {
      return Response.json(
        { message: 'This invitation is invalid or has already been used.' },
        { status: 400 },
      );
    }

    const user = await createUser({ username, password, role: claim.role });

    const res = NextResponse.json({ user }, { status: 201 });
    await issueSessionOnResponse({
      res,
      user: { id: user.id, role: user.role, username: user.username },
      isSecure: isSecureRequest(req.headers.get('x-forwarded-proto')),
    });
    return res;
  } catch (err) {
    console.error('Error accepting invite: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

> Note on `usedBy`: the invite is consumed with `username` as the `usedBy` marker (the user id doesn't exist until `createUser`). This is acceptable — `usedBy` is an audit field, and username is unique. If you prefer the user id, create the user first then consume; but creating-first risks an orphan user if the invite turns out already-used, so consume-first (as written) is the safer ordering.

- [ ] **Step 3: Typecheck.** `yarn tsc --noEmit`.

- [ ] **Step 4: Commit.**

```bash
git add src/app/api/auth/invite/validate/route.ts src/app/api/auth/invite/accept/route.ts
git commit -m "feat(auth): add public invite validate and accept routes"
```

---

## Task 7: Invite landing page + AcceptInvite component

**Files:**
- Create `src/components/Auth/AcceptInvite.tsx`
- Create `src/app/invite/[token]/page.tsx`

- [ ] **Step 1: Implement** — `src/components/Auth/AcceptInvite.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';

const AcceptInvite = ({ token }: { token: string }) => {
  const [state, setState] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/invite/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        setState(data.valid ? 'valid' : 'invalid');
      } catch {
        setState('invalid');
      }
    })();
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) {
      toast.error('Password must be at least 10 characters.');
      return;
    }
    try {
      setSubmitting(true);
      const res = await fetch('/api/auth/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to accept invitation');
      }
      window.location.href = '/';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to accept invitation');
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-light-primary dark:bg-dark-primary h-screen w-screen fixed inset-0 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-light-primary dark:bg-dark-primary border border-light-200 dark:border-dark-200 rounded-xl shadow-sm p-6 flex flex-col space-y-5">
        <div className="flex flex-col items-center text-center space-y-2">
          <UserPlus className="w-8 h-8 text-[#24A0ED]" />
          <h1 className="text-lg font-medium text-black dark:text-white">
            Accept your invitation
          </h1>
        </div>

        {state === 'checking' && (
          <p className="text-center text-xs text-black/50 dark:text-white/50">
            Checking invitation…
          </p>
        )}

        {state === 'invalid' && (
          <p className="text-center text-sm text-black/70 dark:text-white/70">
            This invitation is invalid, expired, or has already been used. Ask an
            admin for a new link.
          </p>
        )}

        {state === 'valid' && (
          <form onSubmit={submit} className="flex flex-col space-y-5">
            <input
              type="text"
              autoComplete="username"
              aria-label="Username"
              autoFocus
              placeholder="Choose a username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              className="w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]"
            />
            <input
              type="password"
              autoComplete="new-password"
              aria-label="Password"
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
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default AcceptInvite;
```

- [ ] **Step 2: Implement** — `src/app/invite/[token]/page.tsx`:

```tsx
import AcceptInvite from '@/components/Auth/AcceptInvite';

export const dynamic = 'force-dynamic';

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <AcceptInvite token={token} />;
}
```

- [ ] **Step 3: Exempt public page routes in the layout gate.** Modify `src/app/layout.tsx` so unauthenticated visitors can reach `/invite/*` and `/login`. Add `import { headers } from 'next/headers';` (alongside the existing `cookies` import). In `RootLayout`, after computing `authed`, read the pathname header injected by the middleware and treat invite/login as public:

```tsx
  const pathname = (await headers()).get('x-vane-pathname') || '';
  const isPublicPage =
    pathname.startsWith('/invite') || pathname === '/login';
```

Then change the gate's login branch so it does NOT intercept public pages:

```tsx
    if (!setupComplete) return <SetupWizard configSections={configSections} />;
    if (userCount === 0) return <BootstrapAdmin />;
    if (!authed && !isPublicPage) return <Login />;
    if (!authed && isPublicPage) return children; // /invite or /login render bare
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
```

(Keep the exact existing `<Toaster>` className string if it differs.)

- [ ] **Step 4: Typecheck + build.** `yarn tsc --noEmit` (exit 0) and `yarn build 2>&1 | tail -15` (completes; `/invite/[token]` appears in the route list).

- [ ] **Step 5: Commit.**

```bash
git add src/components/Auth/AcceptInvite.tsx 'src/app/invite/[token]/page.tsx' src/app/layout.tsx
git commit -m "feat(auth): add invite landing page, accept form, and public-route layout gate"
```

---

## Task 8: API documentation

**Files:**
- Modify `docs/API/AUTH.md`

- [ ] **Step 1: Add an "Invitations" section** to `docs/API/AUTH.md` (same style as the rest of the file), documenting each endpoint with method+path, full URL, purpose, request body + params, response examples, auth requirement, and status codes:

  - **POST `/api/admin/invites`** (admin only) — body `{role?: 'user'|'admin' (default 'user'), ttlHours?: 1-720 (default 48)}`; 201 `{invite, link}` where `link` is `${origin}/invite/<rawToken>` (shown once); 400 invalid, 401 unauth, 403 non-admin.
  - **GET `/api/admin/invites`** (admin only) — 200 `{invites:[{id, role, createdBy, expiresAt, usedAt, usedBy, createdAt, status}]}` where status ∈ pending|used|expired. Never returns the raw token.
  - **DELETE `/api/admin/invites/:id`** (admin only) — 200 `{ok:true}`; revokes an unused invite.
  - **POST `/api/auth/invite/validate`** (public) — body `{token}`; 200 `{valid:true, role}` or `{valid:false, reason}`.
  - **POST `/api/auth/invite/accept`** (public) — body `{token, username (3-64), password (10-200)}`; 201 `{user}` + sets session cookies (auto-login); 400 invalid/used invite or bad input, 409 username taken.

  Note the admin-authorization rule: `/api/admin/*` requires an authenticated admin (401/403 otherwise), enforced at the middleware and in each route.

- [ ] **Step 2: Commit.**

```bash
git add docs/API/AUTH.md
git commit -m "docs(api): document invitation endpoints"
```

---

## Task 9: Full suite green + smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the suite + typecheck.** `yarn test` (all prior + new invite/sessionCookies tests pass) and `yarn tsc --noEmit` (exit 0).

- [ ] **Step 2: Smoke test** against a throwaway `DATA_DIR` dev server (same pattern as Phase 2 Task 18). Migrate a temp dir, `DATA_DIR=$TMP PORT=3111 yarn dev`, then:

```bash
# Bootstrap an admin and keep cookies
curl -s -c /tmp/inv.cookies -X POST localhost:3111/api/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"supersecret123"}' -w '\n[%{http_code}]\n'

# Non-admin / unauth cannot create invites
curl -s -X POST localhost:3111/api/admin/invites -H 'Content-Type: application/json' -d '{}' -w '\n[%{http_code}]\n'
# Expected: 401

# Admin creates an invite (capture the link's token)
curl -s -b /tmp/inv.cookies -X POST localhost:3111/api/admin/invites \
  -H 'Content-Type: application/json' -d '{"role":"user","ttlHours":48}' -w '\n[%{http_code}]\n'
# Expected: 201 with {"invite":...,"link":".../invite/<TOKEN>"}

# Validate the token (public) — expect {"valid":true,...}
TOKEN=<paste the token from the link>
curl -s -X POST localhost:3111/api/auth/invite/validate -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\"}" -w '\n[%{http_code}]\n'

# Accept the invite → creates user + logs in (sets cookies)
curl -s -c /tmp/inv2.cookies -X POST localhost:3111/api/auth/invite/accept \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"username\":\"bob\",\"password\":\"bobspassword123\"}" -w '\n[%{http_code}]\n'
# Expected: 201 with {"user":{...,"username":"bob","role":"user"}}

# Re-accepting the same token fails (single-use)
curl -s -X POST localhost:3111/api/auth/invite/accept -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"username\":\"carol\",\"password\":\"carolpassword123\"}" -w '\n[%{http_code}]\n'
# Expected: 400 (already used)

# New user session works
curl -s -b /tmp/inv2.cookies localhost:3111/api/auth/session -w '\n[%{http_code}]\n'
# Expected: 200 {"user":{...,"username":"bob"}}

# New (non-admin) user cannot create invites
curl -s -b /tmp/inv2.cookies -X POST localhost:3111/api/admin/invites \
  -H 'Content-Type: application/json' -d '{}' -w '\n[%{http_code}]\n'
# Expected: 403

# The invite page renders the accept UI while logged out
curl -s "localhost:3111/invite/$TOKEN" -o /dev/null -w '[%{http_code}]\n'
# Expected: 200 (HTML)
```

Record actual results. All must match. Stop the dev server and remove the temp dir afterward. Only kill the dev server you started (match its port/PID) — do not touch other processes.

- [ ] **Step 3: Commit (only if fixes were needed).**

```bash
git add -A
git commit -m "test(auth): verify phase 3 invitation flow"
```

---

## Self-Review Notes

- **Spec coverage (§6):** admin-only single-use expiring invites ✓; raw token only in the link, sha256-at-rest ✓; atomic single-use claim ✓; list/revoke ✓; public validate + accept (set username/password, auto-login) ✓; role carried from invite ✓; admin authorization (requireAdmin + middleware) ✓; `docs/API/AUTH.md` ✓.
- **Type consistency:** `Role` reused from `users.ts`; `consumeInvite`/`validateInvite` result shapes match their tests; accept route reuses `issueSessionOnResponse` (Task 1) so cookie attributes match login/bootstrap exactly.
- **Security:** consume is atomic (`WHERE id=? AND usedAt IS NULL`, asserts `changes===1`); duplicate-username checked before consume; consume-before-createUser avoids orphan users; admin routes guarded twice (middleware + requireAdmin); validate distinguishes reason for UX but accept returns a single generic "invalid or used" message.
- **Watch-list to Phase 4+:** invite-accept is not rate-limited (a leaked-but-unused token could be brute-force *guessed* — but tokens are 256-bit, so infeasible; note only). Per-user data scoping still pending (Phase 5): invited users currently see all data once logged in.
- **Public-route gating:** the root-layout auth gate previously rendered Login for ALL unauthenticated requests; Task 3 propagates the pathname via a middleware header and Task 7 exempts `/invite/*` and `/login` so invitees can reach the accept form while logged out.
- **No placeholders:** every code step contains complete, runnable code.
