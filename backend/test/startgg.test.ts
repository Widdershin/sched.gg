import test from "node:test";
import assert from "node:assert/strict";
import { parseTokenResponse } from "../src/auth/startgg.js";

// ---------------------------------------------------------------------------
// parseTokenResponse
// ---------------------------------------------------------------------------

test("parseTokenResponse: valid response with all fields", () => {
  const result = parseTokenResponse({
    access_token: "tok123",
    refresh_token: "ref456",
    expires_in: 3600,
  });
  assert.deepEqual(result, {
    accessToken: "tok123",
    refreshToken: "ref456",
    expiresIn: 3600,
  });
});

test("parseTokenResponse: valid response with only access_token", () => {
  const result = parseTokenResponse({
    access_token: "tok123",
  });
  assert.deepEqual(result, {
    accessToken: "tok123",
    refreshToken: null,
    expiresIn: null,
  });
});

test("parseTokenResponse: null refresh_token → null", () => {
  const result = parseTokenResponse({
    access_token: "tok",
    refresh_token: null,
    expires_in: 3600,
  });
  assert.equal(result.refreshToken, null);
});

test("parseTokenResponse: missing expires_in → null", () => {
  const result = parseTokenResponse({
    access_token: "tok",
    refresh_token: "ref",
  });
  assert.equal(result.expiresIn, null);
});

test("parseTokenResponse: non-number expires_in → null", () => {
  const result = parseTokenResponse({
    access_token: "tok",
    expires_in: "not-a-number",
  });
  assert.equal(result.expiresIn, null);
});

test("parseTokenResponse: missing access_token throws", () => {
  assert.throws(
    () => parseTokenResponse({ refresh_token: "ref" }),
    /missing access_token/,
  );
});

test("parseTokenResponse: null input throws", () => {
  assert.throws(
    () => parseTokenResponse(null),
    /missing access_token/,
  );
});

test("parseTokenResponse: undefined input throws", () => {
  assert.throws(
    () => parseTokenResponse(undefined),
    /missing access_token/,
  );
});

test("parseTokenResponse: empty object throws", () => {
  assert.throws(
    () => parseTokenResponse({}),
    /missing access_token/,
  );
});

test("parseTokenResponse: zero expires_in is valid", () => {
  const result = parseTokenResponse({
    access_token: "tok",
    expires_in: 0,
  });
  assert.equal(result.expiresIn, 0);
});
