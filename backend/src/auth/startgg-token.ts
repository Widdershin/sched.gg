import { db } from "../db.js";
import { refreshAccessToken } from "./startgg.js";

interface IdentityTokenRow {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: number | null;
}

// Refresh slightly early so a query never races the expiry.
const EXPIRY_SKEW_MS = 60_000;

// Resolve a usable start.gg access token for a user, refreshing it if expired.
// Returns null when the user has no linked start.gg identity (the UI should then
// prompt them to sign in with start.gg).
export async function getStartggAccessToken(
  userId: string,
): Promise<string | null> {
  const row = db
    .prepare(
      `SELECT id, access_token, refresh_token, token_expires_at
         FROM auth_identities
        WHERE provider = 'startgg' AND user_id = ?`,
    )
    .get(userId) as IdentityTokenRow | undefined;

  if (!row || !row.access_token) return null;

  const expiresAt = row.token_expires_at ?? 0;
  const fresh = expiresAt === 0 || expiresAt - EXPIRY_SKEW_MS > Date.now();
  if (fresh) return row.access_token;

  if (!row.refresh_token) return row.access_token; // best effort; let the query fail if stale

  const next = await refreshAccessToken(row.refresh_token);
  const tokenExpiresAt =
    next.expiresIn != null ? Date.now() + next.expiresIn * 1000 : null;
  db.prepare(
    `UPDATE auth_identities
        SET access_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    next.accessToken,
    next.refreshToken ?? row.refresh_token,
    tokenExpiresAt,
    Date.now(),
    row.id,
  );
  return next.accessToken;
}
