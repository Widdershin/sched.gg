import { Hono, type Context } from "hono";
import { db } from "../db.js";
import { uuid, token } from "../util/ids.js";
import { type AppEnv, requireAuth } from "../auth/session.js";
import { requireCsrf } from "../auth/csrf.js";
import { renderScheduleToPng } from "../render.js";
import type { Schedule, OutputSettings } from "../../../shared/types.js";

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

// Logo upload — raw PNG bytes, max 1 MB.
schedules.put("/schedules/:id/logo", requireCsrf, async (c) => {
  const id = c.req.param("id");
  const owned = db
    .prepare("SELECT id FROM schedules WHERE id = ? AND user_id = ?")
    .get(id, userId(c));
  if (!owned) return c.json({ error: "not found" }, 404);

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
  const owned = db
    .prepare("SELECT id FROM schedules WHERE id = ? AND user_id = ?")
    .get(id, userId(c));
  if (!owned) return c.json({ error: "not found" }, 404);

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

export default schedules;
