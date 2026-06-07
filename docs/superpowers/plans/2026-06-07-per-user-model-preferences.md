# Per-User Model Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make each user's preferred chat model, embedding model, and system instructions follow their **account** (server-side, cross-device) instead of living in browser `localStorage`. Migrate any existing localStorage selection up once.

**Architecture:** A nullable `users.preferences` JSON column holds the per-user blob. A `/api/account/preferences` route reads/merges it. `useChat` loads prefs from the server on startup (seeding from localStorage once if the account has none), persists model-selection changes to the server, and reads the user's system instructions from prefs at send time. An Account-page field lets a user set their own system instructions (relevant now that global config is admin-only).

**Tech Stack:** TypeScript, Next.js 16, Drizzle + better-sqlite3, vitest, React.

---

## Preferences shape

```ts
interface UserPreferences {
  chatModelKey?: string;
  chatModelProviderId?: string;
  embeddingModelKey?: string;
  embeddingModelProviderId?: string;
  systemInstructions?: string;
}
```

Stored as JSON in `users.preferences` (nullable). Today these live in `localStorage`
(`useChat.tsx:90-93,153-156,791`, `ChatModelSelector.tsx:61-62`).

---

## Task 1: Schema + migration

**Files:** Modify `src/lib/db/schema.ts`; Create `drizzle/0004_user_preferences.sql`.

- [ ] **Step 1: Add column to `src/lib/db/schema.ts`** — in the `users` table, after `recoveryCodes`:

```ts
  preferences: text('preferences', { mode: 'json' }).$type<{
    chatModelKey?: string;
    chatModelProviderId?: string;
    embeddingModelKey?: string;
    embeddingModelProviderId?: string;
    systemInstructions?: string;
  }>(),
```

- [ ] **Step 2: Create `drizzle/0004_user_preferences.sql`:**

```sql
ALTER TABLE `users` ADD `preferences` text;
```

- [ ] **Step 3: Apply on a throwaway DB** (mirrors prior phases):

```bash
TMP=$(mktemp -d); mkdir -p "$TMP/data"; cp -r drizzle "$TMP/drizzle"; DATA_DIR="$TMP" npx tsx src/lib/db/migrate.ts 2>&1 | tail -3; echo "EXIT ${PIPESTATUS[0]}"
```
Expected: `Applied migration: 0004_user_preferences.sql`, EXIT 0. `yarn tsc --noEmit` exit 0.

- [ ] **Step 4: Commit.**

```bash
git add src/lib/db/schema.ts drizzle/0004_user_preferences.sql
git commit -m "feat(db): add users.preferences column for per-user model prefs"
```

---

## Task 2: Preferences repository

**Files:** Modify `src/lib/auth/users.ts`; Test `src/lib/auth/__tests__/preferences.integration.test.ts`.

- [ ] **Step 1: Write the failing integration test** (temp-DB pattern as in other repo tests):

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let users: typeof import('../users');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-prefs-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], { env: { ...process.env, DATA_DIR: dir }, stdio: 'inherit' });
  users = await import('../users');
});

describe('user preferences', () => {
  it('defaults to empty and merges on update', async () => {
    const u = await users.createUser({ username: 'p', password: 'password-1234', role: 'user' });
    expect(await users.getUserPreferences(u.id)).toEqual({});

    await users.setUserPreferences(u.id, { chatModelKey: 'gpt-4o', chatModelProviderId: 'pid' });
    expect(await users.getUserPreferences(u.id)).toEqual({ chatModelKey: 'gpt-4o', chatModelProviderId: 'pid' });

    // merge: only-changed keys update, others persist
    await users.setUserPreferences(u.id, { systemInstructions: 'be terse' });
    expect(await users.getUserPreferences(u.id)).toEqual({
      chatModelKey: 'gpt-4o', chatModelProviderId: 'pid', systemInstructions: 'be terse',
    });
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `yarn vitest run src/lib/auth/__tests__/preferences.integration.test.ts`.

- [ ] **Step 3: Append to `src/lib/auth/users.ts`:**

```ts
export interface UserPreferences {
  chatModelKey?: string;
  chatModelProviderId?: string;
  embeddingModelKey?: string;
  embeddingModelProviderId?: string;
  systemInstructions?: string;
}

export const getUserPreferences = async (id: string): Promise<UserPreferences> => {
  const u = await db.query.users.findFirst({ where: eq(users.id, id) });
  return (u?.preferences as UserPreferences | null) ?? {};
};

// Shallow-merge the patch into the stored preferences.
export const setUserPreferences = async (
  id: string,
  patch: UserPreferences,
): Promise<UserPreferences> => {
  const current = await getUserPreferences(id);
  const merged = { ...current, ...patch };
  await db
    .update(users)
    .set({ preferences: merged, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id));
  return merged;
};
```

- [ ] **Step 4: Run, verify PASS** (1 test). `yarn tsc --noEmit` exit 0.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/users.ts src/lib/auth/__tests__/preferences.integration.test.ts
git commit -m "feat(auth): add per-user preferences repository (get + merge)"
```

---

## Task 3: Preferences API route

**Files:** Create `src/app/api/account/preferences/route.ts`.

- [ ] **Step 1: Implement** (authenticated; `/api/account/*` is middleware-guarded + exempt from the require-2FA gate):

```ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/getAuthUser';
import { getUserPreferences, setUserPreferences } from '@/lib/auth/users';

export const runtime = 'nodejs';

export const GET = async (req: NextRequest) => {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    return Response.json({ preferences: await getUserPreferences(auth.id) }, { status: 200 });
  } catch (err) {
    console.error('Error reading preferences: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};

const schema = z.object({
  chatModelKey: z.string().max(200).optional(),
  chatModelProviderId: z.string().max(200).optional(),
  embeddingModelKey: z.string().max(200).optional(),
  embeddingModelProviderId: z.string().max(200).optional(),
  systemInstructions: z.string().max(10000).optional(),
});

export const PUT = async (req: NextRequest) => {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'Invalid preferences.' }, { status: 400 });
    }
    const preferences = await setUserPreferences(auth.id, parsed.data);
    return Response.json({ preferences }, { status: 200 });
  } catch (err) {
    console.error('Error saving preferences: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit` exit 0.

- [ ] **Step 3: Commit.**

```bash
git add src/app/api/account/preferences/route.ts
git commit -m "feat(account): add GET/PUT preferences route"
```

---

## Task 4: Load + persist model selection via the server in useChat

**Files:** Modify `src/lib/hooks/useChat.tsx`.

READ the file. Key spots:
- `checkConfig(...)` (~line 88-166): reads `localStorage` for `chatModelKey`/`chatModelProviderId`/`embeddingModelKey`/`embeddingModelProviderId`, resolves against providers, writes back to `localStorage`.
- send (~line 791): `systemInstructions: localStorage.getItem('systemInstructions')`.
- The provider exposes `setChatModelProvider` / `setEmbeddingModelProvider`.

- [ ] **Step 1: Make `checkConfig` server-first.** Before reading localStorage, fetch the account prefs and prefer them; fall back to localStorage (one-time migration), then to defaults. Replace the four `localStorage.getItem(...)` seeds at the top of `checkConfig` with:

```tsx
    let serverPrefs: Record<string, string | undefined> = {};
    try {
      const r = await fetch('/api/account/preferences');
      if (r.ok) serverPrefs = (await r.json()).preferences ?? {};
    } catch {
      /* fall back to localStorage below */
    }

    let chatModelKey = serverPrefs.chatModelKey ?? localStorage.getItem('chatModelKey') ?? undefined;
    let chatModelProviderId = serverPrefs.chatModelProviderId ?? localStorage.getItem('chatModelProviderId') ?? undefined;
    let embeddingModelKey = serverPrefs.embeddingModelKey ?? localStorage.getItem('embeddingModelKey') ?? undefined;
    let embeddingModelProviderId = serverPrefs.embeddingModelProviderId ?? localStorage.getItem('embeddingModelProviderId') ?? undefined;
```

(Adjust types to the file's existing `let` declarations — they may be `string | null`; keep them assignable. The rest of `checkConfig`'s resolution against `providers` stays unchanged.)

- [ ] **Step 2: After the selection is resolved** (where it currently does the four `localStorage.setItem(...)`), ALSO persist to the server so the resolved/migrated values stick to the account:

```tsx
    localStorage.setItem('chatModelKey', chatModelKey);
    localStorage.setItem('chatModelProviderId', chatModelProviderId);
    localStorage.setItem('embeddingModelKey', embeddingModelKey);
    localStorage.setItem('embeddingModelProviderId', embeddingModelProviderId);
    // Persist the resolved selection to the account (cross-device). Fire-and-forget.
    fetch('/api/account/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatModelKey, chatModelProviderId, embeddingModelKey, embeddingModelProviderId }),
    }).catch(() => {});
```

(Keep the localStorage writes as a local cache; the server is the source of truth on next load.)

- [ ] **Step 3: Persist on explicit change.** Find `setChatModelProvider`/`setEmbeddingModelProvider` usage. The cleanest single choke point is `ChatModelSelector` (Task 5) and any embedding selector — they will PUT directly. No change needed here beyond Step 2 if selectors persist themselves. (If the provider has a wrapper setter, you may route the PUT there instead; either is fine as long as a model change reaches the server.)

- [ ] **Step 4: System instructions from prefs at send.** Replace `systemInstructions: localStorage.getItem('systemInstructions')` (~line 791) with a value sourced from the loaded prefs. Add `systemInstructions` to the provider state (default `''`), set it in `checkConfig` from `serverPrefs.systemInstructions ?? localStorage.getItem('systemInstructions') ?? ''`, expose it + a `setSystemInstructions` in context, and use the state value at send. (Account page in Task 6 sets it.)

- [ ] **Step 5: Typecheck + build.** `yarn tsc --noEmit` exit 0; `yarn build 2>&1 | tail -10`.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/hooks/useChat.tsx
git commit -m "feat(chat): load/persist model selection + system instructions per account"
```

---

## Task 5: Persist chat-model selection from the selector

**Files:** Modify `src/components/MessageInputActions/ChatModelSelector.tsx`.

- [ ] **Step 1: READ it.** `handleModelSelect(providerId, modelKey)` (~line 59-62) currently sets the provider + writes localStorage.

- [ ] **Step 2: Also persist to the server** in `handleModelSelect`, after the existing localStorage writes:

```tsx
    localStorage.setItem('chatModelProviderId', providerId);
    localStorage.setItem('chatModelKey', modelKey);
    fetch('/api/account/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatModelProviderId: providerId, chatModelKey: modelKey }),
    }).catch(() => {});
```

(If an embedding-model selector with the same pattern exists and is user-reachable, apply the same PUT for its keys. The Settings `ModelSelect` is admin-only; leave it unless trivial.)

- [ ] **Step 3: Typecheck + build.** Commit.

```bash
git add src/components/MessageInputActions/ChatModelSelector.tsx
git commit -m "feat(chat): persist chat-model choice to the account on selection"
```

---

## Task 6: Per-user system-instructions field on Account

**Files:** Create `src/components/Account/SystemInstructionsSection.tsx`; Modify `src/components/Account/AccountView.tsx`.

- [ ] **Step 1: Implement** `SystemInstructionsSection.tsx` — loads current value from `GET /api/account/preferences`, saves via `PUT { systemInstructions }`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

const SystemInstructionsSection = () => {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/account/preferences')
      .then((r) => (r.ok ? r.json() : { preferences: {} }))
      .then((d) => setValue(d.preferences?.systemInstructions ?? ''))
      .catch(() => {});
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      const res = await fetch('/api/account/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstructions: value }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('System instructions saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border border-light-200 dark:border-dark-200 rounded-xl p-5 flex flex-col space-y-3">
      <h2 className="text-sm font-medium text-black dark:text-white">System instructions</h2>
      <p className="text-xs text-black/50 dark:text-white/50">
        Personal instructions added to every search you run. Saved to your account.
      </p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        placeholder="e.g. Always answer concisely and cite sources."
        className="w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]"
      />
      <button
        onClick={save}
        disabled={saving}
        className="self-start px-4 py-2 rounded-lg bg-[#24A0ED] text-white hover:bg-[#1e8fd1] text-sm font-medium disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </section>
  );
};

export default SystemInstructionsSection;
```

- [ ] **Step 2: Render it in `AccountView.tsx`** — import and add `<SystemInstructionsSection />` as a section (alongside Password + Two-factor). Keep existing sections + `forceEnroll` behavior intact.

- [ ] **Step 3: Typecheck + build.** Commit.

```bash
git add src/components/Account/SystemInstructionsSection.tsx src/components/Account/AccountView.tsx
git commit -m "feat(account): add per-user system instructions field"
```

---

## Task 7: Suite + smoke + docs

**Files:** Modify `docs/ADMIN.md`.

- [ ] **Step 1: Suite + typecheck.** `yarn test` (all prior + new prefs test pass) + `yarn tsc --noEmit` (exit 0).

- [ ] **Step 2: Smoke** (throwaway DATA_DIR dev server). Bootstrap admin, invite+accept `bob`, then:

```bash
# admin saves a chat-model pref
curl -s -b /tmp/a.cookies -X PUT localhost:3111/api/account/preferences -H 'Content-Type: application/json' -d '{"chatModelKey":"gpt-4o","chatModelProviderId":"p1","systemInstructions":"admin-only note"}' -w '\n[%{http_code}]\n'
# admin reads back → has those values
curl -s -b /tmp/a.cookies localhost:3111/api/account/preferences
# bob reads → EMPTY (does NOT see admin's prefs)
curl -s -b /tmp/b.cookies localhost:3111/api/account/preferences
# bob saves his own → independent
curl -s -b /tmp/b.cookies -X PUT localhost:3111/api/account/preferences -H 'Content-Type: application/json' -d '{"chatModelKey":"o3"}' -w '\n[%{http_code}]\n'
# admin re-reads → still admin's values (not overwritten by bob)
curl -s -b /tmp/a.cookies localhost:3111/api/account/preferences
# unauth → 401
curl -s localhost:3111/api/account/preferences -w '\n[%{http_code}]\n'
```
Expected: per-user isolation (admin ≠ bob), merge works, unauth 401. Record results; stop server + clean up.

- [ ] **Step 3: Doc note** in `docs/ADMIN.md` (Account section): chat/embedding model + system instructions are saved **per user** (server-side, cross-device); previously they were per-browser. Commit.

```bash
git add docs/ADMIN.md
git commit -m "docs: note per-user model preferences"
```

---

## Self-Review Notes

- **Scope:** per-user chat model, embedding model, system instructions (the localStorage-backed prefs). Migrates localStorage up once (server wins thereafter).
- **Isolation:** prefs keyed by `auth.id` via `requireAuth`; one user cannot read/write another's (route only ever touches the caller's row). Mirrors the per-user chat scoping.
- **Type consistency:** `UserPreferences` shared by schema `$type`, repo, route zod, and useChat usage.
- **No DB reset:** additive nullable column; existing rows get `NULL` → treated as `{}`.
- **Watch-list:** embedding-model selection UI is admin-only (Settings) for now; non-admins' embedding pref is whatever `useChat` resolves/defaults and then persists. A user-facing embedding picker is out of scope.
- **No placeholders:** backend complete; useChat steps give exact insertion points + the file must be read first.
