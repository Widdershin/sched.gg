import { Hono } from "hono";
import { db } from "../db.js";
import type { AppEnv } from "../auth/session.js";
import {
  renderScheduleImage,
  imagePngResponse,
  validateShareToken,
  sniffImageMime,
} from "./shared.js";

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
  if (!validateShareToken(row)) return c.json({ error: "not found" }, 404);
  return c.json({
    name: row!.name,
    data: JSON.parse(row!.data),
    output: row!.output ? JSON.parse(row!.output) : null,
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
  if (!row || !row.logo) return c.body(null, 204);
  return c.body(new Uint8Array(row.logo), 200, { "Content-Type": "image/png" });
});

// Public: resolve a share token to the schedule's background image. No auth required.
share.get("/share/:token/background", (c) => {
  const row = db
    .prepare(
      `SELECT s.background AS background
         FROM share_tokens t JOIN schedules s ON s.id = t.schedule_id
        WHERE t.token = ?
          AND t.revoked = 0
          AND (t.expires_at IS NULL OR t.expires_at > ?)`,
    )
    .get(c.req.param("token"), Date.now()) as
    | { background: Buffer | null }
    | undefined;
  if (!row || !row.background) return c.body(null, 204);
  return c.body(new Uint8Array(row.background), 200, {
    "Content-Type": sniffImageMime(row.background),
  });
});

// Public: render the shared schedule as a PNG image. No auth required.
share.get("/share/:token/image", async (c) => {
  const row = db
    .prepare(
      `SELECT t.expires_at, t.revoked,
              s.id AS schedule_id, s.version, s.data, s.output, s.logo, s.background, s.rendered_image
         FROM share_tokens t JOIN schedules s ON s.id = t.schedule_id
        WHERE t.token = ?`,
    )
    .get(c.req.param("token")) as
    | {
        expires_at: number | null;
        revoked: number;
        schedule_id: string;
        version: number;
        data: string;
        output: string | null;
        logo: Buffer | null;
        background: Buffer | null;
        rendered_image: Buffer | null;
      }
    | undefined;
  if (!validateShareToken(row)) return c.json({ error: "not found" }, 404);

  const skipCache = c.req.query("cacheBust") != null;
  const png = await renderScheduleImage(row!, row!.schedule_id, skipCache);
  return imagePngResponse(png, row!.version);
});

export default share;
