import { Hono, type Context } from "hono";
import { db } from "../db.js";
import { uuid, token } from "../util/ids.js";
import {
  type AppEnv,
  requireAuth,
  requireScheduleOwner,
} from "../auth/session.js";
import { requireCsrf } from "../auth/csrf.js";
import { renderScheduleToPng } from "../render.js";
import { getStartggAccessToken } from "../auth/startgg-token.js";
import {
  fetchTournamentParticipants,
  StartggApiError,
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
import type { Schedule, OutputSettings } from "../../../shared/types.js";

const schedules = new Hono<AppEnv>();

// All schedule routes require a signed-in user.
schedules.use("/schedules", requireAuth);
schedules.use("/schedules/*", requireAuth);
// Ownership is enforced once here for every /schedules/:id... route.
schedules.use("/schedules/:id", requireScheduleOwner);
schedules.use("/schedules/:id/*", requireScheduleOwner);

function userId(c: Context<AppEnv>): string {
  return c.get("user")!.id;
}

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
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    data?: unknown;
    output?: unknown;
  };
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
  const row = db
    .prepare(
      `SELECT id, name, data, output, updated_at FROM schedules
        WHERE id = ? AND user_id = ?`,
    )
    .get(c.req.param("id"), userId(c)) as
    | { id: string; name: string; data: string; output: string | null; updated_at: number }
    | undefined;
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
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    data?: unknown;
    output?: unknown;
  };
  const sets: string[] = [];
  const params: unknown[] = [];
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
    sets.push("version = version + 1, rendered_image = NULL");
  }
  const now = Date.now();
  sets.push("updated_at = ?");
  params.push(now);
  params.push(id);
  db.prepare(`UPDATE schedules SET ${sets.join(", ")} WHERE id = ?`).run(
    ...(params as never[]),
  );
  return c.json({ ok: true, updated_at: now });
});

// Delete a schedule.
schedules.delete("/schedules/:id", requireCsrf, (c) => {
  const res = db
    .prepare("DELETE FROM schedules WHERE id = ? AND user_id = ?")
    .run(c.req.param("id"), userId(c));
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
  db.prepare("UPDATE schedules SET logo = ?, version = version + 1, rendered_image = NULL, updated_at = ? WHERE id = ?").run(
    buf,
    now,
    id,
  );
  return c.json({ ok: true, updated_at: now });
});

// Logo deletion.
schedules.delete("/schedules/:id/logo", requireCsrf, (c) => {
  const id = c.req.param("id");
  const now = Date.now();
  db.prepare("UPDATE schedules SET logo = NULL, version = version + 1, rendered_image = NULL, updated_at = ? WHERE id = ?").run(
    now,
    id,
  );
  return c.json({ ok: true, updated_at: now });
});

// Logo download — returns raw PNG bytes.
schedules.get("/schedules/:id/logo", (c) => {
  const row = db
    .prepare("SELECT logo FROM schedules WHERE id = ? AND user_id = ?")
    .get(c.req.param("id"), userId(c)) as
    | { logo: Buffer | null }
    | undefined;
  if (!row || !row.logo) {
    return c.body(null, 204);
  }
  return c.body(new Uint8Array(row.logo), 200, { "Content-Type": "image/png" });
});

// Render the schedule to a PNG image (auth required).
schedules.get("/schedules/:id/image", async (c) => {
  const id = c.req.param("id");
  const row = db
    .prepare(
      "SELECT version, data, output, logo, rendered_image FROM schedules WHERE id = ? AND user_id = ?",
    )
    .get(id, userId(c)) as
    | { version: number; data: string; output: string | null; logo: Buffer | null; rendered_image: Buffer | null }
    | undefined;
  if (!row) return c.json({ error: "not found" }, 404);

  // Return cached BLOB if present.
  if (row.rendered_image) {
    return c.body(new Uint8Array(row.rendered_image), 200, {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
      "ETag": `"v${row.version}"`,
    });
  }

  const schedule = JSON.parse(row.data) as Schedule;
  const output = row.output ? (JSON.parse(row.output) as OutputSettings) : null;

  const png = await renderScheduleToPng({
    schedule,
    output,
    logoBytes: row.logo ?? undefined,
  });

  // Store the rendered image for future requests.
  db.prepare("UPDATE schedules SET rendered_image = ? WHERE id = ?").run(
      png,
      id,
    );

  return c.body(new Uint8Array(png), 200, {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=3600",
    "ETag": `"v${row.version}"`,
  });
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
  const row = db
    .prepare("SELECT data FROM schedules WHERE id = ? AND user_id = ?")
    .get(id, userId(c)) as { data: string } | undefined;
  if (!row) return c.json({ error: "not found" }, 404);

  const schedule = JSON.parse(row.data) as Schedule;
  const slug = schedule.startgg?.slug?.trim();
  if (!slug) {
    return c.json({ error: "schedule has no start.gg tournament" }, 400);
  }

  const accessToken = await getStartggAccessToken(userId(c));
  if (!accessToken) return c.json({ error: "start.gg account not linked" }, 409);

  let entrants: FetchedParticipant[];
  try {
    entrants = await fetchTournamentParticipants(accessToken, slug);
  } catch (err) {
    if (err instanceof StartggApiError && err.forbidden) {
      return c.json({ error: "no access to this tournament" }, 403);
    }
    console.error("[startgg] participants query failed", err);
    return c.json({ error: "start.gg query failed" }, 502);
  }

  const now = Date.now();
  reconcileEntrants(db, id, entrants, now);
  return c.json({ entrants: readEntrants(db, id), syncedAt: now });
});

// Assign a role to a single entrant.
schedules.put("/schedules/:id/entrants/:pid/role", requireCsrf, async (c) => {
  const id = c.req.param("id");
  const pid = c.req.param("pid");
  const body = (await c.req.json().catch(() => ({}))) as { role?: string };
  const role = (body.role || "Competitor").toString().slice(0, 100);
  if (!setEntrantRole(db, id, pid, role)) {
    return c.json({ error: "entrant not found" }, 404);
  }
  return c.json({ ok: true });
});

// Bulk reassign all entrants of one role to another (used when deleting a role).
schedules.post("/schedules/:id/entrants/reassign-role", requireCsrf, async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    from?: string;
    to?: string;
  };
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
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name ?? "").toString().trim().slice(0, 200) || null;
  if (!setEntrantName(db, id, pid, name)) {
    return c.json({ error: "entrant not found" }, 404);
  }
  return c.json({ ok: true });
});

// Add a manual entrant (a player not registered on start.gg).
schedules.post("/schedules/:id/entrants", requireCsrf, async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    role?: string;
  };
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
