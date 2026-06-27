import { Hono } from "hono";
import { db } from "../db.js";
import { env, startggConfigured } from "../env.js";
import { uuid, token } from "../util/ids.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  type AppEnv,
  type SessionUser,
  createSession,
  clearSession,
  requireAuth,
} from "../auth/session.js";
import { issueCsrf, requireCsrf } from "../auth/csrf.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchCurrentUser,
} from "../auth/startgg.js";

const auth = new Hono<AppEnv>();

interface UserRow {
  id: string;
  username: string | null;
  display_name: string | null;
}

function publicUser(u: UserRow | SessionUser): SessionUser {
  if ("display_name" in u) {
    return { id: u.id, username: u.username, displayName: u.display_name };
  }
  return u;
}

function createUser(username: string | null, displayName: string | null): UserRow {
  const id = uuid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, username, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, username, displayName, now, now);
  return { id, username, display_name: displayName };
}

// --- CSRF token ------------------------------------------------------------
auth.get("/auth/csrf", (c) => c.json({ token: issueCsrf(c) }));

// --- current user ----------------------------------------------------------
auth.get("/auth/me", (c) => c.json({ user: c.get("user") ?? null }));

// --- register (username + password) ---------------------------------------
auth.post("/auth/register", requireCsrf, async (c) => {
  const { username, password } = await c.req.json().catch(() => ({}) as any);
  if (typeof username !== "string" || username.trim().length < 3) {
    return c.json({ error: "username must be at least 3 characters" }, 400);
  }
  if (typeof password !== "string" || password.length < 6) {
    return c.json({ error: "password must be at least 6 characters" }, 400);
  }
  const name = username.trim();
  const existing = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(name);
  if (existing) return c.json({ error: "username already taken" }, 409);

  const user = createUser(name, name);
  const now = Date.now();
  db.prepare(
    `INSERT INTO auth_identities
       (id, user_id, provider, provider_account_id, secret, metadata, created_at, updated_at)
     VALUES (?, ?, 'password', ?, ?, NULL, ?, ?)`,
  ).run(uuid(), user.id, name, hashPassword(password), now, now);

  createSession(c, user.id, c.req.header("user-agent"));
  return c.json({ user: publicUser(user) });
});

// --- login (username + password) ------------------------------------------
auth.post("/auth/login", requireCsrf, async (c) => {
  const { username, password } = await c.req.json().catch(() => ({}) as any);
  if (typeof username !== "string" || typeof password !== "string") {
    return c.json({ error: "username and password required" }, 400);
  }
  const row = db
    .prepare(
      `SELECT u.id AS id, u.username AS username, u.display_name AS display_name,
              i.secret AS secret
         FROM auth_identities i JOIN users u ON u.id = i.user_id
        WHERE i.provider = 'password' AND i.provider_account_id = ?`,
    )
    .get(username.trim()) as (UserRow & { secret: string }) | undefined;
  if (!row || !verifyPassword(password, row.secret)) {
    return c.json({ error: "invalid username or password" }, 401);
  }
  createSession(c, row.id, c.req.header("user-agent"));
  return c.json({ user: publicUser(row) });
});

// --- logout ----------------------------------------------------------------
auth.post("/auth/logout", requireCsrf, requireAuth, (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

// --- dev login (env-gated) -------------------------------------------------
auth.post("/auth/dev-login", requireCsrf, async (c) => {
  if (!env.devLogin) return c.json({ error: "dev login disabled" }, 404);
  const { username } = await c.req.json().catch(() => ({}) as any);
  const name = typeof username === "string" && username.trim() ? username.trim() : "dev";
  let user = db
    .prepare("SELECT id, username, display_name FROM users WHERE username = ?")
    .get(name) as UserRow | undefined;
  if (!user) user = createUser(name, name);
  createSession(c, user.id, c.req.header("user-agent"));
  return c.json({ user: publicUser(user) });
});

// --- start.gg OAuth: begin -------------------------------------------------
auth.get("/auth/startgg/login", (c) => {
  if (!startggConfigured()) return c.json({ error: "start.gg not configured" }, 503);
  const state = token(18);
  const now = Date.now();
  db.prepare(
    `INSERT INTO oauth_states (state, code_verifier, redirect_to, created_at, expires_at)
     VALUES (?, NULL, ?, ?, ?)`,
  ).run(state, "/", now, now + 10 * 60 * 1000);
  return c.redirect(buildAuthorizeUrl(state));
});

// --- start.gg OAuth: callback ----------------------------------------------
auth.get("/auth/startgg/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.json({ error: "missing code or state" }, 400);

  const stateRow = db
    .prepare("SELECT state, expires_at FROM oauth_states WHERE state = ?")
    .get(state) as { state: string; expires_at: number } | undefined;
  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  if (!stateRow || stateRow.expires_at < Date.now()) {
    return c.json({ error: "invalid or expired state" }, 400);
  }

  let sgUser;
  try {
    const accessToken = await exchangeCode(code);
    sgUser = await fetchCurrentUser(accessToken);
  } catch (err) {
    console.error("[startgg] oauth error", err);
    return c.json({ error: "start.gg sign-in failed" }, 502);
  }

  const now = Date.now();
  const identity = db
    .prepare(
      "SELECT user_id FROM auth_identities WHERE provider = 'startgg' AND provider_account_id = ?",
    )
    .get(sgUser.id) as { user_id: string } | undefined;

  let userId: string;
  const displayName = sgUser.gamerTag || sgUser.slug || "start.gg user";
  const metadata = JSON.stringify({ slug: sgUser.slug, gamerTag: sgUser.gamerTag });
  if (identity) {
    userId = identity.user_id;
    db.prepare(
      "UPDATE auth_identities SET metadata = ?, updated_at = ? WHERE provider = 'startgg' AND provider_account_id = ?",
    ).run(metadata, now, sgUser.id);
  } else {
    const user = createUser(null, displayName);
    userId = user.id;
    db.prepare(
      `INSERT INTO auth_identities
         (id, user_id, provider, provider_account_id, secret, metadata, created_at, updated_at)
       VALUES (?, ?, 'startgg', ?, NULL, ?, ?, ?)`,
    ).run(uuid(), userId, sgUser.id, metadata, now, now);
  }

  createSession(c, userId, c.req.header("user-agent"));
  return c.redirect("/");
});

export default auth;
