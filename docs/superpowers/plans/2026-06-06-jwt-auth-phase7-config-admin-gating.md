# JWT Auth — Phase 7: Admin-gate Global Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close a security gap left after Phase 6: global app config — model providers, **API keys**, SearxNG URL — is editable by any logged-in user, and `GET /api/config` discloses provider API keys to non-admins. Spec §8 requires global config to be admin-managed. Restrict config/provider management to admins, while keeping first-run setup (which has no admin yet) working.

**Architecture:** A `requireAdminUnlessSetup` helper gates the config/provider routes: open during the setup phase (no users exist yet — mirrors the middleware bypass), admin-only once any account exists. `GET /api/providers` stays public (returns models only, no keys — verified). The Settings gear is hidden from non-admins.

**Tech Stack:** TypeScript, Next.js 16, vitest, React.

---

## Findings (verified)

- `GET /api/config` returns `configManager.getCurrentConfig()`, whose `modelProviders[].config` contains **API keys** → readable by any authed user.
- `POST /api/config`, `POST /api/providers`, `PATCH`/`DELETE /api/providers/[id]`, `POST`/`DELETE /api/providers/[id]/models` are guarded only by middleware (any authed user) → a regular user can edit providers/keys/SearxNG.
- `GET /api/providers` returns `{id,name,chatModels,embeddingModels}` only (no `config`/keys) — **safe to remain public**; used by the chat model selector (`ChatModelSelector`, `useChat`) and setup.
- `/api/config/setup-complete` runs during first-run setup (no user) — must stay open.
- Provider mutations ARE used during first-run setup (`AddProviderDialog` POSTs `/api/providers` before any admin exists) — so the gate must allow the setup phase.
- `/api/config` GET/POST is consumed only by the Settings UI (admin-only after this change); model selection does not use it.

---

## Task 1: requireAdminUnlessSetup helper + gate config/provider routes

**Files:**
- Modify `src/lib/auth/getAuthUser.ts`
- Modify `src/app/api/config/route.ts`, `src/app/api/providers/route.ts`, `src/app/api/providers/[id]/route.ts`, `src/app/api/providers/[id]/models/route.ts`

- [ ] **Step 1: Add the helper to `src/lib/auth/getAuthUser.ts`.** Add `import { countUsers } from './users';` (note: `users.ts` imports nothing from `getAuthUser.ts`, so no import cycle). Append:

```ts
// Gate for global-config routes: open during first-run setup (no account
// exists yet — the setup wizard adds providers before an admin is created),
// admin-only once any user exists. Returns null when allowed in the setup
// phase, the AuthUser when an admin is authenticated, or a 401/403 Response.
export const requireAdminUnlessSetup = async (
  req: NextRequest,
): Promise<AuthUser | null | Response> => {
  if ((await countUsers()) === 0) return null; // setup phase — allow
  return requireAdmin(req);
};
```

- [ ] **Step 2: Gate `GET` and `POST` in `src/app/api/config/route.ts`.** Add `import { requireAdminUnlessSetup } from '@/lib/auth/getAuthUser';`. At the very start of BOTH the `GET` and `POST` handler `try` blocks, add:

```ts
    const gate = await requireAdminUnlessSetup(req);
    if (gate instanceof Response) return gate;
```

(Place after `try {`. The handlers already take `req: NextRequest`.)

- [ ] **Step 3: Gate `POST` in `src/app/api/providers/route.ts`.** Add the import. The file's `GET` stays UNGATED (public model list). In `POST` only, add the same `gate` check at the start of the try block. (POST's signature is already `NextRequest`; leave `GET`'s `Request` as-is.)

- [ ] **Step 4: Gate `PATCH` + `DELETE` in `src/app/api/providers/[id]/route.ts`.** Add the import; add the `gate` check at the start of BOTH handlers' try blocks. These handlers receive `(req, { params })` — ensure `req` is typed `NextRequest` (change from `Request` if needed so `requireAdminUnlessSetup(req)` typechecks).

- [ ] **Step 5: Gate `POST` + `DELETE` in `src/app/api/providers/[id]/models/route.ts`.** Same — import + `gate` check at the start of both handlers; `req` typed `NextRequest`.

- [ ] **Step 6: Do NOT gate `src/app/api/config/setup-complete/route.ts`** (runs during setup before any user) and do NOT gate `GET /api/providers`.

- [ ] **Step 7: Typecheck + build.** `yarn tsc --noEmit` (exit 0), `yarn build 2>&1 | tail -10`.

- [ ] **Step 8: Commit.**

```bash
git add src/lib/auth/getAuthUser.ts src/app/api/config/route.ts src/app/api/providers/route.ts 'src/app/api/providers/[id]/route.ts' 'src/app/api/providers/[id]/models/route.ts'
git commit -m "fix(auth): restrict config/provider management to admins (open during setup)"
```

---

## Task 2: Hide Settings from non-admins

**Files:**
- Modify `src/components/Settings/SettingsButton.tsx` (and `SettingsButtonMobile.tsx` if it renders the gear separately)

The Settings dialog now only does admin operations (providers/keys/search/global preferences via `/api/config`). Hide its entry point from non-admins.

- [ ] **Step 1: Read** `src/components/Settings/SettingsButton.tsx` (and `SettingsButtonMobile.tsx`). Determine where the gear/trigger renders.

- [ ] **Step 2: Gate on admin role.** Add a one-time role fetch (same pattern as the Sidebar admin link from Phase 6):

```tsx
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((d) => setIsAdmin(d.user?.role === 'admin'))
      .catch(() => {});
  }, []);
```

Render the settings trigger only when `isAdmin` (return `null` otherwise). Apply to both the desktop and mobile settings buttons. Add `'use client'` + `useState`/`useEffect` imports if missing (check first).

> Note: this is a UI gate only — the API is the real control (Task 1). A non-admin who hits `/api/config` directly still gets 403.

- [ ] **Step 3: Typecheck + build.** `yarn tsc --noEmit` (exit 0), `yarn build 2>&1 | tail -10`.

- [ ] **Step 4: Commit.**

```bash
git add src/components/Settings/SettingsButton.tsx src/components/Settings/SettingsButtonMobile.tsx
git commit -m "fix(auth): hide settings entry from non-admin users"
```

---

## Task 3: Docs + suite + smoke

**Files:**
- Modify `docs/API/AUTH.md` (or `docs/API/SEARCH.md`) — note config admin-gating.

- [ ] **Step 1: Document** that `/api/config` (GET + POST) and the `/api/providers` mutations (`POST`, and `/[id]` `PATCH`/`DELETE`, `/[id]/models` `POST`/`DELETE`) require an admin once setup is complete (open during first-run setup); `GET /api/providers` is available to any authenticated user (model list, no secrets). Commit.

- [ ] **Step 2: Suite + typecheck.** `yarn test` (still 65 pass) + `yarn tsc --noEmit` (exit 0).

- [ ] **Step 3: Smoke** (throwaway DATA_DIR dev server). Bootstrap admin, invite+accept `bob`, then:

```bash
# admin can read config (with provider config) → 200
curl -s -b /tmp/a.cookies localhost:3111/api/config -o /dev/null -w 'admin GET config [%{http_code}]\n'   # 200
# bob (non-admin) reading config → 403 (no key disclosure)
curl -s -b /tmp/b.cookies localhost:3111/api/config -o /dev/null -w 'bob GET config [%{http_code}]\n'      # 403
# bob adding a provider → 403
curl -s -b /tmp/b.cookies -X POST localhost:3111/api/providers -H 'Content-Type: application/json' -d '{"type":"openai","name":"x","config":{}}' -o /dev/null -w 'bob POST provider [%{http_code}]\n'  # 403
# bob can still read the public model list → 200
curl -s -b /tmp/b.cookies localhost:3111/api/providers -o /dev/null -w 'bob GET providers [%{http_code}]\n'  # 200
# admin can still POST config → not 403 (200/400 depending on body)
curl -s -b /tmp/a.cookies -X POST localhost:3111/api/config -H 'Content-Type: application/json' -d '{"key":"preferences.theme","value":"dark"}' -o /dev/null -w 'admin POST config [%{http_code}]\n'
```

Confirm: admin 200, bob 403 on config GET + provider POST, bob 200 on `GET /api/providers`. (Setup-phase openness is already covered by the existing bootstrap flow — the instance configures providers before the admin exists.) Stop the server + clean up; only kill the server you started.

- [ ] **Step 4: Commit if fixes needed.**

---

## Self-Review Notes

- **Spec §8 closed:** global config (providers/keys/SearxNG) is now admin-managed; `GET /api/config` no longer discloses keys to non-admins.
- **Setup preserved:** the `countUsers()===0` allowance keeps first-run provider configuration working before any admin exists.
- **Model selection preserved:** `GET /api/providers` (no secrets) stays public; the chat model selector and `useChat` use it, not `/api/config`.
- **Defense:** API is the control (Task 1); the Settings-hide (Task 2) is UX only.
- **No placeholders:** every step has concrete code/edits.
