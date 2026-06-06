# JWT Auth — Phase 4: Optional TOTP 2FA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users optionally protect their account with an authenticator-app TOTP second factor — enroll via QR, confirm, receive one-time recovery codes; log in through a second step; disable with re-auth. Admins can require 2FA org-wide and reset a locked-out user's 2FA.

**Architecture:** A `twoFactor` repository (over the existing `users.totpSecret/totpEnabled/recoveryCodes` columns) wraps the Phase 1 `totp.ts` + `recoveryCodes.ts` primitives. Login becomes a two-step exchange for 2FA users: password → short-lived `mfa` JWT → `/api/auth/mfa` with a TOTP/recovery code → session. Account routes handle enroll/confirm/disable; an admin route resets a user's 2FA. A config flag `auth.requireTwoFactor` plus a layout gate force enrollment.

**Tech Stack:** TypeScript, Next.js 16, Drizzle + better-sqlite3, `otplib` (v12), `qrcode`, `jose`, `vitest`.

---

## Dependencies on Phases 1-3 (reuse, do not reimplement)

- `src/lib/auth/totp.ts` — `generateTotpSecret`, `buildOtpAuthUri`, `verifyTotp` (otplib v12, ±1-step window).
- `src/lib/auth/recoveryCodes.ts` — `generateRecoveryCodes`, `hashRecoveryCodes`, `consumeRecoveryCode`.
- `src/lib/auth/password.ts` — `verifyPassword` (for disable re-auth).
- `src/lib/auth/jwt.ts` — `signJwt`, `verifyJwt` (already supports the `'mfa'` token type).
- `src/lib/auth/authConfig.ts` — `getAuthConfig`.
- `src/lib/auth/sessionCookies.ts` — `issueSessionOnResponse`.
- `src/lib/auth/getAuthUser.ts` — `getAuthUser`, `requireAuth`, `requireAdmin`.
- `src/lib/auth/rateLimit.ts` — `createRateLimiter`.
- `src/lib/auth/cookies.ts` — `isSecureRequest`.
- `users` columns (Phase 1): `totpSecret` (text, nullable), `totpEnabled` (bool), `recoveryCodes` (json string[]).
- The login route already returns `{ mfaRequired: true }` when `user.totpEnabled` — Phase 4 turns that into a real exchange.

Spec: `docs/superpowers/specs/2026-06-06-jwt-auth-multiuser-design.md` (§5).

---

## Security notes baked into this phase

- **MFA verification MUST be rate-limited.** A TOTP is 6 digits (~10^6, ~3×10^6 across the ±1 window) — brute-forceable in seconds without throttling. `/api/auth/mfa` is rate-limited per user id.
- TOTP secrets remain plaintext at rest (spec defers encryption-at-rest — see watch-list).
- A *pending* (un-confirmed) secret is stored in `totpSecret` with `totpEnabled` still false, so it never triggers the login MFA step until confirmed.
- Recovery codes are shown once at confirmation; only argon2 hashes are stored; consuming one removes it.

---

## File Structure (Phase 4)

- Create `src/lib/auth/twoFactor.ts` — enroll/confirm/verify/disable repository.
- Create `src/app/api/auth/mfa/route.ts` — second-step login verification.
- Modify `src/app/api/auth/login/route.ts` — issue an `mfa` token in the `mfaRequired` response.
- Create `src/app/api/account/2fa/setup/route.ts` — begin enrollment (returns otpauth URI + QR).
- Create `src/app/api/account/2fa/enable/route.ts` — confirm enrollment, return recovery codes.
- Create `src/app/api/account/2fa/disable/route.ts` — disable with re-auth.
- Create `src/app/api/admin/users/[id]/2fa/reset/route.ts` — admin reset.
- Create `src/components/Auth/TwoFactorSetup.tsx` — enroll UI (QR + confirm + recovery codes).
- Create `src/app/account/page.tsx` + `src/components/Account/AccountView.tsx` — account screen hosting 2FA.
- Modify `src/components/Auth/Login.tsx` — add the second-step code entry.
- Modify `src/app/layout.tsx` — force enrollment when `requireTwoFactor` is on and the user has no 2FA.
- Modify `docs/API/AUTH.md`.

---

## Task 1: Two-factor repository

**Files:**
- Create `src/lib/auth/twoFactor.ts`
- Test `src/lib/auth/__tests__/twoFactor.integration.test.ts`

- [ ] **Step 1: Write the failing integration test** — `src/lib/auth/__tests__/twoFactor.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { authenticator } from 'otplib';

let tf: typeof import('../twoFactor');
let users: typeof import('../users');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-2fa-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: 'inherit',
  });
  tf = await import('../twoFactor');
  users = await import('../users');
});

describe('two-factor repository', () => {
  it('enrolls, confirms with a valid code, and verifies', async () => {
    const u = await users.createUser({ username: 'tfa', password: 'password-1234', role: 'user' });
    const { secret } = await tf.startEnrollment(u.id, u.username);
    expect(secret).toMatch(/^[A-Z2-7]+$/);

    // Not yet enabled: a fresh user row still has totpEnabled false.
    const before = await users.getUserById(u.id);
    expect(before?.totpEnabled).toBe(false);

    const wrong = await tf.confirmEnrollment(u.id, '000000');
    expect(wrong.ok).toBe(false);

    const code = authenticator.generate(secret);
    const confirmed = await tf.confirmEnrollment(u.id, code);
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.recoveryCodes).toHaveLength(10);

    const after = await users.getUserById(u.id);
    expect(after?.totpEnabled).toBe(true);

    // verify a fresh TOTP code
    expect(await tf.verifyUserSecondFactor(u.id, authenticator.generate(secret))).toBe(true);
    expect(await tf.verifyUserSecondFactor(u.id, '000000')).toBe(false);
  });

  it('consumes a recovery code once', async () => {
    const u = await users.createUser({ username: 'tfa2', password: 'password-1234', role: 'user' });
    const { secret } = await tf.startEnrollment(u.id, u.username);
    const confirmed = await tf.confirmEnrollment(u.id, authenticator.generate(secret));
    if (!confirmed.ok) throw new Error('confirm failed');
    const recovery = confirmed.recoveryCodes[0];

    expect(await tf.verifyUserSecondFactor(u.id, recovery)).toBe(true);
    // same code cannot be reused
    expect(await tf.verifyUserSecondFactor(u.id, recovery)).toBe(false);
  });

  it('disables 2FA (clears secret/codes/flag)', async () => {
    const u = await users.createUser({ username: 'tfa3', password: 'password-1234', role: 'user' });
    const { secret } = await tf.startEnrollment(u.id, u.username);
    await tf.confirmEnrollment(u.id, authenticator.generate(secret));
    await tf.disableTwoFactor(u.id);
    const row = await users.getUserById(u.id);
    expect(row?.totpEnabled).toBe(false);
    expect(row?.totpSecret).toBeNull();
    expect(await tf.verifyUserSecondFactor(u.id, authenticator.generate(secret))).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `yarn vitest run src/lib/auth/__tests__/twoFactor.integration.test.ts`.

- [ ] **Step 3: Implement** — `src/lib/auth/twoFactor.ts`:

```ts
import { eq } from 'drizzle-orm';
import db from '@/lib/db';
import { users } from '@/lib/db/schema';
import { generateTotpSecret, buildOtpAuthUri, verifyTotp } from './totp';
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCode,
} from './recoveryCodes';

const ISSUER = 'Vane';

const nowIso = () => new Date().toISOString();

// Begin enrollment: generate + store a PENDING secret (totpEnabled stays false
// so it never triggers the login MFA step until confirmed). Returns the secret
// and an otpauth:// URI for QR rendering.
export const startEnrollment = async (
  userId: string,
  username: string,
): Promise<{ secret: string; otpauthUri: string }> => {
  const secret = generateTotpSecret();
  await db
    .update(users)
    .set({ totpSecret: secret, totpEnabled: false, recoveryCodes: null, updatedAt: nowIso() })
    .where(eq(users.id, userId));
  return { secret, otpauthUri: buildOtpAuthUri(secret, username, ISSUER) };
};

// Confirm enrollment: verify a code against the pending secret. On success,
// enable 2FA and generate one-time recovery codes (plaintext returned ONCE).
export const confirmEnrollment = async (
  userId: string,
  code: string,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false }> => {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u?.totpSecret) return { ok: false };
  if (!verifyTotp(code, u.totpSecret)) return { ok: false };

  const codes = await generateRecoveryCodes();
  const hashes = await hashRecoveryCodes(codes);
  await db
    .update(users)
    .set({ totpEnabled: true, recoveryCodes: hashes, updatedAt: nowIso() })
    .where(eq(users.id, userId));
  return { ok: true, recoveryCodes: codes };
};

// Verify a second factor at login: TOTP first, then a recovery code (consumed
// on use). Returns true on success.
export const verifyUserSecondFactor = async (
  userId: string,
  code: string,
): Promise<boolean> => {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u?.totpEnabled || !u.totpSecret) return false;
  if (verifyTotp(code, u.totpSecret)) return true;

  const hashes = u.recoveryCodes ?? [];
  const result = await consumeRecoveryCode(code, hashes);
  if (!result.ok) return false;
  await db
    .update(users)
    .set({ recoveryCodes: result.remaining, updatedAt: nowIso() })
    .where(eq(users.id, userId));
  return true;
};

// Count of remaining recovery codes (for "N left" UI warnings).
export const remainingRecoveryCodes = async (userId: string): Promise<number> => {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return (u?.recoveryCodes ?? []).length;
};

// Disable 2FA entirely (also used by admin reset). Clears secret, flag, codes.
export const disableTwoFactor = async (userId: string): Promise<void> => {
  await db
    .update(users)
    .set({ totpEnabled: false, totpSecret: null, recoveryCodes: null, updatedAt: nowIso() })
    .where(eq(users.id, userId));
};
```

- [ ] **Step 4: Run, verify PASS** (3 tests). Then `yarn tsc --noEmit` (exit 0). If the `confirmEnrollment` discriminated-union access needs narrowing in the test, it's already guarded with `if (confirmed.ok)` — keep it.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/twoFactor.ts src/lib/auth/__tests__/twoFactor.integration.test.ts
git commit -m "feat(auth): add two-factor repository (enroll/confirm/verify/disable)"
```

---

## Task 2: Login issues an MFA token

**Files:**
- Modify `src/app/api/auth/login/route.ts`

- [ ] **Step 1: Read** `src/app/api/auth/login/route.ts`. Find the existing inert branch:

```ts
    if (user.totpEnabled) {
      return Response.json({ mfaRequired: true }, { status: 200 });
    }
```

- [ ] **Step 2: Replace it** so it mints a short-lived (`'mfa'`-typed) token the client returns to `/api/auth/mfa`. Add the imports `signJwt` (from `@/lib/auth/jwt`) and `getAuthConfig` (from `@/lib/auth/authConfig`) at the top if not already present, then:

```ts
    if (user.totpEnabled) {
      const cfg = getAuthConfig();
      const mfaToken = await signJwt(
        { sub: user.id, type: 'mfa' },
        cfg.secret,
        '300s',
      );
      return Response.json({ mfaRequired: true, mfaToken }, { status: 200 });
    }
```

(Leave the rest of the route — rate limiting, password check, session issuance for non-2FA users — unchanged. Note the password rate-limit reset on success still runs before this branch, which is correct: the password was valid.)

- [ ] **Step 3: Typecheck.** `yarn tsc --noEmit` → exit 0.

- [ ] **Step 4: Commit.**

```bash
git add src/app/api/auth/login/route.ts
git commit -m "feat(auth): issue short-lived MFA token when 2FA is required at login"
```

---

## Task 3: MFA verification route

**Files:**
- Create `src/app/api/auth/mfa/route.ts`

- [ ] **Step 1: Implement** — `src/app/api/auth/mfa/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyJwt } from '@/lib/auth/jwt';
import { getAuthConfig } from '@/lib/auth/authConfig';
import { getUserById } from '@/lib/auth/users';
import { verifyUserSecondFactor } from '@/lib/auth/twoFactor';
import { issueSessionOnResponse } from '@/lib/auth/sessionCookies';
import { isSecureRequest } from '@/lib/auth/cookies';
import { createRateLimiter } from '@/lib/auth/rateLimit';

export const runtime = 'nodejs';

// A 6-digit TOTP is brute-forceable without throttling. Limit attempts per user.
const mfaLimiter = createRateLimiter({ limit: 5, windowMs: 5 * 60 * 1000 });

const schema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().min(1).max(32),
});

export const POST = async (req: NextRequest) => {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'Invalid request.' }, { status: 400 });
    }

    let userId: string;
    try {
      const claims = await verifyJwt(parsed.data.mfaToken, getAuthConfig().secret, 'mfa');
      userId = claims.sub;
    } catch {
      return Response.json({ message: 'MFA session expired. Sign in again.' }, { status: 401 });
    }

    const limit = mfaLimiter.check(userId);
    if (!limit.allowed) {
      return Response.json({ message: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    const user = await getUserById(userId);
    if (!user || user.disabled || !user.totpEnabled) {
      return Response.json({ message: 'Invalid credentials.' }, { status: 401 });
    }

    const ok = await verifyUserSecondFactor(userId, parsed.data.code.trim());
    if (!ok) {
      return Response.json({ message: 'Invalid code.' }, { status: 401 });
    }
    mfaLimiter.reset(userId);

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
    await issueSessionOnResponse({
      res,
      user: { id: user.id, role: user.role, username: user.username },
      isSecure: isSecureRequest(req.headers.get('x-forwarded-proto')),
    });
    return res;
  } catch (err) {
    console.error('Error in MFA verify: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit.**

```bash
git add src/app/api/auth/mfa/route.ts
git commit -m "feat(auth): add rate-limited MFA verification route"
```

---

## Task 4: Account 2FA routes (setup / enable / disable)

**Files:**
- Create `src/app/api/account/2fa/setup/route.ts`
- Create `src/app/api/account/2fa/enable/route.ts`
- Create `src/app/api/account/2fa/disable/route.ts`

These require an authenticated user (`requireAuth`). The middleware already guards `/api/account/*` (it's a non-public, non-admin API → needs a valid token).

- [ ] **Step 1: setup** — `src/app/api/account/2fa/setup/route.ts`:

```ts
import { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { requireAuth } from '@/lib/auth/getAuthUser';
import { startEnrollment } from '@/lib/auth/twoFactor';

export const runtime = 'nodejs';

export const POST = async (req: NextRequest) => {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const { secret, otpauthUri } = await startEnrollment(auth.id, auth.username);
    const qrDataUrl = await QRCode.toDataURL(otpauthUri);
    return Response.json({ secret, otpauthUri, qrDataUrl }, { status: 200 });
  } catch (err) {
    console.error('Error starting 2FA enrollment: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: enable** — `src/app/api/account/2fa/enable/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/getAuthUser';
import { confirmEnrollment } from '@/lib/auth/twoFactor';

export const runtime = 'nodejs';

const schema = z.object({ code: z.string().min(1).max(32) });

export const POST = async (req: NextRequest) => {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'Code required.' }, { status: 400 });
    }

    const result = await confirmEnrollment(auth.id, parsed.data.code.trim());
    if (!result.ok) {
      return Response.json({ message: 'Invalid code. Try again.' }, { status: 400 });
    }
    return Response.json({ recoveryCodes: result.recoveryCodes }, { status: 200 });
  } catch (err) {
    console.error('Error enabling 2FA: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 3: disable** — `src/app/api/account/2fa/disable/route.ts` (re-auth with password + current code):

```ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/getAuthUser';
import { getUserById } from '@/lib/auth/users';
import { verifyPassword } from '@/lib/auth/password';
import { verifyUserSecondFactor, disableTwoFactor } from '@/lib/auth/twoFactor';

export const runtime = 'nodejs';

const schema = z.object({
  password: z.string().min(1),
  code: z.string().min(1).max(32),
});

export const POST = async (req: NextRequest) => {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'Password and code required.' }, { status: 400 });
    }

    const user = await getUserById(auth.id);
    if (!user) return Response.json({ message: 'Unauthorized' }, { status: 401 });

    const passwordOk = await verifyPassword(user.passwordHash, parsed.data.password);
    const codeOk = await verifyUserSecondFactor(auth.id, parsed.data.code.trim());
    if (!passwordOk || !codeOk) {
      return Response.json({ message: 'Invalid password or code.' }, { status: 401 });
    }

    await disableTwoFactor(auth.id);
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Error disabling 2FA: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 4: Typecheck.** `yarn tsc --noEmit` → exit 0. (`qrcode` + `@types/qrcode` were installed in Phase 1 Task 1.)

- [ ] **Step 5: Commit.**

```bash
git add src/app/api/account/2fa/setup/route.ts src/app/api/account/2fa/enable/route.ts src/app/api/account/2fa/disable/route.ts
git commit -m "feat(auth): add account 2FA setup/enable/disable routes"
```

---

## Task 5: Admin reset-2FA route

**Files:**
- Create `src/app/api/admin/users/[id]/2fa/reset/route.ts`

- [ ] **Step 1: Implement** — `src/app/api/admin/users/[id]/2fa/reset/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/getAuthUser';
import { getUserById } from '@/lib/auth/users';
import { disableTwoFactor } from '@/lib/auth/twoFactor';

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

    await disableTwoFactor(id);
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Error resetting 2FA: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit.**

```bash
git add 'src/app/api/admin/users/[id]/2fa/reset/route.ts'
git commit -m "feat(auth): add admin reset-2FA route"
```

---

## Task 6: Login second-step UI

**Files:**
- Modify `src/components/Auth/Login.tsx`

- [ ] **Step 1: Read** `src/components/Auth/Login.tsx`. It currently posts to `/api/auth/login`, and on `data.mfaRequired` only toasts "not available yet". Replace that behavior with a real second step: store the returned `mfaToken`, switch to a code-entry view, and POST `{ mfaToken, code }` to `/api/auth/mfa`.

- [ ] **Step 2: Replace the component body** with this version (preserves the existing styling/theme tokens):

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { LogIn, ShieldCheck } from 'lucide-react';

const Login = () => {
  const [step, setStep] = useState<'password' | 'mfa'>('password');
  const [mfaToken, setMfaToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.status === 429) throw new Error('Too many attempts. Try again later.');
      if (!res.ok) throw new Error('Invalid credentials.');
      const data = await res.json();
      if (data.mfaRequired) {
        setMfaToken(data.mfaToken);
        setStep('mfa');
        setSubmitting(false);
        return;
      }
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
      setSubmitting(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const res = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken, code }),
      });
      if (res.status === 429) throw new Error('Too many attempts. Try again later.');
      if (!res.ok) throw new Error('Invalid code.');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed');
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]';
  const btnCls =
    'w-full px-4 py-2.5 rounded-lg bg-[#24A0ED] text-white hover:bg-[#1e8fd1] active:scale-95 transition-all duration-200 font-medium text-sm disabled:opacity-50 disabled:active:scale-100';

  return (
    <div className="bg-light-primary dark:bg-dark-primary h-screen w-screen fixed inset-0 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-light-primary dark:bg-dark-primary border border-light-200 dark:border-dark-200 rounded-xl shadow-sm p-6 flex flex-col space-y-5">
        {step === 'password' ? (
          <>
            <div className="flex flex-col items-center text-center space-y-2">
              <LogIn className="w-8 h-8 text-[#24A0ED]" />
              <h1 className="text-lg font-medium text-black dark:text-white">Sign in to Vane</h1>
            </div>
            <form onSubmit={submitPassword} className="flex flex-col space-y-5">
              <input type="text" autoComplete="username" aria-label="Username" autoFocus placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required className={inputCls} />
              <input type="password" autoComplete="current-password" aria-label="Password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required className={inputCls} />
              <button type="submit" disabled={submitting} className={btnCls}>{submitting ? 'Signing in…' : 'Sign in'}</button>
            </form>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center text-center space-y-2">
              <ShieldCheck className="w-8 h-8 text-[#24A0ED]" />
              <h1 className="text-lg font-medium text-black dark:text-white">Two-factor authentication</h1>
              <p className="text-xs text-black/50 dark:text-white/50">Enter the 6-digit code from your authenticator app, or a recovery code.</p>
            </div>
            <form onSubmit={submitCode} className="flex flex-col space-y-5">
              <input type="text" inputMode="numeric" autoComplete="one-time-code" aria-label="Authentication code" autoFocus placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required className={inputCls} />
              <button type="submit" disabled={submitting} className={btnCls}>{submitting ? 'Verifying…' : 'Verify'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default Login;
```

- [ ] **Step 3: Typecheck.** `yarn tsc --noEmit` → exit 0.

- [ ] **Step 4: Commit.**

```bash
git add src/components/Auth/Login.tsx
git commit -m "feat(auth): add two-step MFA code entry to login UI"
```

---

## Task 7: Account screen + 2FA management UI

**Files:**
- Create `src/components/Auth/TwoFactorSetup.tsx`
- Create `src/components/Account/AccountView.tsx`
- Create `src/app/account/page.tsx`

- [ ] **Step 1: Implement** — `src/components/Auth/TwoFactorSetup.tsx` (reusable enroll widget; `onDone` lets the host refresh):

```tsx
'use client';

import { useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';

const TwoFactorSetup = ({ onDone }: { onDone?: () => void }) => {
  const [phase, setPhase] = useState<'idle' | 'qr' | 'codes'>('idle');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    try {
      setBusy(true);
      const res = await fetch('/api/account/2fa/setup', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to start setup');
      const data = await res.json();
      setQr(data.qrDataUrl);
      setSecret(data.secret);
      setPhase('qr');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start setup');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setBusy(true);
      const res = await fetch('/api/account/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) throw new Error('Invalid code. Try again.');
      const data = await res.json();
      setRecovery(data.recoveryCodes);
      setPhase('codes');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]';
  const btnCls =
    'px-4 py-2.5 rounded-lg bg-[#24A0ED] text-white hover:bg-[#1e8fd1] active:scale-95 transition-all duration-200 font-medium text-sm disabled:opacity-50';

  if (phase === 'idle') {
    return (
      <button onClick={begin} disabled={busy} className={btnCls}>
        {busy ? 'Starting…' : 'Enable two-factor authentication'}
      </button>
    );
  }

  if (phase === 'qr') {
    return (
      <form onSubmit={confirm} className="flex flex-col space-y-4">
        <p className="text-sm text-black/70 dark:text-white/70">
          Scan this QR code in your authenticator app, then enter the 6-digit code.
        </p>
        {qr && <Image src={qr} alt="2FA QR code" width={180} height={180} className="rounded-lg" unoptimized />}
        <p className="text-xs text-black/50 dark:text-white/50 break-all">
          Manual key: <span className="font-mono">{secret}</span>
        </p>
        <input type="text" inputMode="numeric" autoComplete="one-time-code" aria-label="Authentication code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required className={inputCls} />
        <button type="submit" disabled={busy} className={btnCls}>{busy ? 'Verifying…' : 'Confirm'}</button>
      </form>
    );
  }

  // phase === 'codes'
  return (
    <div className="flex flex-col space-y-4">
      <p className="text-sm text-black dark:text-white font-medium">Save your recovery codes</p>
      <p className="text-xs text-black/50 dark:text-white/50">
        Each code works once. Store them somewhere safe — they are shown only now.
      </p>
      <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-light-secondary dark:bg-dark-secondary">
        {recovery.map((c) => (
          <span key={c} className="font-mono text-sm text-black dark:text-white">{c}</span>
        ))}
      </div>
      <button onClick={() => onDone?.()} className={btnCls}>Done</button>
    </div>
  );
};

export default TwoFactorSetup;
```

- [ ] **Step 2: Implement** — `src/components/Account/AccountView.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import TwoFactorSetup from '../Auth/TwoFactorSetup';

const AccountView = ({ forceEnroll = false }: { forceEnroll?: boolean }) => {
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const refresh = async () => {
    const res = await fetch('/api/auth/session');
    const data = await res.json();
    // session returns {id, role, username} — fetch enabled state via a HEAD-ish call:
    // simplest: reload to re-evaluate gates after enabling.
    setTotpEnabled(Boolean(data.user));
  };

  useEffect(() => {
    // After enabling under forceEnroll, a full reload re-evaluates the layout gate.
  }, []);

  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/account/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, code: code.trim() }),
      });
      if (!res.ok) throw new Error('Invalid password or code.');
      toast.success('Two-factor disabled.');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disable');
    }
  };

  const inputCls =
    'w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]';

  return (
    <div className="max-w-md mx-auto px-4 py-10 flex flex-col space-y-6">
      <div className="flex items-center space-x-2">
        <ShieldCheck className="w-6 h-6 text-[#24A0ED]" />
        <h1 className="text-xl font-medium text-black dark:text-white">Account security</h1>
      </div>

      {forceEnroll && (
        <p className="text-sm text-[#24A0ED]">
          Your administrator requires two-factor authentication. Set it up to continue.
        </p>
      )}

      <section className="border border-light-200 dark:border-dark-200 rounded-xl p-5 flex flex-col space-y-4">
        <h2 className="text-sm font-medium text-black dark:text-white">Two-factor authentication</h2>
        {/* Enroll widget. After enabling, reload to refresh gates. */}
        <TwoFactorSetup onDone={() => window.location.reload()} />

        {!forceEnroll && (
          <details className="pt-2">
            <summary className="text-xs text-black/50 dark:text-white/50 cursor-pointer flex items-center gap-1">
              <ShieldOff className="w-3.5 h-3.5" /> Disable two-factor
            </summary>
            <form onSubmit={disable} className="flex flex-col space-y-3 pt-3">
              <input type="password" aria-label="Password" placeholder="Current password" value={password} onChange={(e) => setPassword(e.target.value)} required className={inputCls} />
              <input type="text" inputMode="numeric" aria-label="Authentication code" placeholder="Current 6-digit code" value={code} onChange={(e) => setCode(e.target.value)} required className={inputCls} />
              <button type="submit" disabled={disabling} className="px-4 py-2 rounded-lg border border-light-200 dark:border-dark-200 text-sm text-black dark:text-white hover:bg-light-secondary dark:hover:bg-dark-secondary">Disable two-factor</button>
            </form>
          </details>
        )}
      </section>
    </div>
  );
};

export default AccountView;
```

> Note: the `refresh`/`useEffect` scaffolding above is intentionally minimal — the flow relies on `window.location.reload()` after enable/disable to re-evaluate the layout gate. If the implementer finds the unused `refresh`/`totpEnabled`/`disabling` bits cause lint/tsc `noUnusedLocals` errors, REMOVE them (they are not needed) rather than suppressing — the component only needs the enroll widget + the disable form. Report the trim.

- [ ] **Step 3: Implement** — `src/app/account/page.tsx`:

```tsx
import AccountView from '@/components/Account/AccountView';

export const dynamic = 'force-dynamic';

export default function AccountPage() {
  return <AccountView />;
}
```

- [ ] **Step 4: Typecheck + build.** `yarn tsc --noEmit` (exit 0) and `yarn build 2>&1 | tail -15`. Confirm `next/image` with a data URL works (the component sets `unoptimized`). If the build complains about the data-URL image, switch the `<Image>` to a plain `<img>` with an eslint-disable for `@next/next/no-img-element` and report it.

- [ ] **Step 5: Commit.**

```bash
git add src/components/Auth/TwoFactorSetup.tsx src/components/Account/AccountView.tsx src/app/account/page.tsx
git commit -m "feat(auth): add account screen with 2FA enroll/disable UI"
```

---

## Task 8: Force-enrollment gate (require-2FA)

**Files:**
- Modify `src/app/layout.tsx`
- Create `src/components/Auth/Force2FA.tsx`

When `auth.requireTwoFactor` is on and an authenticated user has not enabled 2FA, the layout renders a forced-enrollment screen instead of the app. (UI-level enforcement; API-level enforcement is a documented follow-up — see watch-list.)

- [ ] **Step 1: Implement** — `src/components/Auth/Force2FA.tsx`:

```tsx
'use client';

import AccountView from '../Account/AccountView';

const Force2FA = () => (
  <div className="bg-light-primary dark:bg-dark-primary min-h-screen w-screen fixed inset-0 overflow-y-auto">
    <AccountView forceEnroll />
  </div>
);

export default Force2FA;
```

- [ ] **Step 2: Modify `src/app/layout.tsx`.** First READ it. It currently verifies the access token and sets `authed`. Phase 4 needs the actual user row (for `totpEnabled`). Add imports `import { getUserById } from '@/lib/auth/users';`, `import configManager from '@/lib/config';` (already imported), `import Force2FA from '@/components/Auth/Force2FA';`. Where `authed` is computed from a verified token, also capture the user id from the claims and load the row:

```tsx
  let authedUser: { id: string; totpEnabled: boolean } | null = null;
  if (userCount > 0) {
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (token) {
      try {
        const claims = await verifyJwt(token, getAuthConfig().secret, 'access');
        const row = await getUserById(claims.sub);
        if (row && !row.disabled) {
          authedUser = { id: row.id, totpEnabled: row.totpEnabled };
        }
      } catch {
        authedUser = null;
      }
    }
  }
  const authed = authedUser !== null;
  const requireTwoFactor = Boolean(configManager.getConfig('auth.requireTwoFactor', false));
  const needsEnroll =
    authed && requireTwoFactor && !authedUser!.totpEnabled && !isPublicPage;
```

Then update `renderGate()` ordering to insert the force-enroll branch after the auth check, but allow the `/account` page through (so the user can actually enroll):

```tsx
    if (!setupComplete) return <SetupWizard configSections={configSections} />;
    if (userCount === 0) return <BootstrapAdmin />;
    if (!authed && !isPublicPage) return <Login />;
    if (!authed && isPublicPage) return children;
    if (needsEnroll && pathname !== '/account') return <Force2FA />;
    return ( /* existing app shell */ );
```

(Replace the previous `authed` computation block with the `authedUser` version. Keep everything else — `isPublicPage`, the app shell, the Toaster config — intact. Note `getUserById` makes the layout do one DB read per page request; acceptable under `force-dynamic`.)

- [ ] **Step 3: Typecheck + build.** `yarn tsc --noEmit` (exit 0), `yarn build 2>&1 | tail -15` (completes).

- [ ] **Step 4: Commit.**

```bash
git add src/app/layout.tsx src/components/Auth/Force2FA.tsx
git commit -m "feat(auth): force 2FA enrollment when admin requires it"
```

---

## Task 9: Config flag for require-2FA

**Files:**
- Modify `src/lib/config/index.ts` (UI config section) — OPTIONAL, see step.

The flag `auth.requireTwoFactor` is read via `configManager.getConfig('auth.requireTwoFactor', false)` (login/layout already do). To let an admin toggle it from the Settings UI, it needs a UI config field; but wiring a new settings section is broader than this phase. For Phase 4, the flag is settable via the config file / an admin API is deferred to Phase 6 (admin panel).

- [ ] **Step 1: Confirm no code change is required here** — `getConfig('auth.requireTwoFactor', false)` already returns `false` when absent, and setting `auth.requireTwoFactor: true` in `data/config.json` enables the gate. Document this in AUTH.md (Task 10). If you want a quick admin toggle now, add `POST /api/admin/config/require-2fa` guarded by `requireAdmin` that calls `configManager.updateConfig('auth.requireTwoFactor', body.enabled)` — OPTIONAL; only do it if straightforward, and add a matching AUTH.md entry. Otherwise skip and note it for Phase 6.

- [ ] **Step 2: If you added the optional route, commit it; otherwise no commit for this task.**

---

## Task 10: API documentation

**Files:**
- Modify `docs/API/AUTH.md`

- [ ] **Step 1: Add a "Two-Factor Authentication" section** documenting (same style as the file):
  - The two-step login: `POST /api/auth/login` may now return `{ mfaRequired: true, mfaToken }` (200); the client then calls `POST /api/auth/mfa`.
  - **POST `/api/auth/mfa`** (public) — body `{mfaToken, code}` (code = 6-digit TOTP or a recovery code); 200 `{user}` + session cookies; 401 invalid/expired token or wrong code; 429 rate-limited (5 / 5 min per user); 400 bad input.
  - **POST `/api/account/2fa/setup`** (auth) — 200 `{secret, otpauthUri, qrDataUrl}`; begins enrollment (pending, not yet active).
  - **POST `/api/account/2fa/enable`** (auth) — body `{code}`; 200 `{recoveryCodes:[...]}` (shown once); 400 invalid code.
  - **POST `/api/account/2fa/disable`** (auth) — body `{password, code}`; 200 `{ok:true}`; 401 bad password/code.
  - **POST `/api/admin/users/:id/2fa/reset`** (admin) — 200 `{ok:true}`; 404 unknown user; clears the user's 2FA.
  - Note the `auth.requireTwoFactor` config flag forces enrollment (UI gate).

- [ ] **Step 2: Commit.**

```bash
git add docs/API/AUTH.md
git commit -m "docs(api): document two-factor authentication endpoints"
```

---

## Task 11: Full suite green + smoke test

**Files:** none (verification only)

- [ ] **Step 1: Suite + typecheck.** `yarn test` (all prior + new twoFactor tests pass) and `yarn tsc --noEmit` (exit 0).

- [ ] **Step 2: Smoke test** against a throwaway `DATA_DIR` dev server (same pattern as prior phases). Because TOTP codes are time-based, generate them with a tiny node helper using the enrolled secret. Bootstrap an admin, then:

```bash
# Bootstrap + capture cookies
curl -s -c /tmp/2fa.cookies -X POST localhost:3111/api/auth/bootstrap \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"supersecret123"}' -w '\n[%{http_code}]\n'

# Begin enrollment → capture secret
SETUP=$(curl -s -b /tmp/2fa.cookies -X POST localhost:3111/api/account/2fa/setup)
echo "$SETUP" | head -c 200
SECRET=$(echo "$SETUP" | node -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).secret)})")

# Generate a current TOTP code from the secret (otplib v12 is installed)
CODE=$(node -e "const {authenticator}=require('otplib'); console.log(authenticator.generate(process.argv[1]))" "$SECRET")

# Enable 2FA → expect 200 with recoveryCodes
curl -s -b /tmp/2fa.cookies -X POST localhost:3111/api/account/2fa/enable \
  -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}" -w '\n[%{http_code}]\n'

# Log out, then log in again → expect {mfaRequired:true, mfaToken}
curl -s -b /tmp/2fa.cookies -X POST localhost:3111/api/auth/logout > /dev/null
LOGIN=$(curl -s -X POST localhost:3111/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"supersecret123"}')
echo "$LOGIN"
MFATOKEN=$(echo "$LOGIN" | node -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).mfaToken||'')})")

# Wrong code → 401
curl -s -X POST localhost:3111/api/auth/mfa -H 'Content-Type: application/json' \
  -d "{\"mfaToken\":\"$MFATOKEN\",\"code\":\"000000\"}" -w '\n[%{http_code}]\n'

# Correct code → 200 + session
CODE2=$(node -e "const {authenticator}=require('otplib'); console.log(authenticator.generate(process.argv[1]))" "$SECRET")
curl -s -c /tmp/2fa.cookies -X POST localhost:3111/api/auth/mfa -H 'Content-Type: application/json' \
  -d "{\"mfaToken\":\"$MFATOKEN\",\"code\":\"$CODE2\"}" -w '\n[%{http_code}]\n'

# Authed session works
curl -s -b /tmp/2fa.cookies localhost:3111/api/auth/session -w '\n[%{http_code}]\n'
```

Expected: enable → 200 with 10 recovery codes; re-login → `mfaRequired:true` + token; wrong code → 401; correct code → 200 `{user}`; session → 200 admin. Record actual results. Also verify a recovery code works in place of a TOTP code (use one from the enable response). Stop the dev server and remove the temp dir after; only kill the server you started.

- [ ] **Step 3: Commit (only if fixes were needed).**

```bash
git add -A
git commit -m "test(auth): verify phase 4 TOTP 2FA flow"
```

---

## Self-Review Notes

- **Spec coverage (§5):** QR enrollment (otpauth URI + server-rendered QR data URL) ✓; confirm-with-code → recovery codes shown once ✓; two-step login with `mfa` token ✓; recovery codes accepted + consumed at the MFA step ✓; disable with password+code re-auth ✓; admin reset ✓; admin require-2FA flag + forced-enrollment gate ✓; `docs/API/AUTH.md` ✓.
- **Security:** MFA verify rate-limited per user (5/5min) — the key control, since TOTP is only 6 digits; pending secret never triggers login MFA (gated on `totpEnabled`); recovery codes argon2-hashed + single-use; disable requires both password and a live code.
- **Type consistency:** `confirmEnrollment` returns `{ok:true; recoveryCodes}|{ok:false}` (narrowed in tests/routes); `twoFactor.ts` reuses Phase 1 `totp.ts`/`recoveryCodes.ts` and the `users` columns; MFA token uses the existing `'mfa'` `TokenType` from `jwt.ts`.
- **Watch-list to later phases:** require-2FA is enforced at the UI/layout layer only — an authenticated user could still hit the API without enrolling (API-level enforcement = follow-up, possibly in the Phase 5 scoping middleware pass); TOTP secret encryption-at-rest still deferred; the invite-accept username-race + invite rate-limiting carry over from Phase 3.
- **No placeholders:** every code step contains complete, runnable code. Task 7 flags an explicit trim of unused scaffolding rather than leaving dead code.
