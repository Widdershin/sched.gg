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
export let db: DatabaseSync = createAndMigrate(env.dbPath);

/** Swap the DB instance for testing. Does NOT run migrations — caller must do that. */
export function setTestDb(testDb: DatabaseSync): void {
  db = testDb;
}

export type DB = DatabaseSync;
