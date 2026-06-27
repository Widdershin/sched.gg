import crypto from "node:crypto";

export function uuid(): string {
  return crypto.randomUUID();
}

// URL-safe random token (base64url, no padding).
export function token(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
