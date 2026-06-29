import type { DatabaseSync } from "node:sqlite";

interface Migration {
  version: number;
  sql: string;
  run?: (db: DatabaseSync) => void;
}

// Ordered, idempotent migrations. Each runs once, tracked in schema_migrations.
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id           TEXT PRIMARY KEY,
        username     TEXT UNIQUE,
        display_name TEXT,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );

      CREATE TABLE auth_identities (
        id                  TEXT PRIMARY KEY,
        user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider            TEXT NOT NULL,       -- 'password' | 'startgg'
        provider_account_id TEXT NOT NULL,
        secret              TEXT,                -- password: scrypt hash
        metadata            TEXT,                -- JSON
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL,
        UNIQUE (provider, provider_account_id)
      );
      CREATE INDEX idx_identities_user ON auth_identities(user_id);

      CREATE TABLE sessions (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL,
        revoked      INTEGER NOT NULL DEFAULT 0,
        user_agent   TEXT
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE oauth_states (
        state         TEXT PRIMARY KEY,
        code_verifier TEXT,
        redirect_to   TEXT,
        created_at    INTEGER NOT NULL,
        expires_at    INTEGER NOT NULL
      );

      CREATE TABLE schedules (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        data       TEXT NOT NULL,   -- JSON schedule (incl. embedded logo data URL)
        output     TEXT,            -- JSON output settings
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_schedules_user ON schedules(user_id);

      CREATE TABLE share_tokens (
        token       TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER,
        revoked     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_share_schedule ON share_tokens(schedule_id);
    `,
  },
  {
    version: 2,
    sql: `ALTER TABLE schedules ADD COLUMN logo BLOB;`,
    run: migrateExistingLogos,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE schedules ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      UPDATE schedules SET version = 1;
    `,
  },
  {
    version: 4,
    sql: `ALTER TABLE schedules ADD COLUMN rendered_image BLOB;`,
  },
  {
    version: 5,
    sql: `
      -- Persist the start.gg OAuth tokens so we can query the API later as the
      -- signed-in user (not just during the login callback).
      ALTER TABLE auth_identities ADD COLUMN access_token TEXT;
      ALTER TABLE auth_identities ADD COLUMN refresh_token TEXT;
      ALTER TABLE auth_identities ADD COLUMN token_expires_at INTEGER;

      -- When the schedule's entrants were last synced from start.gg.
      ALTER TABLE schedules ADD COLUMN entrants_synced_at INTEGER;

      -- Tournament entrants pulled from start.gg, persisted per schedule and
      -- used to generate per-entrant (lanyard) images.
      CREATE TABLE schedule_entrants (
        id             TEXT PRIMARY KEY,
        schedule_id    TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL,      -- start.gg participant id
        gamer_tag      TEXT,
        event_ids      TEXT NOT NULL,      -- JSON array of start.gg event ids
        updated_at     INTEGER NOT NULL,
        UNIQUE (schedule_id, participant_id)
      );
      CREATE INDEX idx_entrants_schedule ON schedule_entrants(schedule_id);
    `,
  },
  {
    version: 6,
    sql: `ALTER TABLE schedule_entrants ADD COLUMN role TEXT NOT NULL DEFAULT 'Competitor';`,
  },
];

function migrateExistingLogos(db: DatabaseSync): void {
  const rows = db
    .prepare("SELECT id, data FROM schedules WHERE data LIKE '%data:image/png;base64,%'")
    .all() as { id: string; data: string }[];
  for (const row of rows) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.data);
    } catch {
      continue;
    }
    const logo = parsed.logo as { src?: string; size?: number; x?: number; y?: number } | null | undefined;
    if (!logo?.src?.startsWith("data:image/png;base64,")) continue;
    const base64 = logo.src.slice("data:image/png;base64,".length);
    const buf = Buffer.from(base64, "base64");
    delete logo.src;
    db.prepare("UPDATE schedules SET data = ?, logo = ? WHERE id = ?").run(
      JSON.stringify(parsed),
      buf,
      row.id,
    );
  }
}

export function migrate(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       applied_at INTEGER NOT NULL
     );`,
  );
  const row = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")
    .get() as { v: number };
  const current = row.v;

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      if (m.run) m.run(db);
      db.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(m.version, Date.now());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
