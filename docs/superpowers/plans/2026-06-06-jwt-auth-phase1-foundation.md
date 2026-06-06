# JWT Auth — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and unit-test the security primitives (password hashing, JWT, TOTP, opaque tokens, recovery codes) and the database schema/migration that all later auth phases depend on.

**Architecture:** A thin `src/lib/auth/` module of pure, dependency-light functions over vetted libraries (`argon2`, `jose`, `otplib`, `node:crypto`). Each function is independently unit-tested with `vitest`. New Drizzle tables (`users`, `invites`, `refresh_tokens`) plus `userId`/`shared` columns on `chats`, applied via the project's existing raw-SQL migration runner.

**Tech Stack:** TypeScript, Next.js 16, Drizzle ORM + better-sqlite3, `argon2`, `jose`, `otplib`, `qrcode`, `vitest`.

---

## Phase Roadmap (full feature)

This plan covers **Phase 1 only**. Each later phase gets its own plan file, written when reached (signatures depend on earlier phases' real code):

1. **Foundation (this plan)** — deps, vitest, auth primitives, DB schema + migration.
2. **Core auth + bootstrap** — auth config section + secret, session issue/refresh/logout routes, `getAuthUser`, middleware, bootstrap-admin gate in SetupWizard, `/login` page.
3. **Invitations** — admin invite APIs, public validate/accept APIs, `/invite/[token]` page.
4. **2FA** — enroll/enable/disable/verify, recovery codes at login, admin reset, require-2FA gate, account UI.
5. **Data scoping + sharing** — `userId` ownership on every chat/message query, share toggle, read-only shared view.
6. **Admin surface + password reset** — user management UI, admin password reset + force-change gate.

**Cross-cutting requirements every later phase-plan MUST include as explicit tasks** (spec §10–11):

- **API docs:** any phase adding endpoints adds/updates `docs/API/AUTH.md` (style of `docs/API/SEARCH.md`) — method/path, request+response examples, per-field params, status codes, auth requirement. Created in Phase 2.
- **UI consistency + mobile:** login, invite, account, and admin screens use existing theme tokens (`light/dark-primary|secondary`, accent `#24A0ED`), `@headlessui/react` `Dialog`, `lucide-react`, `framer-motion`, `sonner`, shared `ui/` primitives; light+dark via `next-themes`; responsive from 320px (`md:`/`xl:`), single-column forms on mobile, admin panel mirrors `SettingsDialogue.tsx` collapse behavior.

Spec: `docs/superpowers/specs/2026-06-06-jwt-auth-multiuser-design.md`.

Phase 1 adds no endpoints and no UI, so it touches neither `docs/API/` nor any screen — these requirements bind Phases 2-6.

---

## File Structure (Phase 1)

- Create `src/lib/auth/password.ts` — argon2id hash/verify.
- Create `src/lib/auth/jwt.ts` — sign/verify JWTs (access + purpose-scoped) via `jose`.
- Create `src/lib/auth/tokens.ts` — opaque random token generation + sha256 hashing (invites, refresh tokens).
- Create `src/lib/auth/totp.ts` — TOTP secret generation, otpauth URI, verification.
- Create `src/lib/auth/recoveryCodes.ts` — generate, hash, verify-and-consume recovery codes.
- Modify `src/lib/db/schema.ts` — add `users`, `invites`, `refreshTokens` tables; add `userId`, `shared` to `chats`.
- Create `drizzle/0003_auth_foundation.sql` — DDL for the above.
- Create `vitest.config.ts` — test runner config.
- Create the test files alongside under `src/lib/auth/__tests__/`.
- Modify `package.json` — add deps + `test` script.

---

## Task 1: Add dependencies and test runner

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install runtime + dev dependencies**

Run:

```bash
yarn add argon2 jose otplib qrcode
yarn add -D vitest @types/qrcode
```

Expected: `package.json` gains `argon2`, `jose`, `otplib`, `qrcode` under dependencies and `vitest`, `@types/qrcode` under devDependencies; `yarn.lock` updates without error.

- [ ] **Step 2: Add the test script**

In `package.json`, inside `"scripts"`, add a `test` entry next to the existing scripts:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create the vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 4: Verify vitest runs (no tests yet)**

Run: `yarn test`
Expected: vitest reports "No test files found" (exit non-zero is fine) — confirms vitest is installed and the config loads without error.

- [ ] **Step 5: Commit**

```bash
git add package.json yarn.lock vitest.config.ts
git commit -m "chore: add auth deps (argon2, jose, otplib, qrcode) and vitest"
```

---

## Task 2: Password hashing (argon2id)

**Files:**
- Create: `src/lib/auth/password.ts`
- Test: `src/lib/auth/__tests__/password.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth/__tests__/password.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../password';

describe('password hashing', () => {
  it('produces an argon2id hash that verifies against the original', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(
      true,
    );
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'wrong password')).toBe(false);
  });

  it('produces different hashes for the same input (random salt)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });

  it('returns false instead of throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/lib/auth/__tests__/password.test.ts`
Expected: FAIL — cannot resolve `../password`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auth/password.ts`:

```ts
import argon2 from 'argon2';

// OWASP-recommended argon2id parameters (memory in KiB).
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = (plain: string): Promise<string> =>
  argon2.hash(plain, ARGON2_OPTIONS);

export const verifyPassword = async (
  hash: string,
  plain: string,
): Promise<boolean> => {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash or verification error → treat as non-match, never throw.
    return false;
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/lib/auth/__tests__/password.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/password.ts src/lib/auth/__tests__/password.test.ts
git commit -m "feat(auth): add argon2id password hashing"
```

---

## Task 3: Opaque token generation + hashing

**Files:**
- Create: `src/lib/auth/tokens.ts`
- Test: `src/lib/auth/__tests__/tokens.test.ts`

These functions back both invitation tokens and refresh tokens: a high-entropy
raw token goes in the URL/cookie, only its SHA-256 hash is stored in the DB.

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth/__tests__/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateToken, hashToken } from '../tokens';

describe('opaque tokens', () => {
  it('generates URL-safe tokens of high entropy', () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    expect(t.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });

  it('generates a unique token each call', () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it('hashes deterministically to 64 hex chars (sha256)', () => {
    const t = 'fixed-token-value';
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different tokens', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/lib/auth/__tests__/tokens.test.ts`
Expected: FAIL — cannot resolve `../tokens`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auth/tokens.ts`:

```ts
import { randomBytes, createHash } from 'node:crypto';

// 32 bytes of CSPRNG entropy, base64url-encoded without padding.
export const generateToken = (): string =>
  randomBytes(32).toString('base64url');

// SHA-256 hex digest. Tokens are high-entropy, so a fast hash is appropriate
// (unlike passwords) and enables constant-time DB lookup by hash.
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/lib/auth/__tests__/tokens.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/tokens.ts src/lib/auth/__tests__/tokens.test.ts
git commit -m "feat(auth): add opaque token generation and sha256 hashing"
```

---

## Task 4: JWT sign/verify (jose)

**Files:**
- Create: `src/lib/auth/jwt.ts`
- Test: `src/lib/auth/__tests__/jwt.test.ts`

Pure functions: the secret is passed in (config wiring happens in Phase 2).
Access tokens carry `sub`/`role`/`username` with `type:'access'`; short-lived
MFA tokens carry `type:'mfa'`. `verifyJwt` enforces the expected `type`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth/__tests__/jwt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from '../jwt';

const secret = new TextEncoder().encode('test-secret-at-least-32-bytes-long!!');

describe('jwt', () => {
  it('signs and verifies an access token round-trip', async () => {
    const token = await signJwt(
      { sub: 'user-1', role: 'admin', username: 'alice', type: 'access' },
      secret,
      '2h',
    );
    const payload = await verifyJwt(token, secret, 'access');
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('admin');
    expect(payload.username).toBe('alice');
  });

  it('rejects a token signed with a different secret', async () => {
    const other = new TextEncoder().encode('a-totally-different-secret-value!!');
    const token = await signJwt({ sub: 'u', type: 'access' }, secret, '2h');
    await expect(verifyJwt(token, other, 'access')).rejects.toThrow();
  });

  it('rejects when the token type does not match', async () => {
    const token = await signJwt({ sub: 'u', type: 'mfa' }, secret, '5m');
    await expect(verifyJwt(token, secret, 'access')).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signJwt({ sub: 'u', type: 'access' }, secret, '0s');
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verifyJwt(token, secret, 'access')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/lib/auth/__tests__/jwt.test.ts`
Expected: FAIL — cannot resolve `../jwt`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auth/jwt.ts`:

```ts
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

export type TokenType = 'access' | 'mfa';

export interface AuthClaims extends JWTPayload {
  sub: string;
  type: TokenType;
  role?: string;
  username?: string;
}

const ALG = 'HS256';

export const signJwt = (
  claims: AuthClaims,
  secret: Uint8Array,
  expiresIn: string,
): Promise<string> =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);

export const verifyJwt = async (
  token: string,
  secret: Uint8Array,
  expectedType: TokenType,
): Promise<AuthClaims> => {
  const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
  if ((payload as AuthClaims).type !== expectedType) {
    throw new Error(`Unexpected token type: ${(payload as AuthClaims).type}`);
  }
  return payload as AuthClaims;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/lib/auth/__tests__/jwt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/jwt.ts src/lib/auth/__tests__/jwt.test.ts
git commit -m "feat(auth): add jose-based JWT sign/verify with type enforcement"
```

---

## Task 5: TOTP (authenticator apps)

**Files:**
- Create: `src/lib/auth/totp.ts`
- Test: `src/lib/auth/__tests__/totp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth/__tests__/totp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { authenticator } from 'otplib';
import {
  generateTotpSecret,
  buildOtpAuthUri,
  verifyTotp,
} from '../totp';

describe('totp', () => {
  it('generates a base32 secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it('builds an otpauth:// URI with issuer and account', () => {
    const uri = buildOtpAuthUri('JBSWY3DPEHPK3PXP', 'alice', 'Vane');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('Vane');
    expect(uri).toContain('alice');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
  });

  it('verifies a code generated from the same secret', () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    expect(verifyTotp(code, secret)).toBe(true);
  });

  it('rejects an incorrect code', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp('000000', secret)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/lib/auth/__tests__/totp.test.ts`
Expected: FAIL — cannot resolve `../totp`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auth/totp.ts`:

```ts
import { authenticator } from 'otplib';

// Allow ±1 time step (30s) to tolerate clock drift.
authenticator.options = { window: 1 };

export const generateTotpSecret = (): string => authenticator.generateSecret();

export const buildOtpAuthUri = (
  secret: string,
  account: string,
  issuer: string,
): string => authenticator.keyuri(account, issuer, secret);

export const verifyTotp = (token: string, secret: string): boolean => {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/lib/auth/__tests__/totp.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/totp.ts src/lib/auth/__tests__/totp.test.ts
git commit -m "feat(auth): add TOTP secret/URI generation and verification"
```

---

## Task 6: Recovery codes

**Files:**
- Create: `src/lib/auth/recoveryCodes.ts`
- Test: `src/lib/auth/__tests__/recoveryCodes.test.ts`

Recovery codes are shown to the user once at 2FA enrollment, then stored only as
argon2 hashes. `consumeRecoveryCode` checks a submitted code against the stored
hashes and returns the remaining hashes (the matched one removed) so the caller
can persist them.

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth/__tests__/recoveryCodes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCode,
} from '../recoveryCodes';

describe('recovery codes', () => {
  it('generates 10 distinct formatted codes', async () => {
    const codes = await generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    codes.forEach((c) => expect(c).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/));
  });

  it('hashes each plaintext code', async () => {
    const hashes = await hashRecoveryCodes(['aaaa-bbbb', 'cccc-dddd']);
    expect(hashes).toHaveLength(2);
    hashes.forEach((h) => expect(h).toMatch(/^\$argon2id\$/));
  });

  it('consumes a valid code and returns remaining hashes', async () => {
    const codes = ['aaaa-bbbb', 'cccc-dddd'];
    const hashes = await hashRecoveryCodes(codes);
    const result = await consumeRecoveryCode('aaaa-bbbb', hashes);
    expect(result.ok).toBe(true);
    expect(result.remaining).toHaveLength(1);
    // the remaining hash must NOT match the consumed code
    const reuse = await consumeRecoveryCode('aaaa-bbbb', result.remaining);
    expect(reuse.ok).toBe(false);
  });

  it('rejects an unknown code without altering the set', async () => {
    const hashes = await hashRecoveryCodes(['aaaa-bbbb']);
    const result = await consumeRecoveryCode('zzzz-zzzz', hashes);
    expect(result.ok).toBe(false);
    expect(result.remaining).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/lib/auth/__tests__/recoveryCodes.test.ts`
Expected: FAIL — cannot resolve `../recoveryCodes`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auth/recoveryCodes.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from './password';

const CODE_COUNT = 10;

// 4 bytes → 8 base32-ish lowercase chars, split as xxxx-xxxx for readability.
const makeCode = (): string => {
  const raw = randomBytes(5).toString('hex').slice(0, 8); // 8 hex chars
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
};

export const generateRecoveryCodes = async (): Promise<string[]> => {
  const codes = new Set<string>();
  while (codes.size < CODE_COUNT) codes.add(makeCode());
  return Array.from(codes);
};

export const hashRecoveryCodes = (codes: string[]): Promise<string[]> =>
  Promise.all(codes.map((c) => hashPassword(c)));

export interface ConsumeResult {
  ok: boolean;
  remaining: string[];
}

// Checks `code` against each stored hash. On match, returns remaining hashes
// with the matched hash removed (single-use). On no match, returns the set
// unchanged.
export const consumeRecoveryCode = async (
  code: string,
  hashes: string[],
): Promise<ConsumeResult> => {
  for (let i = 0; i < hashes.length; i++) {
    if (await verifyPassword(hashes[i], code)) {
      const remaining = hashes.filter((_, idx) => idx !== i);
      return { ok: true, remaining };
    }
  }
  return { ok: false, remaining: hashes };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/lib/auth/__tests__/recoveryCodes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/recoveryCodes.ts src/lib/auth/__tests__/recoveryCodes.test.ts
git commit -m "feat(auth): add recovery code generation, hashing, and consumption"
```

---

## Task 7: Database schema — new tables and chat columns

**Files:**
- Modify: `src/lib/db/schema.ts`

Add the Drizzle table definitions. (The actual SQL migration is Task 8; Drizzle
schema and the SQL file are kept consistent by hand, matching the project's
existing migration workflow.)

- [ ] **Step 1: Add the new tables and columns to the schema**

In `src/lib/db/schema.ts`, after the existing `chats` table definition, append:

```ts
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('passwordHash').notNull(),
  role: text('role', { enum: ['admin', 'user'] })
    .notNull()
    .default('user'),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  mustChangePassword: integer('mustChangePassword', { mode: 'boolean' })
    .notNull()
    .default(false),
  totpSecret: text('totpSecret'),
  totpEnabled: integer('totpEnabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  recoveryCodes: text('recoveryCodes', { mode: 'json' }).$type<string[]>(),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
});

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  tokenHash: text('tokenHash').notNull(),
  role: text('role', { enum: ['admin', 'user'] })
    .notNull()
    .default('user'),
  createdBy: text('createdBy').notNull(),
  expiresAt: text('expiresAt').notNull(),
  usedAt: text('usedAt'),
  usedBy: text('usedBy'),
  createdAt: text('createdAt').notNull(),
});

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  tokenHash: text('tokenHash').notNull(),
  expiresAt: text('expiresAt').notNull(),
  revokedAt: text('revokedAt'),
  replacedBy: text('replacedBy'),
  createdAt: text('createdAt').notNull(),
});
```

- [ ] **Step 2: Add `userId` and `shared` to the existing `chats` table**

In `src/lib/db/schema.ts`, inside the existing `chats = sqliteTable('chats', { ... })` object, add these two fields after the `files` field:

```ts
  userId: text('userId'),
  shared: integer('shared', { mode: 'boolean' }).notNull().default(false),
```

- [ ] **Step 3: Verify the schema compiles**

Run: `yarn tsc --noEmit`
Expected: no new type errors referencing `src/lib/db/schema.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(db): add users, invites, refresh_tokens tables and chat ownership columns"
```

---

## Task 8: Migration SQL (0003)

**Files:**
- Create: `drizzle/0003_auth_foundation.sql`

The project's migration runner (`src/lib/db/migrate.ts`) applies any `.sql` file
not given a special-case branch by splitting on `--> statement-breakpoint` and
executing each statement. `userId` is added nullable (existing rows have no
owner yet; Phase 2 backfills it on admin creation). `shared` defaults to 0.

- [ ] **Step 1: Create the migration file**

Create `drizzle/0003_auth_foundation.sql`:

```sql
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`passwordHash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`mustChangePassword` integer DEFAULT 0 NOT NULL,
	`totpSecret` text,
	`totpEnabled` integer DEFAULT 0 NOT NULL,
	`recoveryCodes` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`tokenHash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`createdBy` text NOT NULL,
	`expiresAt` text NOT NULL,
	`usedAt` text,
	`usedBy` text,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`expiresAt` text NOT NULL,
	`revokedAt` text,
	`replacedBy` text,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `chats` ADD `userId` text;
--> statement-breakpoint
ALTER TABLE `chats` ADD `shared` integer DEFAULT 0 NOT NULL;
```

- [ ] **Step 2: Apply the migration against a throwaway DB**

Run:

```bash
DATA_DIR=$(mktemp -d) sh -c 'mkdir -p "$DATA_DIR/data" && cp -r drizzle "$DATA_DIR/drizzle" && npx tsx src/lib/db/migrate.ts && echo "MIGRATE OK in $DATA_DIR"'
```

Expected: output ends with `Applied migration: 0003_auth_foundation.sql` (and earlier migrations applied/skipped) then `MIGRATE OK`. No errors thrown.

> Note: if `tsx` is unavailable, run via the project's normal migration entrypoint. Check `entrypoint.sh` for how migrations run in this repo and mirror that command.

- [ ] **Step 3: Verify the tables exist in the throwaway DB**

Run (substitute the `$DATA_DIR` path printed above):

```bash
sqlite3 <DATA_DIR>/data/db.sqlite ".tables"
```

Expected: output includes `users`, `invites`, `refresh_tokens`, `chats`, `messages`.

Then verify the new chat columns:

```bash
sqlite3 <DATA_DIR>/data/db.sqlite "PRAGMA table_info(chats);"
```

Expected: rows include `userId` and `shared`.

> If `sqlite3` CLI is not installed, skip Steps 3 and instead trust the Step 2 success output plus the Phase 2 integration that reads/writes these tables.

- [ ] **Step 4: Commit**

```bash
git add drizzle/0003_auth_foundation.sql
git commit -m "feat(db): add 0003 migration for auth foundation tables and chat columns"
```

---

## Task 9: Full suite green

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `yarn test`
Expected: PASS — all auth primitive tests green (password, tokens, jwt, totp, recoveryCodes), no failures.

- [ ] **Step 2: Typecheck the project**

Run: `yarn tsc --noEmit`
Expected: no new errors introduced by Phase 1 files.

- [ ] **Step 3: Commit (only if Steps 1-2 produced any fixes)**

```bash
git add -A
git commit -m "test(auth): verify phase 1 foundation suite green"
```

---

## Self-Review Notes

- **Spec coverage (Phase 1 scope):** password hashing (argon2id) ✓, JWT primitives ✓, opaque token + sha256 for invites/refresh ✓, TOTP ✓, recovery codes (generate/hash/consume) ✓, `users`/`invites`/`refresh_tokens` tables ✓, `chats.userId`/`chats.shared` ✓, migration ✓. Config wiring, routes, middleware, UI, scoping, and admin features are intentionally deferred to Phases 2-6.
- **Type consistency:** `signJwt`/`verifyJwt` share `AuthClaims`/`TokenType`; `consumeRecoveryCode` returns `{ok, remaining}` matching its test; `recoveryCodes.ts` reuses `hashPassword`/`verifyPassword` from `password.ts`. Schema field names (`passwordHash`, `totpEnabled`, `mustChangePassword`, `tokenHash`, `replacedBy`) match the spec's section 3.
- **No placeholders:** every code step contains complete, runnable code.
