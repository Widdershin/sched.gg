import { DatabaseSync } from "node:sqlite";
import { env } from "./env.js";
import { migrate } from "./migrations.js";

function createAndMigrate(path: string): DatabaseSync {
  const d = new DatabaseSync(path);
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec("PRAGMA foreign_keys = ON;");
  d.exec("PRAGMA busy_timeout = 5000;");
  migrate(d);
  return d;
}

// Mutable export — tests can swap in an in-memory DB via setTestDb().
// In test mode, we skip opening the real DB file entirely.
export let db: DatabaseSync;
if (!process.env.SCHEDGG_TEST) {
  db = createAndMigrate(env.dbPath);
} else {
  db = new DatabaseSync(":memory:");
}

/** Swap the DB instance for testing. */
export function setTestDb(testDb: DatabaseSync): void {
  db = testDb;
}

export type DB = DatabaseSync;
