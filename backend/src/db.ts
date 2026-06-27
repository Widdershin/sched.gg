import { DatabaseSync } from "node:sqlite";
import { env } from "./env.js";
import { migrate } from "./migrations.js";

// Single shared SQLite connection (synchronous API; fine for a single process).
export const db = new DatabaseSync(env.dbPath);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

migrate(db);

export type DB = DatabaseSync;
