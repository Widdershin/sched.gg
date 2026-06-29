import { Hono } from "hono";
import { db } from "../db.js";
import { uuid, token } from "../util/ids.js";
import {
  type AppEnv,
  requireAuth,
  requireScheduleOwner,
} from "../auth/session.js";
import { requireCsrf } from "../auth/csrf.js";
import {
  fetchTournamentParticipants,
  type FetchedParticipant,
} from "../startgg/tournament.js";
import {
  readEntrants,
  reconcileEntrants,
  addManualEntrant,
  setEntrantRole,
  setEntrantName,
  deleteManualEntrant,
  reassignRole,
} from "../entrants-store.js";
import type { Schedule } from "../../../shared/types.js";
import {
  userId,
  getOwnedSchedule,
  parseScheduleRow,
  parseJsonBody,
  invalidateScheduleCache,
  renderScheduleImage,
  imagePngResponse,
  requireStartggToken,
  startggErrorResponse,
} from "./shared.js";

const schedules = new Hono<AppEnv>();

// All schedule routes require a signed-in user.
schedules.use("/schedules", requireAuth);
schedules.use("/schedules/*", requireAuth);
// Ownership is enforced once here for every /schedules/:id... route.
schedules.use("/schedules/:id", requireScheduleOwner);
schedules.use("/schedules/:id/*", requireScheduleOwner);

// List the current user's schedules (metadata only).
schedules.get("/schedules", (c) => {
  const rows = db
    .prepare(
      `SELECT id, name, updated_at FROM schedules
        WHERE user_id = ? ORDER BY updated_at DESC`,
    )
    .all(userId(c)) as { id: string; name: string; updated_at: number }[];
  return c.json({ schedules: rows });
});

// Create a schedule.
schedules.post("/schedules", requireCsrf, async (c) => {
  const body = await parseJsonBody<{
    name?: string;
    data?: unknown;
    output?: unknown;
  }>(c);
  const name = (body.name || "Untitled tournament").toString().slice(0, 200);
  const id = uuid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO schedules (id, user_id, name, data, output, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId(c),
    name,
    JSON.stringify(body.data ?? {}),
    body.output != null ? JSON.stringify(body.output) : null,
    now,
    now,
  );
  return c.json({ id, name, updated_at: now });
});

// Fetch a single schedule (parsed).
schedules.get("/schedules/:id", (c) => {
  const row = getOwnedSchedule<{
    id: string; name: string; data: string; output: string | null; updated_at: number;
  }>(c.req.param("id"), "id, name, data, output, updated_at");
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({
    id: row.id,
    name: row.name,
    data: JSON.parse(row.data),
    output: row.output ? JSON.parse(row.output) : null,
    updated_at: row.updated_at,
  });
});

// Update a schedule (autosave target). Any of name/data/output may be present.
schedules.put("/schedules/:id", requireCsrf, async (c) => {
  const id = c.req.param("id");
  const body = await parseJsonBody<{
    name?: string;
    data?: unknown;
    output?: unknown;
  }>(c);
  const sets: string[] = [];
  const params: (string | number | bigint | Buffer | null)[] = [];
  if (body.name !== undefined) {
    sets.push("name = ?");
    params.push(body.name.toString().slice(0, 200));
  }
  if (body.data !== undefined) {
    sets.push("data = ?");
    params.push(JSON.stringify(body.data));
  }
  if (body.output !== undefined) {
    sets.push("output = ?");
    params.push(body.output != null ? JSON.stringify(body.output) : null);
  }
  if (body.data !== undefined || body.output !== undefined) {
    invalidateScheduleCache(id);
  }
  const now = Date.now();
  sets.push("updated_at = ?");
  params.push(now);
  params.push(id);
  db.prepare(`UPDATE schedules SET ${sets.join(", ")} WHERE id = ?`).run(
    ...params,
  );
  return c.json({ ok: true, updated_at: now });
});

// Delete a schedule.
schedules.delete("/schedules/:id", requireCsrf, (c) => {
  const res = db
    .prepare("DELETE FROM schedules WHERE id = ?")
    .run(c.req.param("id"));
  if (res.changes === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// Create a public share token for a schedule.
schedules.post("/schedules/:id/share", requireCsrf, (c) => {
  const id = c.req.param("id");
  const t = token(18);
  db.prepare(
    `INSERT INTO share_tokens (token, schedule_id, created_at, expires_at, revoked)
     VALUES (?, ?, ?, NULL, 0)`,
  ).run(t, id, Date.now());
  return c.json({ token: t, url: `/?share=${t}` });
});

// Logo upload — raw PNG bytes, max 1 MB.
schedules.put("/schedules/:id/logo", requireCsrf, async (c) => {
  const id = c.req.param("id");
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.length === 0 || buf.length > 1_000_000) {
    return c.json({ error: "invalid body" }, 400);
  }
  const now = Date.now();
  db.prepare("UPDATE schedules SET logo = ?, updated_at = ? WHERE id = ?").run(buf, now, id);
  invalidateScheduleCache(id);
  return c.json({ ok: true, updated_at: now });
});

// Logo deletion.
schedules.delete("/schedules/:id/logo", requireCsrf, (c) => {
  const id = c.req.param("id");
  const now = Date.now();
  db.prepare("UPDATE schedules SET logo = NULL, updated_at = ? WHERE id = ?").run(now, id);
  invalidateScheduleCache(id);
  return c.json({ ok: true, updated_at: now });
});

// Logo download — returns raw PNG bytes.
schedules.get("/schedules/:id/logo", (c) => {
  const row = getOwnedSchedule<{ logo: Buffer | null }>(
    c.req.param("id"), "logo",
  );
  if (!row || !row.logo) return c.body(null, 204);
  return c.body(new Uint8Array(row.logo), 200, { "Content-Type": "image/png" });
});

// Render the schedule to a PNG image (auth required).
schedules.get("/schedules/:id/image", async (c) => {
  const id = c.req.param("id");
  const row = getOwnedSchedule<{
    version: number; data: string; output: string | null;
    logo: Buffer | null; rendered_image: Buffer | null;
  }>(id, "version, data, output, logo, rendered_image");
  if (!row) return c.json({ error: "not found" }, 404);

  const png = await renderScheduleImage(row, id, false);
  return imagePngResponse(png, row.version);
});

// --- Tournament entrants (start.gg) ----------------------------------------

// Persisted entrants for a schedule.
schedules.get("/schedules/:id/entrants", (c) => {
  const id = c.req.param("id");
  const row = db
    .prepare("SELECT entrants_synced_at FROM schedules WHERE id = ?")
    .get(id) as { entrants_synced_at: number | null } | undefined;
  return c.json({
    entrants: readEntrants(db, id),
    syncedAt: row?.entrants_synced_at ?? null,
  });
});

// Fetch entrants from start.gg and persist them (full replace), so the lanyards
// page runs off stored data and a re-sync picks up new/dropped registrations.
schedules.post("/schedules/:id/entrants/sync", requireCsrf, async (c) => {
  const id = c.req.param("id");
  const row = getOwnedSchedule<{ data: string }>(id, "data");
  if (!row) return c.json({ error: "not found" }, 404);

  const schedule = JSON.parse(row.data) as Schedule;
  const slug = schedule.startgg?.slug?.trim();
  if (!slug) {
    return c.json({ error: "schedule has no start.gg tournament" }, 400);
  }

  const accessToken = await requireStartggToken(c);
  if (!accessToken) return c.json({ error: "start.gg account not linked" }, 409);

  let entrants: FetchedParticipant[];
  try {
    entrants = await fetchTournamentParticipants(accessToken, slug);
  } catch (err) {
    return startggErrorResponse(err, "participants query failed");
  }

  const now = Date.now();
  reconcileEntrants(db, id, entrants, now);
  return c.json({ entrants: readEntrants(db, id), syncedAt: now });
});

// Assign a role to a single entrant.
schedules.put("/schedules/:id/entrants/:pid/role", requireCsrf, async (c) => {
  const id = c.req.param("id");
  const pid = c.req.param("pid");
  const body = await parseJsonBody<{ role?: string }>(c);
  const role = (body.role || "Competitor").toString().slice(0, 100);
  if (!setEntrantRole(db, id, pid, role)) {
    return c.json({ error: "entrant not found" }, 404);
  }
  return c.json({ ok: true });
});

// Bulk reassign all entrants of one role to another (used when deleting a role).
schedules.post("/schedules/:id/entrants/reassign-role", requireCsrf, async (c) => {
  const id = c.req.param("id");
  const body = await parseJsonBody<{
    from?: string;
    to?: string;
  }>(c);
  const from = (body.from || "").toString();
  const to = (body.to || "Competitor").toString().slice(0, 100);
  if (!from) return c.json({ error: "missing from" }, 400);
  reassignRole(db, id, from, to);
  return c.json({ ok: true });
});

// Set (or clear) a custom display name for a single entrant.
schedules.put("/schedules/:id/entrants/:pid/name", requireCsrf, async (c) => {
  const id = c.req.param("id");
  const pid = c.req.param("pid");
  const body = await parseJsonBody<{ name?: string }>(c);
  const name = (body.name ?? "").toString().trim().slice(0, 200) || null;
  if (!setEntrantName(db, id, pid, name)) {
    return c.json({ error: "entrant not found" }, 404);
  }
  return c.json({ ok: true });
});

// Add a manual entrant (a player not registered on start.gg).
schedules.post("/schedules/:id/entrants", requireCsrf, async (c) => {
  const id = c.req.param("id");
  const body = await parseJsonBody<{
    name?: string;
    role?: string;
  }>(c);
  const name = (body.name ?? "").toString().trim().slice(0, 200);
  if (!name) return c.json({ error: "name required" }, 400);
  const role = (body.role || "Competitor").toString().slice(0, 100);
  return c.json({ entrant: addManualEntrant(db, id, name, role) });
});

// Delete a manual entrant (start.gg entrants would return on the next sync).
schedules.delete("/schedules/:id/entrants/:pid", requireCsrf, (c) => {
  const id = c.req.param("id");
  const pid = c.req.param("pid");
  if (!deleteManualEntrant(db, id, pid)) {
    return c.json({ error: "manual entrant not found" }, 404);
  }
  return c.json({ ok: true });
});

export default schedules;
