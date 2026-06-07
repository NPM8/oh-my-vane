# Vane — Authentication & Admin Guide

Vane supports multi-user accounts with JWT authentication, invitation-only
onboarding (no public sign-up, no email), optional TOTP two-factor
authentication, per-user chat isolation with opt-in shareable chats, and an
admin management surface.

This guide covers first-run setup, deployment/config, and day-to-day admin
operations.

---

## 1. First run (fresh install)

1. Start Vane (e.g. `docker compose up -d`, or `yarn build && yarn start`).
2. Open the app. The **Setup Wizard** appears — configure your model
   providers (API keys) and select models, then **Finish**. (Setup runs before
   any account exists, so it does not require login.)
3. After setup, the **Create admin account** screen appears. Choose a username
   and password (min 10 characters). This is the first and only account with
   full control. There is no public sign-up page — you invite everyone else.
4. You are logged in as the admin.

That's it — migrations and the JWT signing secret are created automatically on
first boot.

### Upgrading an existing single-user install

If you upgrade an instance that was already set up (no accounts yet), the app
goes straight to the **Create admin account** screen on next load. When you
create the admin, all existing chats are reassigned to that admin account.
Nothing is lost.

---

## 2. Deployment & configuration

### Data persistence (important)

Vane stores its config (including the auto-generated JWT secret) and database
under `DATA_DIR` (default: `./data`). In Docker this is the **`vane-data`
volume** mounted at `/home/vane/data` — keep it persistent. If this directory
is not persisted, the JWT secret is regenerated on each restart and **all users
are logged out** after every restart.

### Environment variables

| Variable | Default | When to set it |
|---|---|---|
| `JWT_SECRET` | auto-generated + stored in `data/config.json` | **Recommended in production.** **Required** for multi-replica deployments (all replicas must share the same value, otherwise sessions issued by one replica are rejected by another). Use a random string ≥ 32 bytes. |
| `FORCE_SECURE_COOKIES` | unset (cookies are `Secure` only when the request is HTTPS) | Set to `true` when Vane is served over HTTPS (e.g. behind a TLS-terminating reverse proxy) so auth cookies always get the `Secure` flag. |
| `DATA_DIR` | current working dir | Point at your persistent data directory if not using the default. |

Generate a secret:

```bash
openssl rand -base64 48
```

### Behind a reverse proxy (HTTPS)

When Vane runs behind nginx / Caddy / Traefik terminating TLS:

- Forward **`X-Forwarded-Proto`** (so Vane detects HTTPS and sets `Secure`
  cookies), or just set `FORCE_SECURE_COOKIES=true`.
- Forward **`X-Forwarded-For`** (the login/MFA rate limiter keys on client IP;
  without it all clients share one bucket).

Example nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Auth tunables (optional, in `data/config.json`)

These live under an `auth` key and are read fresh on each request:

| Key | Default | Meaning |
|---|---|---|
| `auth.accessTtlMin` | `120` | Access-token lifetime (minutes). |
| `auth.refreshTtlDays` | `30` | Refresh-token lifetime (days). |
| `auth.requireTwoFactor` | `false` | Force every user to enroll 2FA (toggle via the admin panel). |
| `auth.jwtSecret` | auto-generated | The signing secret (prefer the `JWT_SECRET` env var). |

> Single-instance, single-container deployments need **no** configuration beyond
> the default persistent volume — everything else is optional hardening.

---

## 3. Inviting users

There is no sign-up page. Admins create invitation links.

1. Open the **Admin** area (shield icon in the sidebar — visible to admins).
2. In **Invitations**, click **New invite**. A single-use, 48-hour link is
   created and copied to your clipboard (e.g. `https://your-host/invite/<token>`).
3. Send the link to the person. They open it, choose a username + password, and
   are logged in automatically.
4. Invites are **single-use** and **expire**. Revoke an unused invite from the
   list at any time.

To create another admin, generate the invite with the `admin` role (the API
accepts `{ "role": "admin" }`; the panel creates `user` invites by default —
use the API or extend the panel if you need admin invites regularly).

---

## 4. The admin panel

Reachable at `/admin` (shield icon in the sidebar, admins only). All actions are
enforced server-side — non-admins get `403` even if they reach the URL.

- **Require two-factor for everyone** — toggle org-wide 2FA enforcement. When on,
  any user without 2FA is forced to enroll before using the app (the API also
  returns `403` until they enroll). You can always reach `/api/admin/settings`
  and `/account` to avoid locking yourself out.
- **Invitations** — create / revoke invite links (see above).
- **Users** — for each user:
  - **Disable / Enable** — a disabled user is logged out immediately and cannot
    sign in.
  - **Reset 2FA** — clears the user's authenticator + recovery codes (use when
    someone loses their device).
  - **Reset password** — generates a temporary password (copied to clipboard).
    The user must log in with it, then is forced to set a new password.
  - **Delete** — removes the user (and logs them out).
  - You cannot disable or delete your own account (prevents lockout).

### Global config is admin-only

Model providers, API keys, and SearxNG settings (the **Settings** gear) are
visible and editable **only by admins**. Non-admins do not see the Settings
entry, and the underlying endpoints (`GET`/`POST /api/config`, the
`/api/providers` mutations) reject non-admins. The public model list
(`GET /api/providers`, no secrets) remains available so any user can pick a
model for a chat.

---

## 5. Two-factor authentication (per user)

Any user can enable 2FA from **Account** (`/account`):

1. Click **Enable two-factor authentication**.
2. Scan the QR code with an authenticator app (Google Authenticator, Aegis,
   1Password, etc.) or enter the shown key manually.
3. Enter the 6-digit code to confirm.
4. **Save the 10 recovery codes** shown once — each works a single time if you
   lose your authenticator.

Logging in with 2FA is a two-step flow: password, then the 6-digit code (a
recovery code also works). To disable 2FA, re-enter your password and a current
code on the Account page. If a user is locked out, an admin can **Reset 2FA**.

---

## 6. Chats: privacy & sharing

- Chats are **private to their owner** by default — each user sees only their
  own history.
- A chat owner can **share** a chat (link icon in the chat header). A shared
  chat is viewable **read-only** by any logged-in user who has its URL; they
  cannot send messages, rename, delete, or re-share it.
- Toggle sharing off at any time to make it private again.

---

## 7. Security model (summary)

- Passwords hashed with **argon2id**.
- Sessions: short-lived access JWT + rotating refresh token, both `httpOnly`
  cookies; refresh-token **reuse is detected** and revokes the whole chain.
- 2FA: TOTP (±1 step drift) with argon2-hashed, single-use recovery codes;
  MFA verification is rate-limited.
- Login is rate-limited and returns a generic error (no user enumeration).
- Disabled/deleted users and revoked admins lose access immediately (the API
  checks the live account on every request, not just the token).
- All `/api/*` routes except `/api/auth/*` require authentication; `/api/admin/*`
  and global-config routes require an admin.

See `docs/API/AUTH.md` for the full endpoint reference.
