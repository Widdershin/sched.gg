import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

test("hashPassword returns scrypt-encoded string", () => {
  const h = hashPassword("hello");
  assert.ok(typeof h === "string" && h.length > 0);
  const parts = h.split("$");
  assert.equal(parts.length, 6);
  assert.equal(parts[0], "scrypt");
  assert.equal(parts[1], "16384");
  assert.equal(parts[2], "8");
  assert.equal(parts[3], "1");
  // salt and hash are valid base64
  assert.ok(Buffer.from(parts[4], "base64").length > 0);
  assert.ok(Buffer.from(parts[5], "base64").length > 0);
});

test("hashPassword produces unique salts", () => {
  const h1 = hashPassword("hello");
  const h2 = hashPassword("hello");
  assert.notEqual(h1, h2);
  // salts differ
  const s1 = h1.split("$")[4];
  const s2 = h2.split("$")[4];
  assert.notEqual(s1, s2);
});

test("verifyPassword: correct password returns true", () => {
  const h = hashPassword("mypassword");
  assert.equal(verifyPassword("mypassword", h), true);
});

test("verifyPassword: wrong password returns false", () => {
  const h = hashPassword("correct");
  assert.equal(verifyPassword("wrong", h), false);
});

test("verifyPassword: case-sensitive", () => {
  const h = hashPassword("Password");
  assert.equal(verifyPassword("password", h), false);
  assert.equal(verifyPassword("Password", h), true);
});

test("verifyPassword: handles special characters + unicode", () => {
  const passwords = ["héllo wörld", "!@#$%^&*()", "日本語パスワード", "a".repeat(128)];
  for (const pw of passwords) {
    const h = hashPassword(pw);
    assert.equal(verifyPassword(pw, h), true);
    assert.equal(verifyPassword(pw + "x", h), false);
  }
});

test("verifyPassword: rejects malformed encoded strings", () => {
  assert.equal(verifyPassword("pw", ""), false);
  assert.equal(verifyPassword("pw", "scrypt$N$r$p$salt"), false);
  assert.equal(verifyPassword("pw", "scrypt$N$r$p$salt$hash$extra"), false);
});

test("verifyPassword: rejects wrong prefix", () => {
  const h = hashPassword("pw");
  const tampered = "bcrypt" + h.slice(6);
  assert.equal(verifyPassword("pw", tampered), false);
});

test("verifyPassword: rejects tampered salt", () => {
  const h = hashPassword("pw");
  const parts = h.split("$");
  parts[4] = Buffer.from("tampered-salt!!").toString("base64");
  assert.equal(verifyPassword("pw", parts.join("$")), false);
});

test("verifyPassword: rejects tampered hash", () => {
  const h = hashPassword("pw");
  const parts = h.split("$");
  parts[5] = Buffer.from("tampered-hash!!").toString("base64");
  assert.equal(verifyPassword("pw", parts.join("$")), false);
});

test("verifyPassword: empty password", () => {
  const h = hashPassword("");
  assert.equal(verifyPassword("", h), true);
  assert.equal(verifyPassword("x", h), false);
});
