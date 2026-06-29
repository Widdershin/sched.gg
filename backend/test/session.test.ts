// Tests for session auth: sign(), parseSessionCookie().
//
// NOTE: createSession, clearSession, lookupSessionUser, and the middleware
// functions depend on the global `db` connection (which opens a real file) and
// Hono context objects. They need integration tests with an in-memory DB + a
// testable Hono app. For now we cover the pure functions exhaustively.

import test from "node:test";
import assert from "node:assert/strict";

import { sign, parseSessionCookie } from "../src/auth/session.js";

// ---------------------------------------------------------------------------
// sign()
// ---------------------------------------------------------------------------

test("sign: deterministic for same input", () => {
  const a = sign("abc123");
  const b = sign("abc123");
  assert.equal(a, b);
});

test("sign: different inputs produce different outputs", () => {
  const a = sign("abc");
  const b = sign("def");
  assert.notEqual(a, b);
});

test("sign: output is non-empty base64url", () => {
  const s = sign("hello");
  assert.ok(s.length > 0);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(s));
});

// ---------------------------------------------------------------------------
// parseSessionCookie
// ---------------------------------------------------------------------------

test("parseSessionCookie: valid signed cookie returns id", () => {
  const id = "sess-abc123";
  const raw = `${id}.${sign(id)}`;
  assert.equal(parseSessionCookie(raw), id);
});

test("parseSessionCookie: returns null for undefined / empty", () => {
  assert.equal(parseSessionCookie(undefined), null);
  assert.equal(parseSessionCookie(""), null);
});

test("parseSessionCookie: returns null for missing dot separator", () => {
  assert.equal(parseSessionCookie("nodot"), null);
});

test("parseSessionCookie: returns null for tampered signature", () => {
  const id = "sess-abc123";
  const raw = `${id}.tampered-signature`;
  assert.equal(parseSessionCookie(raw), null);
});

test("parseSessionCookie: returns null for tampered id", () => {
  const id = "sess-abc123";
  const raw = `${id}.${sign(id)}`;
  const tampered = `sess-xyz789.${raw.split(".")[1]}`;
  assert.equal(parseSessionCookie(tampered), null);
});

test("parseSessionCookie: handles multiple dots in id", () => {
  const id = "tok.123.abc";
  const raw = `${id}.${sign(id)}`;
  assert.equal(parseSessionCookie(raw), id);
});

test("parseSessionCookie: handles empty id part", () => {
  const raw = `.${sign("")}`;
  const result = parseSessionCookie(raw);
  assert.equal(result, "");
});
