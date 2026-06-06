# Vane Authentication API Documentation

## Overview

Vane supports multi-user authentication. Sessions are managed entirely through
two `httpOnly` cookies, so credentials are never exposed to client-side
JavaScript:

- **`vane_access`** — a short-lived access JWT (default ~2 hours,
  `auth.accessTtlMin = 120`). Sent with every request to authorize access to
  the API.
- **`vane_refresh`** — a long-lived, rotating opaque refresh token (default
  ~30 days, `auth.refreshTtlDays = 30`). Used only to mint a fresh access
  token once the access token expires.

Both cookies are set with the following attributes:

- `HttpOnly` — not readable from JavaScript.
- `SameSite=Lax`.
- `Path=/`.
- `Secure` — set **adaptively**. It is enabled when the request arrives over
  HTTPS (detected via the `x-forwarded-proto: https` header) or when the
  `FORCE_SECURE_COOKIES=true` environment variable is set. It is **disabled**
  for plain HTTP requests, so Vane works out of the box on a LAN or
  `localhost` without TLS.

### Authentication flow for clients

Because cookies are managed by the server, browser clients only need to ensure
requests are sent with credentials (cookies) included. A typical client should
follow this pattern:

1. Make the desired API request. The browser automatically attaches the
   `vane_access` cookie.
2. If the request returns **`401 Unauthorized`**, the access token is likely
   expired. Call **`POST /api/auth/refresh`** to rotate the session.
3. If the refresh succeeds (`200`), **retry** the original request with the new
   access cookie.
4. If the refresh also returns `401`, the session is no longer valid (expired,
   revoked, or reused). Both cookies are cleared and the user must log in
   again.

### Route protection

All `/api/*` routes require a valid `vane_access` cookie and return
**`401 Unauthorized`** otherwise. The only exceptions are the authentication
routes themselves (`/api/auth/*`), which are always public.

There is one additional exception: the **setup phase**. Before the first user
account exists, the instance is unsecured and the entire API is open so that
initial setup can complete. Once any user exists, every non-auth API route
requires authentication.

---

## Endpoints

### Create First Admin (Bootstrap)

#### **POST** `/api/auth/bootstrap`

**Full URL**: `http://localhost:3000/api/auth/bootstrap`

Creates the first administrator account. This endpoint only works while **no
users exist** — it is intended for the one-time initial setup of a new Vane
instance. On success, the new admin is logged in immediately (both auth cookies
are set), and any pre-existing chats created during the unsecured setup phase
are claimed by the new admin.

#### Request Body

```json
{
  "username": "admin",
  "password": "a-strong-password"
}
```

#### Request Parameters

- **`username`** (string, required): The admin's username. Must be **3–64**
  characters.
- **`password`** (string, required): The admin's password. Must be **10–200**
  characters.

#### Response Example (201 Created)

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "admin",
    "role": "admin",
    "disabled": false,
    "totpEnabled": false,
    "mustChangePassword": false
  }
}
```

The `vane_access` and `vane_refresh` cookies are set on the response.

#### Error Handling

- **400**: The request body is malformed or fails validation (e.g. username or
  password length out of range).
- **409**: An admin already exists — bootstrap is only available when there are
  no users.
- **500**: An internal server error occurred.

---

### Log In

#### **POST** `/api/auth/login`

**Full URL**: `http://localhost:3000/api/auth/login`

Authenticates a user with a username and password. On success, both auth
cookies are set on the response.

#### Request Body

```json
{
  "username": "admin",
  "password": "a-strong-password"
}
```

#### Request Parameters

- **`username`** (string, required): The user's username. **1–64** characters.
- **`password`** (string, required): The user's password. **1–200** characters.

#### Response Example (200 OK)

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "admin",
    "role": "admin",
    "mustChangePassword": false
  }
}
```

The `vane_access` and `vane_refresh` cookies are set on the response.

The `role` field is either `admin` or `user`. When `mustChangePassword` is
`true`, the client should direct the user to change their password before
continuing.

#### Response Example — Two-Factor Required (200 OK)

If the account has two-factor authentication enabled, the endpoint returns the
following instead of issuing a session, and **no cookies are set**:

```json
{
  "mfaRequired": true,
  "mfaToken": "<short-lived-mfa-jwt>"
}
```

The `mfaToken` is a short-lived (5 minute) JWT that proves the password step
succeeded. The client must complete login by calling **`POST /api/auth/mfa`**
with this `mfaToken` and a second-factor `code`. See
[Two-Factor Authentication (2FA)](#two-factor-authentication-2fa) below.

#### Error Handling

- **401**: Authentication failed. This is returned for invalid credentials, an
  unknown username, or a disabled account. The message is intentionally generic
  (`"Invalid credentials."`) to prevent user enumeration.
- **429**: Too many attempts. Login is rate limited to **10 attempts per 5
  minutes**, keyed by the combination of client IP and username. A successful
  login resets the counter for that key.
- **500**: An internal server error occurred.

---

### Refresh Session

#### **POST** `/api/auth/refresh`

**Full URL**: `http://localhost:3000/api/auth/refresh`

Rotates the session using the `vane_refresh` cookie. On success, a new access
token and a new refresh token are issued (both cookies are replaced), and the
old refresh token is revoked. This is the endpoint clients should call after
receiving a `401` from a protected route.

This endpoint takes **no request body** — it reads the `vane_refresh` cookie
sent automatically by the browser.

#### Response Example (200 OK)

```json
{
  "ok": true
}
```

The `vane_access` and `vane_refresh` cookies are rotated (replaced with fresh
values) on the response.

#### Error Handling

- **401**: The session could not be refreshed. This is returned when the
  refresh cookie is missing, invalid, or expired, or when the account has been
  disabled. It is also returned on **token reuse detection** — if a refresh
  token that has already been rotated/revoked is presented, the user's entire
  refresh-token chain is revoked as a security measure. In all `401` cases,
  both auth cookies are cleared on the response.
- **500**: An internal server error occurred.

---

### Log Out

#### **POST** `/api/auth/logout`

**Full URL**: `http://localhost:3000/api/auth/logout`

Logs the user out. The current refresh token is revoked on a best-effort basis
(if present and not already revoked), and both auth cookies are cleared. This
endpoint takes **no request body**.

#### Response Example (200 OK)

```json
{
  "ok": true
}
```

The `vane_access` and `vane_refresh` cookies are cleared on the response. This
endpoint always returns `200` (logout is idempotent), except in the rare case
of an internal error.

#### Error Handling

- **500**: An internal server error occurred.

---

### Get Current Session

#### **GET** `/api/auth/session`

**Full URL**: `http://localhost:3000/api/auth/session`

Returns the currently authenticated user, derived from the `vane_access`
cookie. This endpoint **never returns `401`** — it is safe to call to probe the
current auth state. When there is no valid session, it returns `200` with a
`null` user.

#### Response Example — Authenticated (200 OK)

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "role": "admin",
    "username": "admin"
  }
}
```

#### Response Example — Not Authenticated (200 OK)

```json
{
  "user": null
}
```

---

## Invitations

Invitations let an administrator generate single-use, time-limited tokens that
allow a new person to create an account. An admin mints an invite (optionally
choosing the new account's role and how long the invite stays valid) and shares
the resulting link. The invitee opens the link, validates it, and accepts it by
choosing a username and password — which creates their account and logs them in
immediately.

### Authorization

All `/api/admin/*` routes require an authenticated **admin**:

- **`401 Unauthorized`** if the request has no valid session.
- **`403 Forbidden`** if the session belongs to a non-admin user.

This rule is enforced **twice** — once in `src/middleware.ts` (which guards the
`/api/admin/*` prefix) and again inside each route handler via `requireAdmin`.
The public invite routes (`/api/auth/invite/*`) require no authentication.

---

### Create Invitation

#### **POST** `/api/admin/invites`

**Full URL**: `http://localhost:3000/api/admin/invites`

**Admin only.** Creates a new invitation and returns it together with a
shareable link. The raw invite token is generated server-side, hashed before
storage, and returned **only once** — embedded in the `link` of this response.
It can never be retrieved again afterwards.

#### Request Body

```json
{
  "role": "user",
  "ttlHours": 48
}
```

#### Request Parameters

- **`role`** (string, optional): The role the accepted account will receive.
  One of `user` or `admin`. Defaults to `user`.
- **`ttlHours`** (integer, optional): How many hours the invitation remains
  valid, from creation. Must be an integer **1–720** (1 hour to 30 days).
  Defaults to `48`.

#### Response Example (201 Created)

```json
{
  "invite": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "role": "user",
    "createdBy": "11111111-1111-1111-1111-111111111111",
    "expiresAt": "2026-06-08T12:00:00.000Z",
    "usedAt": null,
    "usedBy": null,
    "createdAt": "2026-06-06T12:00:00.000Z"
  },
  "link": "http://localhost:3000/invite/<rawToken>"
}
```

The `link` is `${origin}/invite/<rawToken>`, where `origin` is derived from the
request URL. The raw token appears **only** in this `link` and is never returned
again.

#### Error Handling

- **400**: The invite options are invalid (e.g. an unknown `role` or a
  `ttlHours` outside `1–720`).
- **401**: The request is not authenticated.
- **403**: The authenticated user is not an admin.
- **500**: An internal server error occurred.

---

### List Invitations

#### **GET** `/api/admin/invites`

**Full URL**: `http://localhost:3000/api/admin/invites`

**Admin only.** Returns all invitations, newest first. Each invite carries a
computed `status`. The raw token and its hash (`tokenHash`) are **never**
returned by this endpoint.

This endpoint takes **no request body**.

#### Response Example (200 OK)

```json
{
  "invites": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "role": "user",
      "createdBy": "11111111-1111-1111-1111-111111111111",
      "expiresAt": "2026-06-08T12:00:00.000Z",
      "usedAt": null,
      "usedBy": null,
      "createdAt": "2026-06-06T12:00:00.000Z",
      "status": "pending"
    }
  ]
}
```

#### Response Fields

- **`status`** (string): One of:
  - `used` — the invite has been accepted or revoked (`usedAt` is set).
  - `expired` — the invite's `expiresAt` has passed and it was never used.
  - `pending` — the invite is still unused and unexpired.

Note: a revoked invite reports `status: "used"` (revocation marks the invite as
used, with `usedBy` set to `"revoked"`).

#### Error Handling

- **401**: The request is not authenticated.
- **403**: The authenticated user is not an admin.
- **500**: An internal server error occurred.

---

### Revoke Invitation

#### **DELETE** `/api/admin/invites/:id`

**Full URL**: `http://localhost:3000/api/admin/invites/<id>`

**Admin only.** Revokes an unused invitation by marking it used (`usedBy` is set
to `"revoked"`). This is a no-op if the invite is already used, and the response
is the same regardless. This endpoint takes **no request body**.

#### Request Parameters

- **`id`** (path, required): The `id` of the invite to revoke.

#### Response Example (200 OK)

```json
{
  "ok": true
}
```

#### Error Handling

- **401**: The request is not authenticated.
- **403**: The authenticated user is not an admin.
- **500**: An internal server error occurred.

---

### Validate Invitation

#### **POST** `/api/auth/invite/validate`

**Full URL**: `http://localhost:3000/api/auth/invite/validate`

**Public.** Checks whether an invite token is currently usable, without
consuming it. Intended for the invite-acceptance page to show the invitee the
state of their link before they fill in the form. This endpoint always returns
`200` (except on internal error); the outcome is conveyed in the body.

#### Request Body

```json
{
  "token": "<rawToken>"
}
```

#### Request Parameters

- **`token`** (string, required): The raw invite token (the value from the
  invite link). Must be non-empty.

#### Response Example — Valid (200 OK)

```json
{
  "valid": true,
  "role": "user"
}
```

#### Response Example — Invalid (200 OK)

```json
{
  "valid": false,
  "reason": "expired"
}
```

- **`reason`** (string): One of:
  - `unknown` — no invite matches the token.
  - `used` — the invite has already been used (or revoked).
  - `expired` — the invite's validity window has passed.

If the request body is malformed or the token is missing/empty, the endpoint
returns `200` with `{ "valid": false }` and **no** `reason`.

#### Error Handling

- **500**: An internal server error occurred.

---

### Accept Invitation

#### **POST** `/api/auth/invite/accept`

**Full URL**: `http://localhost:3000/api/auth/invite/accept`

**Public.** Consumes a valid invite to create a new account and immediately logs
the new user in (both auth cookies are set on the response). Acceptance is
**single-use**: the invite is atomically claimed, so a token cannot be used to
create more than one account.

#### Request Body

```json
{
  "token": "<rawToken>",
  "username": "newuser",
  "password": "a-strong-password"
}
```

#### Request Parameters

- **`token`** (string, required): The raw invite token. Must be non-empty.
- **`username`** (string, required): The desired username. Must be **3–64**
  characters.
- **`password`** (string, required): The desired password. Must be **10–200**
  characters.

#### Response Example (201 Created)

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "newuser",
    "role": "user",
    "disabled": false,
    "totpEnabled": false,
    "mustChangePassword": false
  }
}
```

The new account receives the `role` recorded on the invite. The `vane_access`
and `vane_refresh` cookies are set on the response, so the user is logged in
without a separate login step.

#### Error Handling

- **400**: The input failed validation (bad/missing `token`, or `username`/
  `password` out of range), **or** the invite is invalid, expired, or already
  used. The message is intentionally generic
  (`"This invitation is invalid or has already been used."`) for the
  invite-state case.
- **409**: The requested username is already taken. This is checked **before**
  the invite is consumed, so the invite is not spent on a duplicate username.
- **500**: An internal server error occurred.

---

## Account

Endpoints under `/api/account/*` act on the **currently authenticated user** —
there is no `id` in the path; the account is always derived from the session
(`vane_access` cookie). They require authentication only (any role), and return
**`401 Unauthorized`** without a valid session. The 2FA enrollment endpoints
([setup](#begin-2fa-enrollment), [enable](#enable-2fa),
[disable](#disable-2fa)) also live under this prefix and are documented in the
[Two-Factor Authentication (2FA)](#two-factor-authentication-2fa) section.

> **Note:** `/api/account/*` is intentionally **never** blocked by the enforced
> 2FA gate (see [Configuration: Enforced 2FA](#configuration-enforced-2fa)), so
> a user who must enrol can still reach their account endpoints to do so.

---

### Change Own Password

#### **POST** `/api/account/password`

**Full URL**: `http://localhost:3000/api/account/password`

**Authenticated.** Changes the password of the currently authenticated user.
The caller must prove knowledge of the **current** password. On success, **all
of the user's other sessions are revoked** (every refresh token for the user is
invalidated), and the **current** session's cookies are re-issued on the
response — so the caller stays logged in while every other device is signed
out.

#### Request Body

```json
{
  "currentPassword": "the-old-password",
  "newPassword": "a-new-strong-password"
}
```

#### Request Parameters

- **`currentPassword`** (string, required): The user's current password.
  Non-empty.
- **`newPassword`** (string, required): The desired new password. Must be
  **10–200** characters.

#### Response Example (200 OK)

```json
{
  "ok": true
}
```

The `vane_access` and `vane_refresh` cookies are **rotated** (re-issued) on the
response for the current session. Because all of the user's refresh tokens were
revoked first, any other active sessions can no longer refresh and are
effectively logged out.

#### Error Handling

- **400**: The input failed validation — `currentPassword` empty or
  `newPassword` outside `10–200` characters
  (`"Current password and a new password (min 10) are required."`).
- **401**: The request is not authenticated, **or** `currentPassword` is
  incorrect (`"Current password is incorrect."`).
- **500**: An internal server error occurred.

---

## User Management (admin)

These endpoints live under `/api/admin/*` and require an authenticated
**admin**, following the same authorization rule documented under
[Invitations → Authorization](#authorization):

- **`401 Unauthorized`** if the request has no valid session.
- **`403 Forbidden`** if the session belongs to a non-admin user.

That rule is enforced **twice** — in `src/middleware.ts` (which guards the
`/api/admin/*` prefix) and again inside each handler via `requireAdmin`. The
listing endpoint never exposes password hashes.

Admins cannot operate destructively on **their own** account: disabling and
deleting reject a request whose target `id` equals the caller's own id with
**`400`**, so an admin cannot lock themselves out.

The admin's 2FA reset endpoint
([**POST** `/api/admin/users/:id/2fa/reset`](#admin-reset-a-users-2fa)) is part
of this same admin surface and is documented in the
[Two-Factor Authentication (2FA)](#two-factor-authentication-2fa) section.

---

### List Users

#### **GET** `/api/admin/users`

**Full URL**: `http://localhost:3000/api/admin/users`

**Admin only.** Returns all user accounts, ordered by username. Password hashes
are **never** included. This endpoint takes **no request body**.

#### Response Example (200 OK)

```json
{
  "users": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "username": "admin",
      "role": "admin",
      "disabled": false,
      "totpEnabled": true,
      "mustChangePassword": false
    }
  ]
}
```

#### Response Fields

- **`id`** (string): The user's id (UUID).
- **`username`** (string).
- **`role`** (string): `admin` or `user`.
- **`disabled`** (boolean): Whether the account is disabled (cannot log in or
  refresh).
- **`totpEnabled`** (boolean): Whether the user has 2FA active.
- **`mustChangePassword`** (boolean): Whether the user is forced to change their
  password on next login (set by an admin password reset).

#### Error Handling

- **401**: The request is not authenticated.
- **403**: The authenticated user is not an admin.
- **500**: An internal server error occurred.

---

### Enable / Disable a User

#### **POST** `/api/admin/users/:id/disable`

**Full URL**: `http://localhost:3000/api/admin/users/<id>/disable`

**Admin only.** Sets the target user's `disabled` flag. Despite the path name,
this endpoint both **disables** (`disabled: true`) and **re-enables**
(`disabled: false`) an account, depending on the request body. When an account
is **disabled**, all of that user's sessions are revoked (every refresh token
is invalidated) so the user is signed out immediately; re-enabling does not
restore the old sessions.

#### Request Parameters

- **`id`** (path, required): The `id` of the user to enable/disable.

#### Request Body

```json
{
  "disabled": true
}
```

- **`disabled`** (boolean, required): The desired disabled state.

#### Response Example (200 OK)

```json
{
  "ok": true,
  "disabled": true
}
```

#### Error Handling

- **400**: The target `id` is the **caller's own** id
  (`"You cannot disable your own account."`), **or** the body is invalid /
  missing the `disabled` boolean (`"disabled (boolean) required."`). The own-id
  check is performed **before** body validation.
- **401**: The request is not authenticated.
- **403**: The authenticated user is not an admin.
- **404**: No user matches the given `id` (`"User not found."`).
- **500**: An internal server error occurred.

---

### Delete a User

#### **DELETE** `/api/admin/users/:id`

**Full URL**: `http://localhost:3000/api/admin/users/<id>`

**Admin only.** Permanently deletes the target user account. The user's
sessions are revoked (every refresh token invalidated) before the account is
removed. This endpoint takes **no request body**.

#### Request Parameters

- **`id`** (path, required): The `id` of the user to delete.

#### Response Example (200 OK)

```json
{
  "ok": true
}
```

#### Error Handling

- **400**: The target `id` is the **caller's own** id
  (`"You cannot delete your own account."`).
- **401**: The request is not authenticated.
- **403**: The authenticated user is not an admin.
- **404**: No user matches the given `id` (`"User not found."`).
- **500**: An internal server error occurred.

---

### Reset a User's Password

#### **POST** `/api/admin/users/:id/password/reset`

**Full URL**: `http://localhost:3000/api/admin/users/<id>/password/reset`

**Admin only.** Generates a new **temporary password** for the target user,
sets it on the account, and marks the user `mustChangePassword`. The user's
sessions are revoked (every refresh token invalidated), so they are signed out
and must log in again with the temporary password — after which they are forced
to set a new password before continuing.

The temporary password is returned **only once**, in this response; it is not
stored in plaintext and can never be retrieved again. This endpoint takes **no
request body**.

#### Request Parameters

- **`id`** (path, required): The `id` of the user whose password to reset.

#### Response Example (200 OK)

```json
{
  "tempPassword": "kQ2v8nR4tLpZxWj7mB1aGc3d"
}
```

- **`tempPassword`** (string): A randomly generated temporary password
  (18 random bytes, base64url-encoded — about 24 characters). Communicate it to
  the user over a trusted channel.

#### Error Handling

- **401**: The request is not authenticated.
- **403**: The authenticated user is not an admin.
- **404**: No user matches the given `id` (`"User not found."`).
- **500**: An internal server error occurred.

---

## Admin Settings

### Get / Set Enforced-2FA Setting

#### **GET** `/api/admin/settings`

**Full URL**: `http://localhost:3000/api/admin/settings`

**Admin only.** Reads the org-wide enforced-2FA setting. This endpoint takes
**no request body**.

#### Response Example (200 OK)

```json
{
  "requireTwoFactor": false
}
```

- **`requireTwoFactor`** (boolean): Whether 2FA is mandatory for all users.
  Backed by `auth.requireTwoFactor` in `data/config.json` (default `false`).

#### **POST** `/api/admin/settings`

**Full URL**: `http://localhost:3000/api/admin/settings`

**Admin only.** Updates the org-wide enforced-2FA setting. The change takes
effect immediately and is enforced at the API layer by `src/middleware.ts`
(see [Configuration: Enforced 2FA](#configuration-enforced-2fa)).

#### Request Body

```json
{
  "requireTwoFactor": true
}
```

- **`requireTwoFactor`** (boolean, required): The desired setting.

#### Response Example (200 OK)

```json
{
  "requireTwoFactor": true
}
```

#### Error Handling

- **400**: The body is invalid / missing the `requireTwoFactor` boolean
  (`"requireTwoFactor (boolean) required."`).
- **401**: The request is not authenticated.
- **403**: The authenticated user is not an admin.
- **500**: An internal server error occurred.

---

## Configuration & Providers (admin)

Once setup is complete — i.e. at least one user account exists — the global app
configuration is **admin-only**. The full configuration includes model-provider
API keys, so it is never exposed to non-admins:

- **GET `/api/config`** and **POST `/api/config`** require an authenticated
  **admin**. A non-admin (or unauthenticated) caller receives **403 Forbidden**
  (or **401** with no session).
- **POST `/api/providers`**, **PATCH/DELETE `/api/providers/:id`**, and
  **POST/DELETE `/api/providers/:id/models`** likewise require an admin. A
  non-admin receives **403**.

The **read** endpoint for the model picker is intentionally **not** gated:

- **GET `/api/providers`** is available to **any authenticated user**. It returns
  only the **active model list** — each provider as `id`, `name`, `chatModels`,
  and `embeddingModels` — with **no secrets** (API keys and other credentials are
  never included). This is what powers the chat model selector.

### First-run setup

During first-run setup — **before any account exists** — these routes are
**open**, so the setup wizard can configure providers before an admin has been
created. They become admin-only as soon as the first admin account is created.
This is enforced by the `requireAdminUnlessSetup` gate in each handler
(`src/lib/auth/getAuthUser.ts`): it allows the request through while there are
zero users, and falls back to the admin check (`401`/`403`) once any user
exists.

---

## Two-Factor Authentication (2FA)

Vane supports optional time-based one-time password (TOTP) two-factor
authentication, compatible with authenticator apps (Google Authenticator, Authy,
1Password, etc.). When a user has 2FA enabled, logging in becomes a **two-step**
process: the password step no longer issues a session directly, and a second
factor must be verified before any session cookies are set.

### Two-step login

When an account has 2FA enabled, **`POST /api/auth/login`** does **not** set the
session cookies on a correct password. Instead it returns `200` with:

```json
{
  "mfaRequired": true,
  "mfaToken": "<short-lived-mfa-jwt>"
}
```

The `mfaToken` is a short-lived JWT (valid for **5 minutes**, `type: "mfa"`)
that proves the password check passed. The client must then call
**`POST /api/auth/mfa`** with this token and the user's second factor to finish
logging in. Only on a successful second-factor verification are the
`vane_access` and `vane_refresh` cookies set.

Accounts **without** 2FA are unaffected — login sets cookies as documented in
[Log In](#log-in).

---

### Verify Second Factor (Complete Login)

#### **POST** `/api/auth/mfa`

**Full URL**: `http://localhost:3000/api/auth/mfa`

**Public.** Completes a two-step login. Given the `mfaToken` issued by the login
endpoint and a valid second factor (`code`), it verifies the factor and, on
success, issues the session (both auth cookies are set on the response).

#### Request Body

```json
{
  "mfaToken": "<short-lived-mfa-jwt>",
  "code": "123456"
}
```

#### Request Parameters

- **`mfaToken`** (string, required): The short-lived MFA JWT returned by
  `POST /api/auth/login`. Non-empty.
- **`code`** (string, required): The second factor. **1–32** characters. Either
  a **6-digit TOTP** code from the user's authenticator app, **or** one of the
  user's **one-time recovery codes**. A recovery code is consumed (single-use)
  when accepted.

#### Response Example (200 OK)

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "admin",
    "role": "admin",
    "mustChangePassword": false
  }
}
```

The `vane_access` and `vane_refresh` cookies are set on the response.

#### Error Handling

- **400**: The request body is malformed or missing fields (`mfaToken` empty, or
  `code` empty / longer than 32 characters).
- **401**: Either the `mfaToken` is invalid or expired (returns
  `"MFA session expired. Sign in again."` — the client should restart login),
  the account is no longer eligible (disabled, or 2FA no longer enabled), or the
  submitted `code` is wrong (`"Invalid code."`).
- **429**: Too many attempts. Second-factor verification is rate limited to
  **5 attempts per 5 minutes**, keyed by user id. A successful verification
  resets the counter.
- **500**: An internal server error occurred.

---

### Begin 2FA Enrollment

#### **POST** `/api/account/2fa/setup`

**Full URL**: `http://localhost:3000/api/account/2fa/setup`

**Authenticated.** Begins enrollment for the **currently authenticated user**. A
new TOTP secret is generated and stored against the account in a **pending**
state — 2FA is **not yet active**, and the secret only becomes effective once
the user confirms it via [Enable 2FA](#enable-2fa). Calling this again before
enabling replaces the pending secret. This endpoint takes **no request body**.

#### Response Example (200 OK)

```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "otpauthUri": "otpauth://totp/Vane:admin?secret=JBSWY3DPEHPK3PXP&issuer=Vane",
  "qrDataUrl": "data:image/png;base64,iVBORw0KGgo..."
}
```

#### Response Fields

- **`secret`** (string): The base32 TOTP secret. Show this to the user so they
  can enter it manually if they cannot scan the QR code.
- **`otpauthUri`** (string): The `otpauth://` provisioning URI encoding the
  secret, account, and issuer.
- **`qrDataUrl`** (string): A `data:` URL (PNG) encoding the `otpauthUri` as a QR
  code. Render it directly as the `src` of an `<img>` element for the user to
  scan with their authenticator app.

#### Error Handling

- **401**: The request is not authenticated.
- **500**: An internal server error occurred.

---

### Enable 2FA

#### **POST** `/api/account/2fa/enable`

**Full URL**: `http://localhost:3000/api/account/2fa/enable`

**Authenticated.** Confirms a pending enrollment for the **currently
authenticated user** and activates 2FA. The user submits a TOTP `code` generated
from the pending secret; if it verifies, 2FA is turned on and a fresh set of
recovery codes is generated and returned.

#### Request Body

```json
{
  "code": "123456"
}
```

#### Request Parameters

- **`code`** (string, required): The current **6-digit TOTP** code from the
  authenticator app the user configured during setup. **1–32** characters.

#### Response Example (200 OK)

```json
{
  "recoveryCodes": [
    "abcd-efgh",
    "ijkl-mnop",
    "qrst-uvwx",
    "..."
  ]
}
```

#### Response Fields

- **`recoveryCodes`** (string[]): A list of **10** single-use recovery codes.
  These are shown **only once** — they are stored hashed and can never be
  retrieved again. Each code can be used in place of a TOTP code at the
  [Verify Second Factor](#verify-second-factor-complete-login) step, and is
  consumed on use. Instruct the user to save them somewhere safe.

#### Error Handling

- **400**: The `code` is missing/empty (`"Code required."`) or does not verify
  against the pending secret (`"Invalid code. Try again."`). This is also
  returned if there is no pending secret to confirm.
- **401**: The request is not authenticated.
- **500**: An internal server error occurred.

---

### Disable 2FA

#### **POST** `/api/account/2fa/disable`

**Full URL**: `http://localhost:3000/api/account/2fa/disable`

**Authenticated.** Turns off 2FA for the **currently authenticated user**. This
requires **re-authentication with both** the account password and a current
second factor, so that a hijacked session alone cannot strip 2FA. On success,
the TOTP secret and all recovery codes are cleared.

#### Request Body

```json
{
  "password": "a-strong-password",
  "code": "123456"
}
```

#### Request Parameters

- **`password`** (string, required): The user's current account password.
  Non-empty.
- **`code`** (string, required): A current **6-digit TOTP** code or a one-time
  **recovery code**. **1–32** characters.

#### Response Example (200 OK)

```json
{
  "ok": true
}
```

#### Error Handling

- **400**: The request body is malformed or missing `password` / `code`
  (`"Password and code required."`).
- **401**: The request is not authenticated, **or** the password or the second
  factor is incorrect (`"Invalid password or code."` — the message does not
  distinguish which of the two failed).
- **500**: An internal server error occurred.

---

### Admin: Reset a User's 2FA

#### **POST** `/api/admin/users/:id/2fa/reset`

**Full URL**: `http://localhost:3000/api/admin/users/<id>/2fa/reset`

**Admin only.** Clears the target user's 2FA configuration — disabling 2FA and
removing their TOTP secret and recovery codes. Intended for account recovery
when a user has lost access to their authenticator. After a reset, the user logs
in with their password alone (a single step) and may re-enroll. This endpoint
takes **no request body**.

#### Request Parameters

- **`id`** (path, required): The `id` of the user whose 2FA should be reset.

#### Response Example (200 OK)

```json
{
  "ok": true
}
```

#### Error Handling

- **401**: The request is not authenticated.
- **403**: The authenticated user is not an admin.
- **404**: No user matches the given `id` (`"User not found."`).
- **500**: An internal server error occurred.

---

### Configuration: Enforced 2FA

The boolean **`auth.requireTwoFactor`** (in `data/config.json`, default `false`)
controls whether 2FA is mandatory for all users:

```json
{
  "auth": {
    "requireTwoFactor": true
  }
}
```

When set to `true`, any authenticated user who has **not** yet enabled 2FA
(`totpEnabled: false`) is **forced to enroll** before they can use the app — the
UI gates the application behind the enrollment flow ([setup](#begin-2fa-enrollment)
→ [enable](#enable-2fa)) until 2FA is active. Public pages (e.g. the login and
invite pages) are exempt from this gate. When `false` (the default), 2FA is
opt-in per user.

This is **not** merely a UI gate — it is enforced at the API layer in
`src/middleware.ts`. When `auth.requireTwoFactor` is enabled, **every** data API
(all `/api/*` routes) returns the following for an authenticated user who has
not enrolled 2FA:

```json
{
  "message": "Two-factor enrollment required."
}
```

with status **`403 Forbidden`**. The only exceptions are:

- **`/api/auth/*`** — always public (the login/refresh/MFA routes).
- **`/api/account/*`** — exempt so the user can actually enrol (and manage their
  account) while gated.
- **`/api/admin/settings`** — exempt so an admin who enables enforcement without
  having enrolled can still reverse the policy (prevents an admin lockout).

This setting is read and written by admins via
[**GET/POST** `/api/admin/settings`](#get--set-enforced-2fa-setting).

---

## Security Notes

- **Password hashing**: Passwords are hashed with **argon2id** and never stored
  in plaintext.
- **Refresh-token rotation with reuse detection**: Each call to
  `/api/auth/refresh` issues a brand-new refresh token and revokes the previous
  one. If a previously rotated (and therefore revoked) refresh token is
  presented again, this is treated as a potential token-theft event and the
  user's **entire refresh-token chain is revoked**, forcing re-authentication.
- **JWT secret**: The signing secret for access tokens is read from the
  `JWT_SECRET` environment variable. If it is not set, a secret is
  automatically generated and persisted to the instance config
  (`auth.jwtSecret`) on first use, so sessions survive restarts.
- **Rate limiting**: Login rate limiting is **per-process and in-memory**. In a
  multi-process or multi-instance deployment, the limit applies independently
  per process, and counters are reset when a process restarts.
