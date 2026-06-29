import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { issueCsrf, requireCsrf } from "../src/auth/csrf.js";
import type { AppEnv } from "../src/auth/session.js";

// Create a minimal Hono app to test the CSRF middleware in isolation.
function testApp() {
  const app = new Hono<AppEnv>();
  app.get("/csrf", (c) => c.json({ token: issueCsrf(c) }));
  app.post("/protected", requireCsrf, (c) => c.json({ ok: true }));
  return app;
}

test("csrf: GET /csrf returns a token and sets cookie", async () => {
  const app = testApp();
  const res = await app.request("/csrf");
  assert.equal(res.status, 200);
  const json = await res.json() as { token: string };
  assert.ok(typeof json.token === "string" && json.token.length > 0);
  assert.ok(res.headers.getSetCookie().some((c) => c.startsWith("sgg_csrf=")));
});

test("csrf: GET /csrf returns same token on second call (reuse)", async () => {
  const app = testApp();
  const res1 = await app.request("/csrf");
  const cookie = res1.headers.getSetCookie()[0];
  const token1 = (await res1.json() as { token: string }).token;

  const res2 = await app.request("/csrf", {
    headers: { cookie },
  });
  const token2 = (await res2.json() as { token: string }).token;
  assert.equal(token2, token1);
});

test("csrf: POST without cookie returns 403", async () => {
  const app = testApp();
  const res = await app.request("/protected", { method: "POST" });
  assert.equal(res.status, 403);
});

test("csrf: POST without header returns 403", async () => {
  const app = testApp();
  const csrfRes = await app.request("/csrf");
  const cookie = csrfRes.headers.getSetCookie()[0];

  const res = await app.request("/protected", {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(res.status, 403);
});

test("csrf: POST with matching cookie + header passes", async () => {
  const app = testApp();
  const csrfRes = await app.request("/csrf");
  const cookie = csrfRes.headers.getSetCookie()[0];
  const { token } = (await csrfRes.json() as { token: string });

  const res = await app.request("/protected", {
    method: "POST",
    headers: { cookie, "x-csrf-token": token },
  });
  assert.equal(res.status, 200);
});

test("csrf: POST with mismatched cookie + header returns 403", async () => {
  const app = testApp();
  const csrfRes = await app.request("/csrf");
  const cookie = csrfRes.headers.getSetCookie()[0];

  const res = await app.request("/protected", {
    method: "POST",
    headers: { cookie, "x-csrf-token": "wrong-token" },
  });
  assert.equal(res.status, 403);
});
