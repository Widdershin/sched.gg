// Pure SQLite data access for tournament entrants. Takes the DB as a parameter
// (no Hono/env/canvas imports) so it can be unit-tested against an in-memory DB.
import type { DatabaseSync } from "node:sqlite";
import { uuid } from "./util/ids.js";
import type { Entrant } from "../../shared/types.js";

const DEFAULT_ROLE = "Competitor";
const COLS = "participant_id, gamer_tag, event_ids, role, custom_name, source";

// A start.gg participant (no role/name/source — those are assigned locally).
export interface ParticipantInput {
  id: string;
  gamerTag: string;
  eventIds: string[];
}

interface EntrantRow {
  participant_id: string;
  gamer_tag: string | null;
  event_ids: string;
  role: string | null;
  custom_name: string | null;
  source: string | null;
}

export function rowToEntrant(r: EntrantRow): Entrant {
  return {
    id: r.participant_id,
    gamerTag: r.gamer_tag ?? "",
    eventIds: JSON.parse(r.event_ids) as string[],
    role: r.role ?? DEFAULT_ROLE,
    name: r.custom_name ?? undefined,
    source: r.source === "manual" ? "manual" : "startgg",
  };
}

export function readEntrants(db: DatabaseSync, scheduleId: string): Entrant[] {
  const rows = db
    .prepare(
      `SELECT ${COLS} FROM schedule_entrants
        WHERE schedule_id = ?
        ORDER BY COALESCE(NULLIF(custom_name, ''), gamer_tag) COLLATE NOCASE`,
    )
    .all(scheduleId) as unknown as EntrantRow[];
  return rows.map(rowToEntrant);
}

// Upsert fetched participants (existing rows keep their role/custom_name/source;
// only tag/events/updated_at refresh), prune dropped start.gg entrants, and stamp
// the schedule's sync time — all in one transaction. Idempotent, so a re-fetch
// never collides on (schedule_id, participant_id), and manual entrants survive.
export function reconcileEntrants(
  db: DatabaseSync,
  scheduleId: string,
  participants: ParticipantInput[],
  now: number,
): void {
  db.exec("BEGIN");
  try {
    const upsert = db.prepare(
      `INSERT INTO schedule_entrants
         (id, schedule_id, participant_id, gamer_tag, event_ids, role, source, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Competitor', 'startgg', ?)
       ON CONFLICT (schedule_id, participant_id) DO UPDATE SET
         gamer_tag = excluded.gamer_tag,
         event_ids = excluded.event_ids,
         updated_at = excluded.updated_at`,
    );
    for (const e of participants) {
      upsert.run(
        uuid(),
        scheduleId,
        e.id,
        e.gamerTag,
        JSON.stringify(e.eventIds),
        now,
      );
    }
    db.prepare(
      "DELETE FROM schedule_entrants WHERE schedule_id = ? AND updated_at < ? AND source = 'startgg'",
    ).run(scheduleId, now);
    db.prepare(
      "UPDATE schedules SET entrants_synced_at = ? WHERE id = ?",
    ).run(now, scheduleId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function addManualEntrant(
  db: DatabaseSync,
  scheduleId: string,
  name: string,
  role: string = DEFAULT_ROLE,
): Entrant {
  const pid = `manual-${uuid()}`;
  db.prepare(
    `INSERT INTO schedule_entrants
       (id, schedule_id, participant_id, gamer_tag, event_ids, role, source, updated_at)
     VALUES (?, ?, ?, ?, '[]', ?, 'manual', ?)`,
  ).run(uuid(), scheduleId, pid, name, role, Date.now());
  const row = db
    .prepare(
      `SELECT ${COLS} FROM schedule_entrants WHERE schedule_id = ? AND participant_id = ?`,
    )
    .get(scheduleId, pid) as unknown as EntrantRow;
  return rowToEntrant(row);
}

export function setEntrantRole(
  db: DatabaseSync,
  scheduleId: string,
  pid: string,
  role: string,
): boolean {
  const res = db
    .prepare(
      "UPDATE schedule_entrants SET role = ?, updated_at = ? WHERE schedule_id = ? AND participant_id = ?",
    )
    .run(role, Date.now(), scheduleId, pid);
  return Number(res.changes) > 0;
}

export function setEntrantName(
  db: DatabaseSync,
  scheduleId: string,
  pid: string,
  name: string | null,
): boolean {
  const res = db
    .prepare(
      "UPDATE schedule_entrants SET custom_name = ?, updated_at = ? WHERE schedule_id = ? AND participant_id = ?",
    )
    .run(name, Date.now(), scheduleId, pid);
  return Number(res.changes) > 0;
}

export function deleteManualEntrant(
  db: DatabaseSync,
  scheduleId: string,
  pid: string,
): boolean {
  const res = db
    .prepare(
      "DELETE FROM schedule_entrants WHERE schedule_id = ? AND participant_id = ? AND source = 'manual'",
    )
    .run(scheduleId, pid);
  return Number(res.changes) > 0;
}

export function reassignRole(
  db: DatabaseSync,
  scheduleId: string,
  from: string,
  to: string,
): void {
  db.prepare(
    "UPDATE schedule_entrants SET role = ?, updated_at = ? WHERE schedule_id = ? AND role = ?",
  ).run(to, Date.now(), scheduleId, from);
}
