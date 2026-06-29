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
  reassignRole,
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

test("reassignRole: bulk reassigns roles", () => {
  const db = freshDb();
  reconcileEntrants(
    db,
    "s1",
    [p("A", "Alice", ["1"]), p("B", "Bob", ["2"]), p("C", "Carol", ["3"])],
    1000,
  );
  // Initially all are "Competitor"
  const before = readEntrants(db, "s1");
  assert.ok(before.every((x) => x.role === "Competitor"));

  // Reassign all Competitors to "Staff"
  reassignRole(db, "s1", "Competitor", "Staff");

  const after = readEntrants(db, "s1");
  assert.equal(after.length, 3);
  assert.ok(after.every((x) => x.role === "Staff"));
});

test("reassignRole: only affects specified role", () => {
  const db = freshDb();
  reconcileEntrants(db, "s1", [p("A", "Alice"), p("B", "Bob")], 1000);
  setEntrantRole(db, "s1", "A", "Commentator");
  // A=Commentator, B=Competitor

  reassignRole(db, "s1", "Competitor", "Staff");

  const e = readEntrants(db, "s1");
  const byId = Object.fromEntries(e.map((x) => [x.id, x.role]));
  assert.equal(byId["A"], "Commentator"); // unchanged
  assert.equal(byId["B"], "Staff"); // reassigned
});

test("reassignRole: no-op when no entrants match", () => {
  const db = freshDb();
  reconcileEntrants(db, "s1", [p("A", "Alice")], 1000);
  const before = readEntrants(db, "s1");

  reassignRole(db, "s1", "NonexistentRole", "X");

  const after = readEntrants(db, "s1");
  assert.deepEqual(
    before.map((x) => [x.id, x.role]),
    after.map((x) => [x.id, x.role]),
  );
});

test("reassignRole: scoped to schedule_id", () => {
  const db = freshDb();
  // Create a second schedule
  db.prepare(
    "INSERT INTO schedules (id, user_id, name, data, created_at, updated_at, version) VALUES ('s2', 'u1', 't2', '{}', 0, 0, 1)",
  ).run();
  reconcileEntrants(db, "s1", [p("A", "Alice")], 1000);
  reconcileEntrants(db, "s2", [p("B", "Bob")], 1000);

  reassignRole(db, "s1", "Competitor", "Staff");

  // s1 entrant changed, s2 unchanged
  const e1 = readEntrants(db, "s1");
  const e2 = readEntrants(db, "s2");
  assert.deepEqual(e1.map((x) => x.role), ["Staff"]);
  assert.deepEqual(e2.map((x) => x.role), ["Competitor"]);
});
