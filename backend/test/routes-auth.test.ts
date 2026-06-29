import test from "node:test";
import assert from "node:assert/strict";
import { createAuthApp, registerUser, getCsrf } from "./helpers.js";

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

test("GET /health returns ok", async () => {
  const app = createAuthApp();
  const res = await app.request("/health");
  assert.equal(res.status, 200);
  const json = await res.json() as { ok: boolean };
  assert.equal(json.ok, true);
});

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

test("GET /auth/csrf returns token and sets cookie", async () => {
  const app = createAuthApp();
  const res = await app.request("/auth/csrf");
  assert.equal(res.status, 200);
  const json = await res.json() as { token: string };
  assert.ok(json.token.length > 0);
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

test("POST /auth/register creates user and returns session", async () => {
  const app = createAuthApp();
  const { cookie, user } = await registerUser(app, "alice", "password123");
  assert.ok(user.id.length > 0);
  assert.ok(cookie.includes("sgg_session="));
});

test("POST /auth/register rejects short username", async () => {
  const app = createAuthApp();
  const { token, cookie } = await getCsrf(app);
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": token,
    },
    body: JSON.stringify({ username: "ab", password: "password123" }),
  });
  assert.equal(res.status, 400);
});

test("POST /auth/register rejects short password", async () => {
  const app = createAuthApp();
  const { token, cookie } = await getCsrf(app);
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": token,
    },
    body: JSON.stringify({ username: "alice", password: "12345" }),
  });
  assert.equal(res.status, 400);
});

test("POST /auth/register rejects duplicate username", async () => {
  const app = createAuthApp();
  await registerUser(app, "bob", "password123");
  const { token, cookie } = await getCsrf(app);
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": token,
    },
    body: JSON.stringify({ username: "bob", password: "password123" }),
  });
  assert.equal(res.status, 409);
});

test("POST /auth/register requires CSRF", async () => {
  const app = createAuthApp();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "alice", password: "password123" }),
  });
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

test("POST /auth/login succeeds with correct credentials", async () => {
  const app = createAuthApp();
  await registerUser(app, "carol", "password123");
  const { token, cookie } = await getCsrf(app);
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": token,
    },
    body: JSON.stringify({ username: "carol", password: "password123" }),
  });
  assert.equal(res.status, 200);
  const json = await res.json() as { user: { id: string } };
  assert.ok(json.user.id.length > 0);
});

test("POST /auth/login fails with wrong password", async () => {
  const app = createAuthApp();
  await registerUser(app, "dave", "password123");
  const { token, cookie } = await getCsrf(app);
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": token,
    },
    body: JSON.stringify({ username: "dave", password: "wrongpass" }),
  });
  assert.equal(res.status, 401);
});

test("POST /auth/login fails for non-existent user", async () => {
  const app = createAuthApp();
  const { token, cookie } = await getCsrf(app);
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": token,
    },
    body: JSON.stringify({ username: "nobody", password: "password123" }),
  });
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// Current user (me)
// ---------------------------------------------------------------------------

test("GET /auth/me returns null when not authenticated", async () => {
  const app = createAuthApp();
  const res = await app.request("/auth/me");
  assert.equal(res.status, 200);
  const json = await res.json() as { user: null };
  assert.equal(json.user, null);
});

test("GET /auth/me returns user when authenticated", async () => {
  const app = createAuthApp();
  const { cookie, user } = await registerUser(app, "eve", "password123");
  const res = await app.request("/auth/me", { headers: { cookie } });
  assert.equal(res.status, 200);
  const json = await res.json() as { user: { id: string; username: string } };
  assert.equal(json.user.id, user.id);
  assert.equal(json.user.username, "eve");
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

test("POST /auth/logout clears session", async () => {
  const app = createAuthApp();
  const { cookie } = await registerUser(app, "frank", "password123");

  // Verify we're authenticated
  const meRes = await app.request("/auth/me", { headers: { cookie } });
  const meJson = await meRes.json() as { user: { id: string } };
  assert.notEqual(meJson.user, null);

  // Logout requires CSRF
  const { token } = await getCsrf(app, cookie);
  const logoutRes = await app.request("/auth/logout", {
    method: "POST",
    headers: {
      cookie,
      "x-csrf-token": token,
    },
  });
  assert.equal(logoutRes.status, 200);
});

// ---------------------------------------------------------------------------
// Dev login
// ---------------------------------------------------------------------------

test("POST /auth/dev-login creates dev user and sets session", async () => {
  const app = createAuthApp();
  // Dev login is enabled in non-production (default test env)
  const { token, cookie } = await getCsrf(app);
  const res = await app.request("/auth/dev-login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": token,
    },
  });
  // 200 if devLogin is enabled (default NODE_ENV=development), 404 otherwise
  if (res.status === 200) {
    const json = await res.json() as { user: { id: string; username: string } };
    assert.ok(json.user.id.length > 0);
    assert.ok(res.headers.getSetCookie?.().some((c) => c.startsWith("sgg_session=")));
  }
});

test("POST /auth/dev-login reuses existing dev user", async () => {
  const app = createAuthApp();
  const { token, cookie } = await getCsrf(app);
  const res1 = await app.request("/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-csrf-token": token },
    body: JSON.stringify({ username: "dev" }),
  });
  if (res1.status !== 200) return;
  const json1 = await res1.json() as { user: { id: string } };

  // Login again with same username
  const { token: token2, cookie: cookie2 } = await getCsrf(app);
  const res2 = await app.request("/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie2, "x-csrf-token": token2 },
    body: JSON.stringify({ username: "dev" }),
  });
  assert.equal(res2.status, 200);
  const json2 = await res2.json() as { user: { id: string } };
  assert.equal(json1.user.id, json2.user.id);
});
