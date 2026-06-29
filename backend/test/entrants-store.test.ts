import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../src/migrations.js";
import {
  readEntrants,
  reconcileEntrants,
  addManualEntrant,
  setEntrantRole,
  setEntrantName,
  deleteManualEntrant,
} from "../src/entrants-store.js";

// In-memory DB with the full schema + one schedule row (FK off by default in
// :memory:, so no users row needed). entrants_synced_at updates land on it.
function freshDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  db.prepare(
    `INSERT INTO users (id, created_at, updated_at) VALUES ('u1', 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO schedules (id, user_id, name, data, created_at, updated_at, version)
     VALUES ('s1', 'u1', 't', '{}', 0, 0, 1)`,
  ).run();
  return db;
}

const p = (id: string, gamerTag: string, eventIds: string[] = []) => ({
  id,
  gamerTag,
  eventIds,
});

test("reconcile inserts, dedupes, defaults role + source", () => {
  const db = freshDb();
  reconcileEntrants(
    db,
    "s1",
    [p("A", "Alice", ["1"]), p("B", "Bob"), p("A", "Alice", ["2"])],
    1000,
  );
  const e = readEntrants(db, "s1");
  assert.equal(e.length, 2);
  assert.deepEqual(
    e.map((x) => x.id).sort(),
    ["A", "B"],
  );
  assert.ok(e.every((x) => x.role === "Competitor" && x.source === "startgg"));
});

test("re-sync preserves role/name + manual entrant, prunes dropped", () => {
  const db = freshDb();
  // Sync timestamps must be monotonic with the real Date.now() used by the
  // single-entrant mutations (that's the production invariant).
  const t1 = Date.now();
  reconcileEntrants(db, "s1", [p("A", "Alice"), p("B", "Bob")], t1);
  assert.ok(setEntrantRole(db, "s1", "B", "Staff"));
  assert.ok(setEntrantName(db, "s1", "A", "Alice (TO)"));
  const manual = addManualEntrant(db, "s1", "Guest", "Commentator");
  assert.equal(manual.source, "manual");

  // Re-fetch with B dropped and A's tag changed.
  const t2 = Date.now() + 1000;
  reconcileEntrants(db, "s1", [p("A", "Alice2")], t2);

  const byId = Object.fromEntries(readEntrants(db, "s1").map((x) => [x.id, x]));
  assert.equal(byId["B"], undefined); // pruned
  assert.equal(byId["A"].name, "Alice (TO)"); // custom name preserved
  assert.equal(byId["A"].gamerTag, "Alice2"); // tag refreshed
  assert.equal(byId[manual.id].role, "Commentator"); // manual survived w/ role

  const row = db
    .prepare("SELECT entrants_synced_at AS s FROM schedules WHERE id = 's1'")
    .get() as { s: number };
  assert.equal(row.s, t2);
});

test("deleteManualEntrant only removes manual entrants", () => {
  const db = freshDb();
  reconcileEntrants(db, "s1", [p("A", "Alice")], 1000);
  const manual = addManualEntrant(db, "s1", "Guest");
  assert.equal(deleteManualEntrant(db, "s1", "A"), false); // start.gg: not deletable
  assert.equal(deleteManualEntrant(db, "s1", manual.id), true);
  assert.equal(readEntrants(db, "s1").length, 1);
});

test("role/name updates return false for unknown entrants", () => {
  const db = freshDb();
  assert.equal(setEntrantRole(db, "s1", "nope", "X"), false);
  assert.equal(setEntrantName(db, "s1", "nope", "X"), false);
});

test("readEntrants orders by display name (custom name overrides tag)", () => {
  const db = freshDb();
  reconcileEntrants(db, "s1", [p("A", "Zed"), p("B", "Amy")], 1000);
  setEntrantName(db, "s1", "A", "Aaron"); // Zed -> Aaron sorts first
  assert.deepEqual(
    readEntrants(db, "s1").map((x) => x.id),
    ["A", "B"],
  );
});
