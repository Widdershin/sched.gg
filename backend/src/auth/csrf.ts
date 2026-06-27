import crypto from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { env } from "../env.js";
import { token } from "../util/ids.js";
import type { AppEnv } from "./session.js";

const COOKIE = "sgg_csrf";

// Issue (or reuse) a readable CSRF cookie and return its value. The client must
// echo it in the X-CSRF-Token header on mutating requests (double-submit).
export function issueCsrf(c: Context<AppEnv>): string {
  let value = getCookie(c, COOKIE);
  if (!value) {
    value = token(18);
    setCookie(c, COOKIE, value, {
      httpOnly: false,
      sameSite: "Lax",
      path: "/",
      secure: env.cookieSecure,
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return value;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Enforce double-submit CSRF on mutating methods.
export const requireCsrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  const cookie = getCookie(c, COOKIE);
  const header = c.req.header("x-csrf-token");
  if (!cookie || !header || !timingSafeEqual(cookie, header)) {
    return c.json({ error: "invalid csrf token" }, 403);
  }
  await next();
};
