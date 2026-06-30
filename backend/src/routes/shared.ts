// Shared utilities used by multiple route files.
import type { Context } from "hono";
import type { AppEnv } from "../auth/session.js";
import { db } from "../db.js";
import type { Schedule, OutputSettings } from "../../../shared/types.js";
import { renderScheduleToPng } from "../render.js";

/** Extract the authenticated user's id from the Hono context. */
export function userId(c: Context<AppEnv>): string {
  return c.get("user")!.id;
}

/** Fetch a schedule row by id. Only call on routes where requireScheduleOwner
 * middleware already verified ownership. */
export function getOwnedSchedule<T>(id: string, columns: string): T | undefined {
  return db.prepare(`SELECT ${columns} FROM schedules WHERE id = ?`).get(id) as T | undefined;
}

/** JSON-parse a schedule row's data and output columns. */
export function parseScheduleRow(row: { data: string; output: string | null }): {
  schedule: Schedule;
  output: OutputSettings | null;
} {
  return {
    schedule: JSON.parse(row.data) as Schedule,
    output: row.output ? (JSON.parse(row.output) as OutputSettings) : null,
  };
}

/** Parse a JSON body from a request, defaulting to {} on error. */
export async function parseJsonBody<T>(c: Context): Promise<T> {
  return (await c.req.json().catch(() => ({}))) as T;
}

/** Bump version + clear rendered_image on a schedule that changed. */
export function invalidateScheduleCache(id: string): void {
  const now = Date.now();
  db.prepare(
    "UPDATE schedules SET version = version + 1, rendered_image = NULL, updated_at = ? WHERE id = ?",
  ).run(now, id);
}

/** Render a schedule to PNG, optionally caching the result in the DB. */
export async function renderScheduleImage(
  row: { version: number; data: string; output: string | null; logo: Buffer | null; background: Buffer | null; rendered_image: Buffer | null },
  scheduleId: string,
  skipCache: boolean,
): Promise<Buffer> {
  if (!skipCache && row.rendered_image) return row.rendered_image;

  const { schedule, output } = parseScheduleRow(row);
  const png = await renderScheduleToPng({
    schedule,
    output,
    visuals: output?.visuals,
    logoBytes: row.logo ?? undefined,
    backgroundBytes: row.background ?? undefined,
  });

  if (!skipCache) {
    db.prepare("UPDATE schedules SET rendered_image = ? WHERE id = ?").run(
      png,
      scheduleId,
    );
  }

  return png;
}

/** Detect an image's MIME type from its magic bytes (PNG/JPEG/GIF/WebP),
 * defaulting to image/png. Used when serving stored image blobs whose encoding
 * isn't recorded in the DB. */
export function sniffImageMime(buf: Buffer | Uint8Array): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return "image/png";
}

/** Build a standard image PNG response with ETag + Cache-Control. */
export function imagePngResponse(png: Buffer, version: number): Response {
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
      "ETag": `"v${version}"`,
    },
  });
}

/** Validate a share token row's revoked/expired status. */
export function validateShareToken(
  row: { revoked: number; expires_at: number | null } | undefined,
): boolean {
  return !(!row || row.revoked || (row.expires_at != null && row.expires_at < Date.now()));
}

// --- start.gg helpers ---------------------------------------------------------

import { getStartggAccessToken } from "../auth/startgg-token.js";
import { StartggApiError } from "../startgg/tournament.js";

/** Fetch the user's start.gg access token, or return null (caller should 409). */
export async function requireStartggToken(c: Context): Promise<string | null> {
  return getStartggAccessToken(userId(c));
}

/** Build a standard error response for start.gg API failures. */
export function startggErrorResponse(err: unknown, label: string): Response {
  if (err instanceof StartggApiError && err.forbidden) {
    return new Response(JSON.stringify({ error: "no access to this tournament" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  console.error(`[startgg] ${label}`, err);
  return new Response(JSON.stringify({ error: "start.gg query failed" }), {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });
}
