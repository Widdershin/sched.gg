import { Hono, type Context } from "hono";
import { db } from "../db.js";
import { uuid, token } from "../util/ids.js";
import { type AppEnv, requireAuth } from "../auth/session.js";
import { requireCsrf } from "../auth/csrf.js";

const schedules = new Hono<AppEnv>();

// All schedule routes require a signed-in user.
schedules.use("/schedules", requireAuth);
schedules.use("/schedules/*", requireAuth);

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
  const owned = db
    .prepare("SELECT id FROM schedules WHERE id = ? AND user_id = ?")
    .get(id, userId(c));
  if (!owned) return c.json({ error: "not found" }, 404);

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
  const owned = db
    .prepare("SELECT id FROM schedules WHERE id = ? AND user_id = ?")
    .get(id, userId(c));
  if (!owned) return c.json({ error: "not found" }, 404);
  const t = token(18);
  db.prepare(
    `INSERT INTO share_tokens (token, schedule_id, created_at, expires_at, revoked)
     VALUES (?, ?, ?, NULL, 0)`,
  ).run(t, id, Date.now());
  return c.json({ token: t, url: `/?share=${t}` });
});

export default schedules;
