// Test helper: create Hono apps with in-memory SQLite DB.
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { setTestDb } from "../src/db.js";
import { migrate } from "../src/migrations.js";
import { type AppEnv, loadUser } from "../src/auth/session.js";
import authRoutes from "../src/routes/auth.js";
import health from "../src/routes/health.js";

export function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  setTestDb(db);
  return db;
}

export function createAuthApp(): Hono<AppEnv> {
  freshDb();
  const app = new Hono<AppEnv>();
  app.use("*", loadUser);
  app.route("/", authRoutes);
  app.route("/", health);
  return app;
}

// Get a fresh CSRF token + cookie for making mutating requests.
export async function getCsrf(
  app: Hono<AppEnv>,
  existingCookie?: string,
): Promise<{ token: string; cookie: string }> {
  const res = await app.request("/auth/csrf", {
    headers: existingCookie ? { cookie: existingCookie } : {},
  });
  const setCookie = (res.headers.getSetCookie?.() ?? []).join("; ");
  const cookie = setCookie
    ? (existingCookie ? `${setCookie}; ${existingCookie}` : setCookie)
    : (existingCookie ?? "");
  const json = await res.json() as { token: string };
  return { token: json.token, cookie };
}

// Register a test user and return the session cookie.
export async function registerUser(
  app: Hono<AppEnv>,
  username: string,
  password: string,
): Promise<{ cookie: string; user: { id: string } }> {
  const { token, cookie: csrfCookie } = await getCsrf(app);
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: csrfCookie,
      "x-csrf-token": token,
    },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json() as { user: { id: string }; error?: string };
  if (json.error) throw new Error(`Registration failed: ${json.error}`);
  // Merge Set-Cookie headers with the CSRF cookie
  const setCookie = (res.headers.getSetCookie?.() ?? []).join("; ");
  const sessionCookie = setCookie ? `${setCookie}; ${csrfCookie}` : csrfCookie;
  return { cookie: sessionCookie, user: json.user };
}
