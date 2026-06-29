// Shared utilities used by multiple route files.
import type { Context } from "hono";
import type { AppEnv } from "../auth/session.js";
import { db } from "../db.js";
import type { Schedule, OutputSettings } from "../../../shared/types.js";

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
