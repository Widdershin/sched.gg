import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, migrateExistingLogos } from "../src/migrations.js";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

// ---------------------------------------------------------------------------
// Schema correctness
// ---------------------------------------------------------------------------

test("migrations: all expected tables exist", () => {
  const db = freshDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  const names = tables.map((r) => r.name);
  assert.ok(names.includes("users"));
  assert.ok(names.includes("auth_identities"));
  assert.ok(names.includes("sessions"));
  assert.ok(names.includes("oauth_states"));
  assert.ok(names.includes("schedules"));
  assert.ok(names.includes("share_tokens"));
  assert.ok(names.includes("schema_migrations"));
});

test("migrations: schedules has all expected columns", () => {
  const db = freshDb();
  const cols = db
    .prepare("PRAGMA table_info('schedules')")
    .all() as { name: string }[];
  const colNames = cols.map((c) => c.name);
  ["id", "user_id", "name", "data", "output", "logo", "version", "rendered_image", "created_at", "updated_at"].forEach(
    (col) => assert.ok(colNames.includes(col), `missing column: ${col}`),
  );
});

test("migrations: foreign key enforcement works", () => {
  const db = freshDb();
  assert.throws(() => {
    db.prepare(
      "INSERT INTO schedules (id, user_id, name, data, created_at, updated_at, version) VALUES ('x', 'nonexistent', 't', '{}', 0, 0, 1)",
    ).run();
  });
});

test("migrations: UNIQUE username constraint", () => {
  const db = freshDb();
  const now = Date.now();
  db.prepare("INSERT INTO users (id, username, created_at, updated_at) VALUES ('u1', 'alice', ?, ?)").run(now, now);
  assert.throws(() => {
    db.prepare("INSERT INTO users (id, username, created_at, updated_at) VALUES ('u2', 'alice', ?, ?)").run(now, now);
  });
});

test("migrations: UNIQUE (provider, provider_account_id)", () => {
  const db = freshDb();
  const now = Date.now();
  db.prepare("INSERT INTO users (id, created_at, updated_at) VALUES ('u1', ?, ?)").run(now, now);
  db.prepare(
    "INSERT INTO auth_identities (id, user_id, provider, provider_account_id, created_at, updated_at) VALUES ('a1', 'u1', 'password', 'alice', ?, ?)",
  ).run(now, now);
  assert.throws(() => {
    db.prepare(
      "INSERT INTO auth_identities (id, user_id, provider, provider_account_id, created_at, updated_at) VALUES ('a2', 'u1', 'password', 'alice', ?, ?)",
    ).run(now, now);
  });
});

test("migrations: ON DELETE CASCADE — deleting user removes identities", () => {
  const db = freshDb();
  const now = Date.now();
  db.prepare("INSERT INTO users (id, created_at, updated_at) VALUES ('u1', ?, ?)").run(now, now);
  db.prepare(
    "INSERT INTO auth_identities (id, user_id, provider, provider_account_id, created_at, updated_at) VALUES ('a1', 'u1', 'password', 'alice', ?, ?)",
  ).run(now, now);
  db.prepare("DELETE FROM users WHERE id = 'u1'").run();
  const rows = db.prepare("SELECT id FROM auth_identities WHERE user_id = 'u1'").all();
  assert.equal(rows.length, 0);
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test("migrations: running migrate twice does not error", () => {
  const db = freshDb();
  assert.doesNotThrow(() => migrate(db));
});

test("migrations: schema_migrations tracks applied versions", () => {
  const db = freshDb();
  const versions = db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as { version: number }[];
  assert.ok(versions.length >= 1);
  for (let i = 0; i < versions.length; i++) {
    assert.equal(versions[i].version, i + 1);
  }
});

// ---------------------------------------------------------------------------
// v2 data migration: migrateExistingLogos
// ---------------------------------------------------------------------------

function insertSchedule(db: DatabaseSync, data: unknown) {
  const now = Date.now();
  db.prepare(
    "INSERT INTO users (id, created_at, updated_at) VALUES ('u1', ?, ?)",
  ).run(now, now);
  db.prepare(
    "INSERT INTO schedules (id, user_id, name, data, created_at, updated_at, version) VALUES ('s1', 'u1', 't', ?, ?, ?, 1)",
  ).run(JSON.stringify(data), now, now);
}

test("migrateExistingLogos: extracts logo data URL to BLOB, deletes src", () => {
  const db = freshDb();
  const payload = Buffer.from("fake-png-data").toString("base64");
  const dataUrl = `data:image/png;base64,${payload}`;
  insertSchedule(db, {
    title: "Test",
    days: [],
    logo: { src: dataUrl, size: 18, x: 2, y: 2 },
  });

  migrateExistingLogos(db);

  const logo = db
    .prepare("SELECT logo FROM schedules WHERE id = 's1'")
    .get() as { logo: Buffer | null };
  assert.ok(logo?.logo instanceof Uint8Array);
  assert.deepEqual(Buffer.from(logo.logo), Buffer.from(payload, "base64"));

  const row = db
    .prepare("SELECT data FROM schedules WHERE id = 's1'")
    .get() as { data: string };
  const parsed = JSON.parse(row.data);
  assert.equal(parsed.logo.src, undefined);
  assert.equal(parsed.logo.size, 18);
});

test("migrateExistingLogos: schedule without logo is untouched", () => {
  const db = freshDb();
  insertSchedule(db, { title: "No Logo", days: [] });

  migrateExistingLogos(db);

  const logo = db
    .prepare("SELECT logo FROM schedules WHERE id = 's1'")
    .get() as { logo: Buffer | null };
  assert.equal(logo?.logo, null);
  const row = db
    .prepare("SELECT data FROM schedules WHERE id = 's1'")
    .get() as { data: string };
  assert.deepEqual(JSON.parse(row.data), { title: "No Logo", days: [] });
});

test("migrateExistingLogos: non-base64 logo src is skipped", () => {
  const db = freshDb();
  insertSchedule(db, {
    title: "Bad",
    days: [],
    logo: { src: "not-a-data-url", size: 10, x: 0, y: 0 },
  });

  migrateExistingLogos(db);

  const logo = db
    .prepare("SELECT logo FROM schedules WHERE id = 's1'")
    .get() as { logo: Buffer | null };
  assert.equal(logo?.logo, null);

  const row = db
    .prepare("SELECT data FROM schedules WHERE id = 's1'")
    .get() as { data: string };
  assert.equal(JSON.parse(row.data).logo.src, "not-a-data-url");
});
