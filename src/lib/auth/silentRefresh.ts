import { findRefreshByToken, touchRefreshExpiry } from './refreshStore';
import { decideRefresh } from './rotation';
import { getUserById } from './users';
import { signJwt } from './jwt';
import { getAuthConfig } from './authConfig';

export interface SilentRefreshResult {
  accessToken: string;
  accessMaxAgeSec: number;
  // The same (unrotated) refresh token, plus a fresh maxAge, so the caller can
  // re-set the refresh cookie and slide the browser-side expiry forward in step
  // with the DB expiry. Returning it keeps the sliding window whole: extending
  // only the DB row would still let the browser drop the cookie at its original
  // 30-day mark.
  refreshToken: string;
  refreshMaxAgeSec: number;
  user: { id: string; role: string; username: string };
}

// Mint a fresh access token from a still-valid refresh cookie, WITHOUT rotating
// the refresh token. The access cookie's maxAge is short (auth.accessTtlMin), so
// the browser drops it well before the refresh cookie (auth.refreshTtlDays). This
// lets middleware silently re-issue access on page loads and API calls, keeping
// the user signed in up to the refresh token's lifetime instead of logging them
// out the moment the access token expires.
//
// Deliberately no ROTATION (no new token value): rotation under concurrency is
// unsafe here. Several requests fired right after the access token expires would
// each present the SAME refresh token; rotating would revoke it on the first
// request, tripping reuse-detection on the rest and force-revoking every
// session — the very logout we are trying to prevent.
//
// Instead we mint a fresh access token AND slide the existing refresh token's
// expiry forward (sliding window). Sliding is not rotation: the token value and
// revokedAt are untouched, so concurrent requests all succeed (each just re-sets
// expiresAt to ~the same value) and reuse-detection never fires. The effect is
// that a user who keeps using the app is never logged out; only a genuine
// absence longer than refreshTtlDays lets the refresh token lapse.
export const silentRefresh = async (
  refreshRaw: string | undefined,
  now: number,
): Promise<SilentRefreshResult | null> => {
  if (!refreshRaw) return null;

  const row = await findRefreshByToken(refreshRaw);
  // 'rotate' is decideRefresh's verdict for a valid, non-revoked, unexpired row.
  // We reuse it purely as a validity check; we do not actually rotate.
  const decision = decideRefresh(
    row ? { revokedAt: row.revokedAt, expiresAt: row.expiresAt } : undefined,
    now,
  );
  if (decision.action !== 'rotate' || !row) return null;

  const user = await getUserById(row.userId);
  if (!user || user.disabled) return null;

  const cfg = getAuthConfig();
  const accessMaxAgeSec = cfg.accessTtlMin * 60;
  const refreshMaxAgeSec = cfg.refreshTtlDays * 24 * 60 * 60;

  const accessToken = await signJwt(
    { sub: user.id, role: user.role, username: user.username, type: 'access' },
    cfg.secret,
    `${accessMaxAgeSec}s`,
  );

  // Slide the refresh expiry forward so continued use never lapses the session.
  const newExpiresAt = new Date(now + refreshMaxAgeSec * 1000).toISOString();
  await touchRefreshExpiry(row.id, newExpiresAt);

  return {
    accessToken,
    accessMaxAgeSec,
    refreshToken: refreshRaw,
    refreshMaxAgeSec,
    user: { id: user.id, role: user.role, username: user.username },
  };
};
