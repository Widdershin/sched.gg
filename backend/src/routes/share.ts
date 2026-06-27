import { Hono } from "hono";
import { db } from "../db.js";
import type { AppEnv } from "../auth/session.js";

const share = new Hono<AppEnv>();

// Public: resolve a share token to its (live) schedule data. No auth required.
share.get("/share/:token", (c) => {
  const row = db
    .prepare(
      `SELECT t.expires_at AS expires_at, t.revoked AS revoked,
              s.name AS name, s.data AS data, s.output AS output
         FROM share_tokens t JOIN schedules s ON s.id = t.schedule_id
        WHERE t.token = ?`,
    )
    .get(c.req.param("token")) as
    | {
        expires_at: number | null;
        revoked: number;
        name: string;
        data: string;
        output: string | null;
      }
    | undefined;
  if (!row || row.revoked || (row.expires_at != null && row.expires_at < Date.now())) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({
    name: row.name,
    data: JSON.parse(row.data),
    output: row.output ? JSON.parse(row.output) : null,
  });
});

// Public: resolve a share token to the schedule's logo. No auth required.
share.get("/share/:token/logo", (c) => {
  const row = db
    .prepare(
      `SELECT s.logo AS logo
         FROM share_tokens t JOIN schedules s ON s.id = t.schedule_id
        WHERE t.token = ?
          AND t.revoked = 0
          AND (t.expires_at IS NULL OR t.expires_at > ?)`,
    )
    .get(c.req.param("token"), Date.now()) as
    | { logo: Buffer | null }
    | undefined;
  if (!row || !row.logo) {
    return c.body(null, 204);
  }
  return c.body(new Uint8Array(row.logo), 200, { "Content-Type": "image/png" });
});

export default share;
