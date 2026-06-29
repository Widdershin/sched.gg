import crypto from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db } from "../db.js";
import { env } from "../env.js";
import { token } from "../util/ids.js";

const COOKIE = "sgg_session";
const MAX_AGE_DAYS = 30;
const MAX_AGE_SEC = MAX_AGE_DAYS * 24 * 60 * 60;

export interface SessionUser {
  id: string;
  username: string | null;
  displayName: string | null;
}

// Hono environment binding so c.get("user") / c.set(...) are typed.
export interface AppEnv {
  Variables: {
    user?: SessionUser;
    sessionId?: string;
    scheduleId?: string;
  };
}

function sign(value: string): string {
  return crypto
    .createHmac("sha256", env.sessionSecret)
    .update(value)
    .digest("base64url");
}

function parseSessionCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot === -1) return null;
  const id = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(id);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

export function createSession(
  c: Context<AppEnv>,
  userId: string,
  userAgent?: string,
): void {
  const id = token(24);
  const now = Date.now();
  const expires = now + MAX_AGE_SEC * 1000;
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, revoked, user_agent)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, userId, now, now, expires, userAgent ?? null);

  setCookie(c, COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: env.cookieSecure,
    maxAge: MAX_AGE_SEC,
  });
}

export function clearSession(c: Context<AppEnv>): void {
  const id = parseSessionCookie(getCookie(c, COOKIE));
  if (id) db.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?").run(id);
  deleteCookie(c, COOKIE, { path: "/" });
}

function lookupSessionUser(c: Context<AppEnv>): SessionUser | null {
  const id = parseSessionCookie(getCookie(c, COOKIE));
  if (!id) return null;
  const row = db
    .prepare(
      `SELECT s.expires_at AS exp, s.revoked AS rev,
              u.id AS uid, u.username AS username, u.display_name AS displayName
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
    .get(id) as
    | {
        exp: number;
        rev: number;
        uid: string;
        username: string | null;
        displayName: string | null;
      }
    | undefined;
  if (!row || row.rev || row.exp < Date.now()) return null;
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(
    Date.now(),
    id,
  );
  c.set("sessionId", id);
  return { id: row.uid, username: row.username, displayName: row.displayName };
}

// Populate c.get("user") for every request (no-op when signed out).
export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = lookupSessionUser(c);
  if (user) c.set("user", user);
  await next();
};

// Reject unauthenticated requests.
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
  await next();
};

// Reject requests for a schedule the current user doesn't own. Must run after
// requireAuth. Stashes the verified id in c.get("scheduleId"). Mount on both
// "/schedules/:id" and "/schedules/:id/*".
export const requireScheduleOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not found" }, 404);
  const owned = db
    .prepare("SELECT id FROM schedules WHERE id = ? AND user_id = ?")
    .get(id, c.get("user")!.id);
  if (!owned) return c.json({ error: "not found" }, 404);
  c.set("scheduleId", id);
  await next();
};
