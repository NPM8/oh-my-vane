# Multi-User JWT Auth + Optional TOTP 2FA — Design

**Date:** 2026-06-06
**Status:** Approved (pending spec review)
**Component:** Authentication / accounts for Vane

## 1. Summary

Vane is currently a single-user, self-hosted AI answering engine with no
authentication. Chats, messages, and config are global. This design adds
multi-user accounts with JWT-based auth, invitation-only onboarding (no
registration page, no email sent from the app), optional TOTP 2FA via
authenticator apps, and per-user data isolation with opt-in shareable chats.

### Goals

- JWT auth following current best security practices.
- No public registration. Account creation only via admin-issued, single-use,
  expiring invitation links.
- The app never sends email (no email-based flows anywhere).
- Optional TOTP 2FA (authenticator apps) with recovery codes, admin enforce,
  and admin reset.
- Per-user data isolation: each user sees only their own chats/history.
- A chat can be flagged **shared**: any logged-in user can view it (read-only).
- Backwards compatible with existing single-user installs.

### Non-goals (YAGNI for v1)

- Email of any kind (reset, verification, notifications).
- OAuth / SSO / external identity providers.
- Per-user app config (model providers, API keys, SearxNG stay global,
  admin-managed in `config.json`).
- TOTP-secret encryption-at-rest (DB file already holds all app data).
- Audit logging.
- Password-reset for users via self-service (handled by admin reset instead).

## 2. Approach

**Thin custom auth layer on vetted primitives.** No full auth framework
(Auth.js/Lucia) — they fight the invite-only, no-email, custom-TOTP model and
add more glue than they save.

Libraries:

- `jose` — JWT sign/verify (Edge-compatible, used in middleware).
- `otplib` — TOTP generation/verification.
- `argon2` (or `@node-rs/argon2`) — password + recovery-code hashing (argon2id).
- `qrcode` — QR rendering for 2FA enrollment.

Stack already in place: Next.js 16, Drizzle ORM, better-sqlite3.

## 3. Data Model

New Drizzle/SQLite tables.

```ts
// users
users = {
  id: text (uuid) PK,
  username: text unique notNull,
  passwordHash: text notNull,          // argon2id
  role: text enum['admin','user'] default 'user',
  disabled: integer(bool) default 0,
  mustChangePassword: integer(bool) default 0,  // forced change after admin reset
  totpSecret: text nullable,           // null = no 2FA secret
  totpEnabled: integer(bool) default 0,
  recoveryCodes: text(json) nullable,  // array of argon2-hashed one-time codes
  createdAt: text, updatedAt: text,
}

// invites
invites = {
  id: text(uuid) PK,
  tokenHash: text notNull,             // sha256(raw token); raw only ever in link
  role: text enum['admin','user'] default 'user',
  createdBy: text -> users.id,
  expiresAt: text notNull,
  usedAt: text nullable,               // single-use: null until consumed
  usedBy: text nullable -> users.id,
  createdAt: text,
}

// refresh_tokens (rotation + revocation)
refreshTokens = {
  id: text(uuid) PK,                   // == jti claim in refresh JWT
  userId: text -> users.id,
  tokenHash: text notNull,             // sha256(refresh token)
  expiresAt: text notNull,
  revokedAt: text nullable,
  replacedBy: text nullable,           // rotation chain → reuse detection
  createdAt: text,
}
```

Changes to existing tables:

```ts
chats += {
  userId: text -> users.id,            // owner (nullable at migrate, backfilled)
  shared: integer(bool) default 0,     // 1 = any logged-in user can view (read-only)
}
// messages inherit scope via chatId — no direct userId column.
```

Notes:

- Invite raw token: 32 random bytes (base64url), present only in the URL; DB
  stores `sha256` only → DB leak does not yield usable invites.
- Recovery codes hashed with argon2; plaintext shown exactly once at generation.
- Refresh tokens hashed + rotation chain; reuse of a revoked token revokes the
  whole chain.

## 4. Auth Flow + Tokens

### Login — `POST /api/auth/login`

1. `{username, password}` → fetch user, argon2 verify. Failure → generic 401
   (no user-enumeration). `disabled` user → 401.
2. If `totpEnabled` → respond `{mfaRequired:true, mfaToken}` where `mfaToken`
   is a short (~5m) signed JWT with `purpose:'mfa'`. No session cookies yet.
3. Else issue session (below).

### MFA verify — `POST /api/auth/mfa` (only when step 2 triggered)

- `{mfaToken, code}` → verify `mfaToken`, then `otplib` TOTP check (±1 window)
  OR recovery-code match (argon2; consume the matched code). Pass → issue
  session.

### Issue session

- **Access JWT:** `jose` HS256, secret from `auth.jwtSecret` (or `JWT_SECRET`
  env). TTL ~2h (configurable). Claims: `sub`, `role`, `username`,
  `type:'access'`.
- **Refresh token:** 32 random bytes, opaque. Row in `refresh_tokens`
  (hash + ~30d expiry). Refresh JWT `jti` == row id.
- Both set as cookies: `httpOnly`, `SameSite=Lax`, `Path=/`, and `Secure`
  **only when the request is HTTPS** (adaptive — works on plain-HTTP LAN /
  localhost; `FORCE_SECURE_COOKIES` env can override). Access cookie maxAge =
  access TTL; refresh cookie maxAge = refresh TTL.

### Refresh — `POST /api/auth/refresh`

- Read refresh cookie → hash → look up row.
- Valid + not revoked + not expired → **rotate**: revoke old row, issue new
  pair, set old `replacedBy`.
- Row already revoked (reuse detected) → revoke entire chain for that user →
  401, force re-login.

### Logout — `POST /api/auth/logout`

- Revoke refresh row, clear both cookies.

### Hardening

- Login rate-limit per IP+username (in-memory token bucket; SQLite counter
  optional later).
- Argon2id params per OWASP (m≈19MB, t=2, p=1).
- Generic error messages; avoid timing/enumeration leaks.
- Long-running generations are safe: in-flight requests/SSE streams authorize
  at connect and run to completion; longer access TTL + silent refresh avoids
  mid-use logout.

## 5. 2FA (TOTP) Lifecycle

- **Enroll** `POST /api/account/2fa/setup`: gen TOTP secret, store as *pending*
  (not yet `totpEnabled`). Return `otpauth://` URI + secret; frontend renders QR.
- **Confirm** `POST /api/account/2fa/enable`: `{code}` verified against pending
  secret → set `totpEnabled=1`, persist secret, generate 10 recovery codes
  (plaintext returned once, argon2 hashes stored).
- **Disable** `POST /api/account/2fa/disable`: require `{password}` + current
  `{code}` (re-auth) → clear secret, `totpEnabled=0`, recovery codes.
- **Recovery code use:** at login MFA step — match against hashed codes, consume
  on use; warn when few remain.
- **Admin require-2FA** (global flag `auth.requireTwoFactor`): when on, any user
  with `totpEnabled=0` gets a session but is force-redirected to
  `/account/2fa/setup`; all other routes blocked until enrolled (admin included).
- **Admin reset** `POST /api/admin/users/:id/2fa/reset`: admin-only; clears
  target's TOTP secret/enabled/recovery codes.

Libraries: `otplib`, `qrcode`. TOTP secrets stored plaintext (required to
verify; encryption-at-rest deferred — YAGNI).

## 6. Invitations

- **Create** (admin) `POST /api/admin/invites`: `{role?, ttlHours? (default 48)}`.
  Gen raw token (32B base64url); store `tokenHash=sha256(raw)`, `expiresAt`,
  `createdBy`, `role`. Return link once: `${origin}/invite/${raw}`.
- **List/revoke** (admin): `GET /api/admin/invites` (pending/used/expired; never
  shows raw token). `DELETE /api/admin/invites/:id` revokes unused.
- **Accept** (public, no auth):
  - `GET /invite/[token]` page → `POST /api/auth/invite/validate {token}` checks
    exists / unused / not expired. Valid → render set-account form.
  - `POST /api/auth/invite/accept {token, username, password}`:
    - Atomic single-use guard:
      `UPDATE invites SET usedAt=? WHERE id=? AND usedAt IS NULL` (race-safe).
    - Validate username unique + password policy (min length ~10, max length cap).
    - Create user (argon2id, role from invite), mark invite `usedBy`.
    - Auto-login: issue session. If require-2FA on, redirect to enroll.
- **Security:** single-use enforced atomically (not check-then-write); raw token
  only in URL; expired invites swept lazily on validate (no cron). UX may
  distinguish expired vs used (low risk).

## 7. Middleware + Data Scoping

### Middleware (`src/middleware.ts`)

- Runs on all routes except `/api/auth/*`, `/invite/*`, `/login`, static assets.
- Reads access cookie → `jose` verify (Edge-compatible). Invalid/expired →
  redirect `/login` (pages) or 401 (APIs). Client interceptor calls
  `/api/auth/refresh` on 401 then retries.
- Gate order: `mustChangePassword` → force `/account/password`;
  `requireTwoFactor` + not enrolled → force `/account/2fa/setup`. Both block all
  other routes (except their own route, relevant APIs, logout).
- `/api/admin/*` and admin UI → role check; non-admin → 403.

### Helper

- `getAuthUser(req)` — verifies JWT, returns `{id, role, username}` or null;
  used in every protected API route for type-safe access.

### Chat scoping

- `GET /api/chats` → `where userId = me`.
- Chat read (`/c/[chatId]` data) → allow if `userId==me` OR `shared==1`;
  else **404** (not 403 → no existence leak).
- Create chat → `userId=me`.
- Mutations (delete/rename/share-toggle) → owner-only.
- Messages → scoped via `chatId`, same rule.
- **Share toggle** `PATCH /api/chats/:id/share {shared}`: owner-only.
- **Shared chats are read-only to non-owners** — view only, cannot append
  messages. Owner continues normally.

### Streaming

- In-memory `SessionManager` (SSE) tied to authed user; cookie verified on SSE
  connect. All stream endpoints behind middleware.

## 8. Admin Management Surface

Admin (role `admin`) can:

- Generate / list / revoke invites.
- List users; disable/enable; delete.
- Reset a user's 2FA (`/api/admin/users/:id/2fa/reset`).
- Reset a user's password (`/api/admin/users/:id/password/reset`) — sets a temp
  password (shown once) and `mustChangePassword=1`; user forced to change on
  next login.
- Edit global app config (model providers / API keys / SearxNG).
- Toggle `requireTwoFactor`.

Regular users manage only their own chats and account (password change, 2FA
enroll/disable, recovery codes).

## 9. Backwards Compatibility + Migration

### Existing installs (setupComplete=true, zero users, orphan chats)

- On boot, check `users` count.
- **0 users** → app locked into a bootstrap admin gate regardless of
  `setupComplete`; forces admin creation before the app is usable.
- On admin creation, **claim orphan data**:
  `UPDATE chats SET userId=<adminId> WHERE userId IS NULL`. Existing history
  becomes the admin's (messages follow via `chatId`).

### Fresh installs

- SetupWizard gains an admin-account step (username + password) alongside config
  steps. `setupComplete` becomes true only after an admin exists.

### Drizzle migration

- New tables: `users`, `invites`, `refresh_tokens`.
- `ALTER chats ADD userId text` (nullable at migrate, backfilled on admin claim),
  `ADD shared integer default 0`.
- Follows existing `src/lib/db/migrate.ts` custom-migrator pattern.

### Config additions (`config.json`, admin-managed)

- `auth.requireTwoFactor: bool`
- `auth.jwtSecret: string` (autogen 32B on first boot if absent, persisted;
  `JWT_SECRET` env overrides)
- `auth.accessTtlMin` (default 120), `auth.refreshTtlDays` (default 30)

### Env (docker)

- `JWT_SECRET` — override config secret (keep out of data dir if preferred).
- `FORCE_SECURE_COOKIES` — force `Secure` flag; otherwise auto from request proto.

## 10. Frontend Additions

- Pages: `/login`, `/invite/[token]`, `/account` (password change, 2FA enroll,
  recovery codes), admin `/admin/users`, admin `/admin/invites`.
- Auth context/hook; fetch interceptor (401 → `/api/auth/refresh` → retry).
- Logout control; share toggle on chats; read-only rendering for non-owner
  shared chats.

### UI consistency + mobile (mandatory for all auth UI)

All new screens (login, invite-accept, account/2FA, admin panel) MUST match the
existing Vane design language and be mobile-friendly. Concretely:

- **Theme tokens:** use Tailwind theme colors `light-primary`/`light-secondary`
  and `dark-primary`/`dark-secondary` (defined in `tailwind.config.ts`), accent
  `#24A0ED`, border tokens `light-200`/`dark-200`. Support light + dark via the
  existing `next-themes` `class` strategy — never hardcode raw hex backgrounds.
- **Components:** reuse existing primitives — `@headlessui/react` `Dialog`/
  `DialogPanel` (as in `SettingsDialogue.tsx`), `lucide-react` icons,
  `framer-motion` for transitions, `sonner` `toast` for feedback, and the shared
  `ui/` components (`Select`, `Loader`). Match `SettingsDialogue.tsx` layout
  patterns for the admin panel (sidebar sections + content pane that collapses
  to a single column on mobile).
- **Typography:** Montserrat (already the app font) for body; the
  Instrument/PP-Editorial display fonts only where the app already uses them
  (e.g. welcome screens).
- **Responsiveness:** layouts must work from 320px up. Use the app's existing
  responsive breakpoints (`md:`, `xl:`). Forms single-column on mobile; the admin
  panel collapses its section nav into the content flow on small screens, mirroring
  `SettingsButtonMobile.tsx`. Touch targets ≥ 40px.
- **Login/invite screens** follow the full-screen centered pattern used by
  `SetupWizard.tsx` (`bg-light-primary dark:bg-dark-primary` full-viewport,
  centered card).

## 11. API Documentation (mandatory for all auth endpoints)

Every phase that adds HTTP endpoints MUST document them in `docs/API/` before the
phase is considered complete. Create and maintain `docs/API/AUTH.md` matching the
existing `docs/API/SEARCH.md` style:

- Group by area: Authentication, Account, Invitations, Admin.
- For each endpoint: method + path, full-URL example, purpose, request body
  (JSON example + per-field parameter list), response example(s), and an
  Error Handling list of status codes (400/401/403/404/409/500) with meaning.
- Document cookie behavior (httpOnly access + refresh, adaptive `Secure`) and the
  401→refresh→retry contract once, in an overview section.
- Note auth requirements per endpoint (public / authenticated / admin-only) and
  the 2FA `mfaRequired` two-step login response.

Each later phase-plan includes an explicit task to update `docs/API/AUTH.md` for
the endpoints it introduces. Phase 1 adds no endpoints, so it touches no API docs.

## 12. Open Risks / Notes

- `jose` HS256 secret rotation invalidates all access tokens (acceptable;
  refresh forces re-login).
- TOTP secrets + recovery-code hashes live in the SQLite file — protect the data
  dir; encryption-at-rest deferred.
- Rate-limiter is in-memory (per-process); multi-process deployments would need a
  shared store later.
