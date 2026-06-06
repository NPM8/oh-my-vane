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

If the account has two-factor authentication enabled (a Phase 4 feature), the
endpoint returns the following instead of issuing a session, and **no cookies
are set**:

```json
{
  "mfaRequired": true
}
```

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
