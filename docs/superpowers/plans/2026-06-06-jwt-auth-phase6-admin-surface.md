# JWT Auth — Phase 6: Admin Surface + Password Reset + Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a real management surface (list/disable/delete users, reset a user's password and 2FA, generate/revoke invites, toggle org-wide require-2FA), let users change their own password, force a password change after an admin reset, and close the security hardening items accumulated across Phases 3-5.

**Architecture:** User-management repository functions back admin-only routes under `/api/admin/users/*` and a self-service `/api/account/password`. A `mustChangePassword` gate (layout) forces a change after an admin reset. The admin panel UI (`/admin`) mirrors the existing `SettingsDialogue` layout. Hardening: rate-limit the remaining sensitive routes, enforce `requireTwoFactor` at the API layer, and document the message-write ownership invariant.

**Tech Stack:** TypeScript, Next.js 16, Drizzle + better-sqlite3, `vitest`, React.

---

## Dependencies on Phases 1-5 (reuse)

- `src/lib/auth/users.ts` — `getUserById`, `getUserByUsername`, `createUser`, `countUsers`, `PublicUser`, `Role`.
- `src/lib/auth/password.ts` — `hashPassword`, `verifyPassword`.
- `src/lib/auth/refreshStore.ts` — `revokeAllForUser` (force re-login on password reset/change).
- `src/lib/auth/sessionCookies.ts` — `issueSessionOnResponse` (re-issue the caller's session after self password change).
- `src/lib/auth/twoFactor.ts` — `disableTwoFactor` (admin reset; route already exists at `/api/admin/users/[id]/2fa/reset`).
- `src/lib/auth/getAuthUser.ts` — `getAuthUser`, `requireAuth`, `requireAdmin`.
- `src/lib/auth/invites.ts` — `createInvite`, `listInvites`, `revokeInvite` (admin invite APIs already exist; this phase adds their UI).
- `src/lib/auth/rateLimit.ts` — `createRateLimiter`.
- `src/lib/auth/cookies.ts` — `isSecureRequest`, `ACCESS_COOKIE`, `REFRESH_COOKIE`.
- `configManager` — `getConfig`/`updateConfig` for `auth.requireTwoFactor`.
- `users.mustChangePassword` column (Phase 1) already exists. **No migration needed.**

Spec: `docs/superpowers/specs/2026-06-06-jwt-auth-multiuser-design.md` (§8 admin surface, §6/§9 password reset + force-change).

---

## File Structure (Phase 6)

- Modify `src/lib/auth/users.ts` — `listUsers`, `setUserDisabled`, `deleteUser`, `adminSetPassword`, `changeOwnPassword`.
- Create `src/app/api/account/password/route.ts` — self password change.
- Create `src/app/api/admin/users/route.ts` — GET list.
- Create `src/app/api/admin/users/[id]/route.ts` — DELETE user.
- Create `src/app/api/admin/users/[id]/disable/route.ts` — POST enable/disable.
- Create `src/app/api/admin/users/[id]/password/reset/route.ts` — POST admin reset.
- Create `src/app/api/admin/settings/route.ts` — GET/POST `requireTwoFactor`.
- Modify `src/middleware.ts` — enforce `requireTwoFactor` at the API layer.
- Modify `src/app/api/account/2fa/enable/route.ts` + `disable/route.ts` — add rate limiting.
- Modify `src/app/api/auth/invite/accept/route.ts` — add rate limiting.
- Modify `src/lib/agents/search/index.ts` — document the ownership invariant (comment only).
- Modify `src/app/layout.tsx` — `mustChangePassword` gate.
- Create `src/components/Auth/ForcePasswordChange.tsx`, `src/components/Account/PasswordSection.tsx`; modify `src/components/Account/AccountView.tsx`.
- Create `src/components/Admin/AdminPanel.tsx`, `src/app/admin/page.tsx`; modify `src/components/Sidebar.tsx` (admin link).
- Modify `docs/API/AUTH.md`.

---

## Task 1: User-management repository functions

**Files:**
- Modify `src/lib/auth/users.ts`
- Test `src/lib/auth/__tests__/userAdmin.integration.test.ts`

- [ ] **Step 1: Write the failing integration test** — `src/lib/auth/__tests__/userAdmin.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let users: typeof import('../users');
let password: typeof import('../password');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-useradmin-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: 'inherit',
  });
  users = await import('../users');
  password = await import('../password');
});

describe('user admin repository', () => {
  it('lists users as public shapes (no passwordHash)', async () => {
    await users.createUser({ username: 'u1', password: 'password-1234', role: 'admin' });
    await users.createUser({ username: 'u2', password: 'password-1234', role: 'user' });
    const list = await users.listUsers();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const u1 = list.find((u) => u.username === 'u1')!;
    expect(u1.role).toBe('admin');
    expect((u1 as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it('disables and re-enables a user', async () => {
    const u = await users.createUser({ username: 'd1', password: 'password-1234', role: 'user' });
    await users.setUserDisabled(u.id, true);
    expect((await users.getUserById(u.id))?.disabled).toBe(true);
    await users.setUserDisabled(u.id, false);
    expect((await users.getUserById(u.id))?.disabled).toBe(false);
  });

  it('admin-resets a password (sets hash + mustChangePassword)', async () => {
    const u = await users.createUser({ username: 'p1', password: 'password-1234', role: 'user' });
    await users.adminSetPassword(u.id, 'temp-password-9999');
    const row = await users.getUserById(u.id);
    expect(row?.mustChangePassword).toBe(true);
    expect(await password.verifyPassword(row!.passwordHash, 'temp-password-9999')).toBe(true);
  });

  it('changeOwnPassword verifies the current password and clears the flag', async () => {
    const u = await users.createUser({ username: 'c1', password: 'old-password-1234', role: 'user' });
    await users.adminSetPassword(u.id, 'temp-password-9999'); // sets mustChangePassword
    const bad = await users.changeOwnPassword(u.id, 'wrong', 'new-password-1234');
    expect(bad).toBe(false);
    const ok = await users.changeOwnPassword(u.id, 'temp-password-9999', 'new-password-1234');
    expect(ok).toBe(true);
    const row = await users.getUserById(u.id);
    expect(row?.mustChangePassword).toBe(false);
    expect(await password.verifyPassword(row!.passwordHash, 'new-password-1234')).toBe(true);
  });

  it('deletes a user', async () => {
    const u = await users.createUser({ username: 'del1', password: 'password-1234', role: 'user' });
    await users.deleteUser(u.id);
    expect(await users.getUserById(u.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `yarn vitest run src/lib/auth/__tests__/userAdmin.integration.test.ts`.

- [ ] **Step 3: Append to `src/lib/auth/users.ts`** (keep existing exports; add these). Ensure `verifyPassword` is imported alongside the existing `hashPassword` import (`import { hashPassword, verifyPassword } from './password';`):

```ts
export const listUsers = async (): Promise<PublicUser[]> => {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      disabled: users.disabled,
      totpEnabled: users.totpEnabled,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .orderBy(users.username);
  return rows as PublicUser[];
};

export const setUserDisabled = async (
  id: string,
  disabled: boolean,
): Promise<void> => {
  await db
    .update(users)
    .set({ disabled, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id));
};

export const deleteUser = async (id: string): Promise<void> => {
  await db.delete(users).where(eq(users.id, id));
};

// Admin reset: set a new password hash and force the user to change it next login.
export const adminSetPassword = async (
  id: string,
  newPassword: string,
): Promise<void> => {
  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: true, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id));
};

// Self change: verify the current password, set the new one, clear the flag.
export const changeOwnPassword = async (
  id: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> => {
  const u = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!u) return false;
  if (!(await verifyPassword(u.passwordHash, currentPassword))) return false;
  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id));
  return true;
};
```

- [ ] **Step 4: Run, verify PASS** (5 tests). `yarn tsc --noEmit` (exit 0).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/users.ts src/lib/auth/__tests__/userAdmin.integration.test.ts
git commit -m "feat(auth): add user-management repository functions"
```

---

## Task 2: Self password-change route

**Files:**
- Create `src/app/api/account/password/route.ts`

Verifies the current password, sets the new one (clearing `mustChangePassword`), revokes all the user's refresh tokens, then re-issues a fresh session for the caller (so they stay logged in but other sessions are killed).

- [ ] **Step 1: Implement** — `src/app/api/account/password/route.ts`:

```ts
import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/getAuthUser';
import { getUserById, changeOwnPassword } from '@/lib/auth/users';
import { revokeAllForUser } from '@/lib/auth/refreshStore';
import { issueSessionOnResponse } from '@/lib/auth/sessionCookies';
import { isSecureRequest } from '@/lib/auth/cookies';

export const runtime = 'nodejs';

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(200),
});

export const POST = async (req: NextRequest) => {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json(
        { message: 'Current password and a new password (min 10) are required.' },
        { status: 400 },
      );
    }

    const ok = await changeOwnPassword(
      auth.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    if (!ok) {
      return Response.json({ message: 'Current password is incorrect.' }, { status: 401 });
    }

    // Kill all sessions (including the current refresh token), then re-issue a
    // fresh session for this caller so they remain logged in on this device.
    await revokeAllForUser(auth.id);
    const user = await getUserById(auth.id);

    const res = NextResponse.json({ ok: true }, { status: 200 });
    if (user) {
      await issueSessionOnResponse({
        res,
        user: { id: user.id, role: user.role, username: user.username },
        isSecure: isSecureRequest(req.headers.get('x-forwarded-proto')),
      });
    }
    return res;
  } catch (err) {
    console.error('Error changing password: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit.**

```bash
git add src/app/api/account/password/route.ts
git commit -m "feat(auth): add self password-change route with session rotation"
```

---

## Task 3: Admin user list + delete + disable routes

**Files:**
- Create `src/app/api/admin/users/route.ts`
- Create `src/app/api/admin/users/[id]/route.ts`
- Create `src/app/api/admin/users/[id]/disable/route.ts`

Admins must not lock themselves out, so disable/delete refuse to act on the caller's own id.

- [ ] **Step 1: list** — `src/app/api/admin/users/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { listUsers } from '@/lib/auth/users';

export const runtime = 'nodejs';

export const GET = async (req: NextRequest) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const list = await listUsers();
    return Response.json({ users: list }, { status: 200 });
  } catch (err) {
    console.error('Error listing users: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: delete** — `src/app/api/admin/users/[id]/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { getUserById, deleteUser } from '@/lib/auth/users';
import { revokeAllForUser } from '@/lib/auth/refreshStore';

export const runtime = 'nodejs';

export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const { id } = await params;
    if (id === auth.id) {
      return Response.json({ message: 'You cannot delete your own account.' }, { status: 400 });
    }
    const target = await getUserById(id);
    if (!target) {
      return Response.json({ message: 'User not found.' }, { status: 404 });
    }

    await revokeAllForUser(id); // kill their sessions
    await deleteUser(id);
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Error deleting user: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 3: disable** — `src/app/api/admin/users/[id]/disable/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { getUserById, setUserDisabled } from '@/lib/auth/users';
import { revokeAllForUser } from '@/lib/auth/refreshStore';

export const runtime = 'nodejs';

const schema = z.object({ disabled: z.boolean() });

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const { id } = await params;
    if (id === auth.id) {
      return Response.json({ message: 'You cannot disable your own account.' }, { status: 400 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'disabled (boolean) required.' }, { status: 400 });
    }
    const target = await getUserById(id);
    if (!target) {
      return Response.json({ message: 'User not found.' }, { status: 404 });
    }

    await setUserDisabled(id, parsed.data.disabled);
    if (parsed.data.disabled) await revokeAllForUser(id); // kick out on disable
    return Response.json({ ok: true, disabled: parsed.data.disabled }, { status: 200 });
  } catch (err) {
    console.error('Error setting user disabled: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 4: Typecheck.** `yarn tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit.**

```bash
git add src/app/api/admin/users/route.ts 'src/app/api/admin/users/[id]/route.ts' 'src/app/api/admin/users/[id]/disable/route.ts'
git commit -m "feat(auth): add admin user list/delete/disable routes with self-lockout guards"
```

---

## Task 4: Admin password-reset route

**Files:**
- Create `src/app/api/admin/users/[id]/password/reset/route.ts`

Generates a temporary password (returned once), sets it with `mustChangePassword`, and revokes the target's sessions.

- [ ] **Step 1: Implement** — `src/app/api/admin/users/[id]/password/reset/route.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { getUserById, adminSetPassword } from '@/lib/auth/users';
import { revokeAllForUser } from '@/lib/auth/refreshStore';

export const runtime = 'nodejs';

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const { id } = await params;
    const target = await getUserById(id);
    if (!target) {
      return Response.json({ message: 'User not found.' }, { status: 404 });
    }

    // 18 bytes base64url ≈ 24 chars — comfortably above the 10-char minimum.
    const tempPassword = randomBytes(18).toString('base64url');
    await adminSetPassword(id, tempPassword);
    await revokeAllForUser(id);

    return Response.json({ tempPassword }, { status: 200 });
  } catch (err) {
    console.error('Error resetting password: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit.**

```bash
git add 'src/app/api/admin/users/[id]/password/reset/route.ts'
git commit -m "feat(auth): add admin password-reset route (temp password + force change)"
```

---

## Task 5: Admin settings route (require-2FA toggle)

**Files:**
- Create `src/app/api/admin/settings/route.ts`

- [ ] **Step 1: Implement** — `src/app/api/admin/settings/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import configManager from '@/lib/config';
import { requireAdmin } from '@/lib/auth/getAuthUser';

export const runtime = 'nodejs';

export const GET = async (req: NextRequest) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    return Response.json(
      { requireTwoFactor: Boolean(configManager.getConfig('auth.requireTwoFactor', false)) },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error reading admin settings: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};

const schema = z.object({ requireTwoFactor: z.boolean() });

export const POST = async (req: NextRequest) => {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'requireTwoFactor (boolean) required.' }, { status: 400 });
    }
    configManager.updateConfig('auth.requireTwoFactor', parsed.data.requireTwoFactor);
    return Response.json({ requireTwoFactor: parsed.data.requireTwoFactor }, { status: 200 });
  } catch (err) {
    console.error('Error updating admin settings: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit.**

```bash
git add src/app/api/admin/settings/route.ts
git commit -m "feat(auth): add admin settings route for require-2FA toggle"
```

---

## Task 6: mustChangePassword gate + password-change UI

**Files:**
- Modify `src/app/layout.tsx`
- Create `src/components/Account/PasswordSection.tsx`
- Create `src/components/Auth/ForcePasswordChange.tsx`
- Modify `src/components/Account/AccountView.tsx`

- [ ] **Step 1: `PasswordSection.tsx`** (self change form; `forced` variant only needs the new password + current/temp):

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';

const PasswordSection = ({ forced = false }: { forced?: boolean }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 10) {
      toast.error('New password must be at least 10 characters.');
      return;
    }
    try {
      setBusy(true);
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || 'Failed to change password');
      }
      toast.success('Password changed.');
      window.location.href = '/';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password');
      setBusy(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]';

  return (
    <form onSubmit={submit} className="flex flex-col space-y-3">
      <input type="password" autoComplete="current-password" aria-label="Current password" placeholder={forced ? 'Temporary password' : 'Current password'} value={current} onChange={(e) => setCurrent(e.target.value)} required className={inputCls} />
      <input type="password" autoComplete="new-password" aria-label="New password" placeholder="New password (min 10 chars)" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} className={inputCls} />
      <button type="submit" disabled={busy} className="px-4 py-2.5 rounded-lg bg-[#24A0ED] text-white hover:bg-[#1e8fd1] active:scale-95 transition-all duration-200 font-medium text-sm disabled:opacity-50">
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
};

export default PasswordSection;
```

- [ ] **Step 2: `ForcePasswordChange.tsx`** (full-screen, like Force2FA):

```tsx
'use client';

import { KeyRound } from 'lucide-react';
import PasswordSection from '../Account/PasswordSection';

const ForcePasswordChange = () => (
  <div className="bg-light-primary dark:bg-dark-primary h-screen w-screen fixed inset-0 flex items-center justify-center px-4">
    <div className="w-full max-w-sm bg-light-primary dark:bg-dark-primary border border-light-200 dark:border-dark-200 rounded-xl shadow-sm p-6 flex flex-col space-y-5">
      <div className="flex flex-col items-center text-center space-y-2">
        <KeyRound className="w-8 h-8 text-[#24A0ED]" />
        <h1 className="text-lg font-medium text-black dark:text-white">Set a new password</h1>
        <p className="text-xs text-black/50 dark:text-white/50">Your password was reset by an administrator. Choose a new one to continue.</p>
      </div>
      <PasswordSection forced />
    </div>
  </div>
);

export default ForcePasswordChange;
```

- [ ] **Step 3: Add the password section to `AccountView.tsx`.** Import `PasswordSection` and render it in a new bordered section (mirroring the 2FA section), e.g. above or below the two-factor section:

```tsx
      <section className="border border-light-200 dark:border-dark-200 rounded-xl p-5 flex flex-col space-y-4">
        <h2 className="text-sm font-medium text-black dark:text-white">Password</h2>
        <PasswordSection />
      </section>
```

(Add `import PasswordSection from './PasswordSection';` at the top of AccountView.tsx.)

- [ ] **Step 4: Gate in `src/app/layout.tsx`.** READ the current layout (Phase 4 loads `authedUser = { id, totpEnabled }` and computes `needsEnroll`). Extend `authedUser` to also carry `mustChangePassword`:

```tsx
        if (row && !row.disabled) {
          authedUser = {
            id: row.id,
            totpEnabled: row.totpEnabled,
            mustChangePassword: row.mustChangePassword,
          };
        }
```
(update the `authedUser` type annotation accordingly: `{ id: string; totpEnabled: boolean; mustChangePassword: boolean } | null`.)

Add `import ForcePasswordChange from '@/components/Auth/ForcePasswordChange';` and compute:

```tsx
  const needsPasswordChange =
    authed && authedUser!.mustChangePassword && !isPublicPage;
```

In `renderGate()`, insert the password gate BEFORE the 2FA enroll gate (a forced password change takes priority), and allow `/account` through so the user can act:

```tsx
    if (!authed && isPublicPage) return children;
    if (needsPasswordChange && pathname !== '/account') return <ForcePasswordChange />;
    if (needsEnroll && pathname !== '/account') return <Force2FA />;
    return ( /* app shell */ );
```

- [ ] **Step 5: Typecheck + build.** `yarn tsc --noEmit` (exit 0), `yarn build 2>&1 | tail -15`.

- [ ] **Step 6: Commit.**

```bash
git add src/app/layout.tsx src/components/Account/PasswordSection.tsx src/components/Auth/ForcePasswordChange.tsx src/components/Account/AccountView.tsx
git commit -m "feat(auth): add password change UI and force-change gate after admin reset"
```

---

## Task 7: Admin panel UI

**Files:**
- Create `src/components/Admin/AdminPanel.tsx`
- Create `src/app/admin/page.tsx`
- Modify `src/components/Sidebar.tsx`

- [ ] **Step 1: `AdminPanel.tsx`** — fetches users + invites + settings from the admin APIs (which 403 non-admins → show an "admins only" message), with actions. Use theme tokens, lucide, sonner, responsive single-column on mobile:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, Trash, Ban, KeyRound, UserPlus, RotateCcw } from 'lucide-react';

interface AdminUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  disabled: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
}
interface InviteRow {
  id: string;
  role: string;
  expiresAt: string;
  status: 'pending' | 'used' | 'expired';
}

const AdminPanel = () => {
  const [forbidden, setForbidden] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [requireTwoFactor, setRequireTwoFactor] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/users');
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      return;
    }
    setUsers((await res.json()).users);
    const inv = await fetch('/api/admin/invites');
    if (inv.ok) setInvites((await inv.json()).invites);
    const s = await fetch('/api/admin/settings');
    if (s.ok) setRequireTwoFactor((await s.json()).requireTwoFactor);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<Response>, okMsg: string) => {
    try {
      const res = await fn();
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || 'Action failed');
      }
      const data = await res.json().catch(() => ({}));
      toast.success(okMsg);
      await load();
      return data;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    }
  };

  if (forbidden) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center text-sm text-black/60 dark:text-white/60">
        This area is for administrators only.
      </div>
    );
  }

  const btn = 'p-2 rounded-lg hover:bg-light-secondary dark:hover:bg-dark-secondary text-black/60 dark:text-white/60';

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 flex flex-col space-y-8">
      <div className="flex items-center space-x-2">
        <ShieldCheck className="w-6 h-6 text-[#24A0ED]" />
        <h1 className="text-xl font-medium text-black dark:text-white">Administration</h1>
      </div>

      <section className="border border-light-200 dark:border-dark-200 rounded-xl p-5 flex flex-col space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-black dark:text-white">Require two-factor for everyone</h2>
          <button
            onClick={() =>
              act(
                () =>
                  fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ requireTwoFactor: !requireTwoFactor }),
                  }),
                'Updated',
              )
            }
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${requireTwoFactor ? 'bg-[#24A0ED] text-white' : 'border border-light-200 dark:border-dark-200 text-black/70 dark:text-white/70'}`}
          >
            {requireTwoFactor ? 'On' : 'Off'}
          </button>
        </div>
      </section>

      <section className="border border-light-200 dark:border-dark-200 rounded-xl p-5 flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-black dark:text-white">Invitations</h2>
          <button
            onClick={async () => {
              const data = await act(
                () =>
                  fetch('/api/admin/invites', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: 'user', ttlHours: 48 }),
                  }),
                'Invite created',
              );
              if (data?.link) {
                try {
                  await navigator.clipboard.writeText(data.link);
                  toast.success('Invite link copied');
                } catch {
                  toast.message(data.link);
                }
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#24A0ED] text-white text-sm font-medium"
          >
            <UserPlus size={15} /> New invite
          </button>
        </div>
        <div className="flex flex-col divide-y divide-light-200 dark:divide-dark-200">
          {invites.length === 0 && <p className="text-xs text-black/50 dark:text-white/50">No invites.</p>}
          {invites.map((i) => (
            <div key={i.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-black/70 dark:text-white/70">{i.role} · {i.status}</span>
              {i.status === 'pending' && (
                <button onClick={() => act(() => fetch(`/api/admin/invites/${i.id}`, { method: 'DELETE' }), 'Invite revoked')} className={btn} title="Revoke" aria-label="Revoke invite">
                  <Trash size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="border border-light-200 dark:border-dark-200 rounded-xl p-5 flex flex-col space-y-4">
        <h2 className="text-sm font-medium text-black dark:text-white">Users</h2>
        <div className="flex flex-col divide-y divide-light-200 dark:divide-dark-200">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between py-2.5 gap-3">
              <div className="min-w-0">
                <p className="text-sm text-black dark:text-white truncate">
                  {u.username}{' '}
                  <span className="text-xs text-black/40 dark:text-white/40">{u.role}{u.disabled ? ' · disabled' : ''}{u.totpEnabled ? ' · 2FA' : ''}</span>
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => act(() => fetch(`/api/admin/users/${u.id}/disable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: !u.disabled }) }), u.disabled ? 'Enabled' : 'Disabled')} className={btn} title={u.disabled ? 'Enable' : 'Disable'} aria-label="Toggle disabled">
                  <Ban size={16} className={u.disabled ? 'text-[#24A0ED]' : ''} />
                </button>
                {u.totpEnabled && (
                  <button onClick={() => act(() => fetch(`/api/admin/users/${u.id}/2fa/reset`, { method: 'POST' }), '2FA reset')} className={btn} title="Reset 2FA" aria-label="Reset 2FA">
                    <RotateCcw size={16} />
                  </button>
                )}
                <button onClick={async () => { const d = await act(() => fetch(`/api/admin/users/${u.id}/password/reset`, { method: 'POST' }), 'Password reset'); if (d?.tempPassword) { try { await navigator.clipboard.writeText(d.tempPassword); toast.success('Temp password copied'); } catch { toast.message(`Temp password: ${d.tempPassword}`); } } }} className={btn} title="Reset password" aria-label="Reset password">
                  <KeyRound size={16} />
                </button>
                <button onClick={() => { if (confirm(`Delete ${u.username}?`)) act(() => fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' }), 'User deleted'); }} className={btn} title="Delete" aria-label="Delete user">
                  <Trash size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default AdminPanel;
```

- [ ] **Step 2: `src/app/admin/page.tsx`:**

```tsx
import AdminPanel from '@/components/Admin/AdminPanel';

export const dynamic = 'force-dynamic';

export default function AdminPage() {
  return <AdminPanel />;
}
```

- [ ] **Step 3: Add an admin link to `src/components/Sidebar.tsx`.** READ it. It builds `navLinks` (Home/Discover/Library) and renders them. Add a client-side admin link that only shows for admins: near the top of the component, fetch the session role once:

```tsx
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((d) => setIsAdmin(d.user?.role === 'admin'))
      .catch(() => {});
  }, []);
```

Then add a conditional admin entry to the rendered links (in BOTH the desktop and mobile link maps, mirroring how `navLinks` are rendered) — a `Link` to `/admin` with the `ShieldCheck` (or `Shield`) lucide icon, rendered only when `isAdmin`. Match the existing nav link markup/classes exactly. Add the needed imports (`useState`, `useEffect` if not present; the icon from `lucide-react`).

> Note: Sidebar is a client component; confirm `'use client'` is at the top (it uses hooks already if it has interactivity — if not, add it, but check first to avoid breaking SSR assumptions).

- [ ] **Step 4: Typecheck + build.** `yarn tsc --noEmit` (exit 0), `yarn build 2>&1 | tail -15` (`/admin` route present).

- [ ] **Step 5: Commit.**

```bash
git add src/components/Admin/AdminPanel.tsx src/app/admin/page.tsx src/components/Sidebar.tsx
git commit -m "feat(auth): add admin panel UI (users, invites, require-2FA) with sidebar link"
```

---

## Task 8: Hardening — API enforcement of require-2FA + rate limits

**Files:**
- Modify `src/middleware.ts`
- Modify `src/app/api/account/2fa/enable/route.ts`, `src/app/api/account/2fa/disable/route.ts`
- Modify `src/app/api/auth/invite/accept/route.ts`
- Modify `src/lib/agents/search/index.ts` (comment only)

- [ ] **Step 1: Enforce require-2FA at the API layer in `src/middleware.ts`.** READ it. After the existing auth + admin checks (where `user` is known), add: when `auth.requireTwoFactor` is on and the user has not enrolled, block data APIs (allow only `/api/auth/*`, `/api/account/*`, and `/api/admin/users/.../2fa/reset` is admin-only anyway). The middleware runs in node runtime and can read config + DB:

```ts
import configManager from '@/lib/config';
import { getUserById } from '@/lib/auth/users';
// ... inside middleware, after `const user = await getAuthUser(req)` and the null/admin checks:
  if (
    pathname.startsWith('/api/') &&
    !pathname.startsWith('/api/account/') &&
    Boolean(configManager.getConfig('auth.requireTwoFactor', false))
  ) {
    const row = await getUserById(user.id);
    if (row && !row.totpEnabled) {
      return Response.json({ message: 'Two-factor enrollment required.' }, { status: 403 });
    }
  }
```

(Place it so `/api/auth/*` — already returned via PUBLIC_API — and `/api/account/*` stay reachable for enrollment. This adds a DB read per guarded API request only when require-2FA is enabled.)

- [ ] **Step 2: Rate-limit `account/2fa/enable` and `disable`.** In each, add a module-scoped limiter keyed by the user id and check it after `requireAuth`:

```ts
import { createRateLimiter } from '@/lib/auth/rateLimit';
const limiter = createRateLimiter({ limit: 10, windowMs: 5 * 60 * 1000 });
// after `const auth = await requireAuth(req); if (auth instanceof Response) return auth;`
  if (!limiter.check(auth.id).allowed) {
    return Response.json({ message: 'Too many attempts. Try again later.' }, { status: 429 });
  }
```

- [ ] **Step 3: Rate-limit `auth/invite/accept`.** Add a limiter keyed by client IP (`x-forwarded-for` first hop, fallback `'unknown'`), checked at the top of the handler:

```ts
import { createRateLimiter } from '@/lib/auth/rateLimit';
const acceptLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });
// at the start of POST:
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!acceptLimiter.check(ip).allowed) {
    return Response.json({ message: 'Too many attempts. Try again later.' }, { status: 429 });
  }
```

- [ ] **Step 4: Document the message-write ownership invariant** in `src/lib/agents/search/index.ts` — add a comment at the top of the message-writing function noting that callers MUST enforce chat ownership before invoking it (currently `POST /api/chat` does), since the writes/deletes are keyed only on `chatId`/`messageId`:

```ts
// SECURITY INVARIANT: callers MUST verify the authenticated user owns `chatId`
// before invoking this — message writes/deletes here are keyed only on
// chatId/messageId and perform no ownership check of their own.
// (Enforced today by the owner guard in POST /api/chat.)
```

- [ ] **Step 5: Typecheck + build.** `yarn tsc --noEmit` (exit 0), `yarn build 2>&1 | tail -15`.

- [ ] **Step 6: Commit.**

```bash
git add src/middleware.ts src/app/api/account/2fa/enable/route.ts src/app/api/account/2fa/disable/route.ts src/app/api/auth/invite/accept/route.ts src/lib/agents/search/index.ts
git commit -m "feat(auth): enforce require-2FA at API layer and rate-limit sensitive routes"
```

---

## Task 9: API documentation

**Files:**
- Modify `docs/API/AUTH.md`

- [ ] **Step 1: Add a "User Management (admin)" + "Account" section** documenting (real shapes from the routes):
  - **POST `/api/account/password`** (auth) — `{currentPassword, newPassword(min 10)}` → 200 `{ok:true}` + rotated session cookies (all other sessions revoked); 401 wrong current password; 400 bad input.
  - **GET `/api/admin/users`** (admin) — `{users:[{id,username,role,disabled,totpEnabled,mustChangePassword}]}`.
  - **POST `/api/admin/users/:id/disable`** (admin) — `{disabled:boolean}` → 200; 400 if targeting self; revokes sessions on disable.
  - **DELETE `/api/admin/users/:id`** (admin) — 200 `{ok:true}`; 400 self; 404 unknown.
  - **POST `/api/admin/users/:id/password/reset`** (admin) — 200 `{tempPassword}` (shown once); sets `mustChangePassword`, revokes the user's sessions.
  - **POST `/api/admin/users/:id/2fa/reset`** (admin) — (already documented in Phase 4; cross-reference).
  - **GET/POST `/api/admin/settings`** (admin) — `{requireTwoFactor:boolean}`.
  - Note: when `requireTwoFactor` is on, all data APIs except `/api/auth/*` and `/api/account/*` return **403** for users without 2FA (forces enrollment at the API layer, not just the UI).

- [ ] **Step 2: Commit.**

```bash
git add docs/API/AUTH.md
git commit -m "docs(api): document admin user-management and account endpoints"
```

---

## Task 10: Full suite green + smoke test

**Files:** none (verification only)

- [ ] **Step 1: Suite + typecheck.** `yarn test` (all prior + new `userAdmin` tests pass) and `yarn tsc --noEmit` (exit 0).

- [ ] **Step 2: Smoke test** against a throwaway `DATA_DIR` dev server (prior pattern). Bootstrap admin, invite+accept `bob`, then:

```bash
# admin lists users → admin + bob
curl -s -b /tmp/a.cookies localhost:3111/api/admin/users | python3 -c "import sys,json;print([u['username'] for u in json.load(sys.stdin)['users']])"
# bob (non-admin) hits admin list → 403
curl -s -b /tmp/b.cookies localhost:3111/api/admin/users -o /dev/null -w '[%{http_code}]\n'
# admin resets bob's password → tempPassword
TMP=$(curl -s -b /tmp/a.cookies -X POST localhost:3111/api/admin/users/<BOB_ID>/password/reset | python3 -c "import sys,json;print(json.load(sys.stdin)['tempPassword'])")
# bob's OLD session is revoked → bob /api/auth/session still has access cookie but refresh is dead;
#   verify bob must re-login: login with temp password → 200; then mustChangePassword is true.
curl -s -c /tmp/b.cookies -X POST localhost:3111/api/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"bob\",\"password\":\"$TMP\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['user']['mustChangePassword'])"
# expect: True
# bob changes password → 200; mustChangePassword cleared
curl -s -b /tmp/b.cookies -X POST localhost:3111/api/account/password -H 'Content-Type: application/json' -d "{\"currentPassword\":\"$TMP\",\"newPassword\":\"bobs-new-password-1\"}" -w '\n[%{http_code}]\n'
# admin can't delete self → 400
curl -s -b /tmp/a.cookies -X DELETE localhost:3111/api/admin/users/<ADMIN_ID> -o /dev/null -w '[%{http_code}]\n'
# admin disables bob → 200; bob's chats API now 401/403 after re-auth fails
curl -s -b /tmp/a.cookies -X POST localhost:3111/api/admin/users/<BOB_ID>/disable -H 'Content-Type: application/json' -d '{"disabled":true}' -w '\n[%{http_code}]\n'
# admin toggles require-2FA on → 200
curl -s -b /tmp/a.cookies -X POST localhost:3111/api/admin/settings -H 'Content-Type: application/json' -d '{"requireTwoFactor":true}' -w '\n[%{http_code}]\n'
# admin (no 2FA) now blocked from a data API → 403 (must enroll); /api/account/* still reachable
curl -s -b /tmp/a.cookies localhost:3111/api/chats -o /dev/null -w '[%{http_code}]\n'  # expect 403
curl -s -b /tmp/a.cookies localhost:3111/api/auth/session -o /dev/null -w '[%{http_code}]\n'  # expect 200
# (turn it back off to avoid locking the smoke admin out)
curl -s -b /tmp/a.cookies -X POST localhost:3111/api/admin/settings -H 'Content-Type: application/json' -d '{"requireTwoFactor":false}' -o /dev/null -w 'reset [%{http_code}]\n'
```

Obtain `<BOB_ID>`/`<ADMIN_ID>` from `GET /api/admin/users`. Record actual results — all assertions must hold. Stop the dev server and remove the temp dir; only kill the server you started.

- [ ] **Step 3: Commit (only if fixes were needed).**

```bash
git add -A
git commit -m "test(auth): verify phase 6 admin surface and password flows"
```

---

## Self-Review Notes

- **Spec coverage (§8/§6/§9):** admin list/disable/delete/reset-2FA(existing)/reset-password ✓; admin generate/list/revoke invites (UI over existing APIs) ✓; require-2FA toggle ✓; self password change ✓; force-change-after-reset gate ✓; admin panel UI + account UI ✓; docs ✓.
- **Security:** all `/api/admin/*` require admin (middleware + `requireAdmin`); self-lockout guards on disable/delete; password reset + disable + delete revoke the target's refresh tokens (force re-auth / kick out); self password change rotates the session and kills others; require-2FA now enforced at the API layer (403), closing the Phase-4 UI-only gap; rate limits added to invite-accept and the authenticated 2FA enable/disable routes; the agent message-write ownership invariant is documented.
- **Type consistency:** `listUsers` returns `PublicUser[]` (no `passwordHash`); `changeOwnPassword`/`adminSetPassword` operate on `mustChangePassword`; layout `authedUser` gains `mustChangePassword`; admin routes reuse `requireAdmin`/`revokeAllForUser`.
- **Closes watch-list:** Phase-4 require-2FA-UI-only → API-enforced; Phase-3 invite rate-limit → added; Phase-4 2FA-route rate-limit → added; Phase-5 agent message-write invariant → documented (a deeper refactor to push the check into the write layer is possible later but not required, since `POST /api/chat` enforces it).
- **No placeholders:** backend code complete; UI components fully written; Sidebar edit gives the exact role-fetch snippet and instructs matching existing nav markup.
