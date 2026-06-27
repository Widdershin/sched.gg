// CSV import/export for a schedule.
//
// One row per block, flattened with the day and lane it belongs to. A lane with
// no blocks emits a single placeholder row (empty block fields) so empty lanes
// survive a round-trip. Columns:
//   Tournament, Day, Lane, Color, Block, Start, End, Stream, Stream 2

import { makeDay, makeLane, makeBlock } from "./model";
import type { Block, Schedule } from "./types";

type BlockInput = Omit<Block, "id">;

const HEADER = [
  "Tournament",
  "Day",
  "Lane",
  "Color",
  "Block",
  "Start",
  "End",
  "Stream",
  "Stream 2",
];

// Quote a field if it contains a comma, quote or newline; escape quotes.
function escapeField(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function scheduleToCsv(schedule: Schedule): string {
  const rows: (string | number)[][] = [HEADER];
  for (const day of schedule.days) {
    // Full-width banner blocks use the special lane "Banner".
    for (const b of day.banners ?? []) {
      rows.push([
        schedule.title,
        day.name,
        "Banner",
        "",
        b.name,
        b.start,
        b.end,
        b.stream || "",
        b.stream2 || "",
      ]);
    }
    day.lanes.forEach((lane, i) => {
      const base = [schedule.title, day.name, i + 1, lane.color];
      if (lane.blocks.length === 0) {
        rows.push([...base, "", "", "", "", ""]);
      } else {
        for (const b of lane.blocks) {
          rows.push([
            ...base,
            b.name,
            b.start,
            b.end,
            b.stream || "",
            b.stream2 || "",
          ]);
        }
      }
    });
  }
  return rows.map((r) => r.map(escapeField).join(",")).join("\r\n");
}

// Parse CSV text into an array of string-arrays (RFC 4180-ish: quoted fields,
// doubled quotes, CRLF or LF line endings).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  // Flush a trailing field/row when the file doesn't end with a newline.
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

interface LaneAcc {
  color: string;
  blocks: BlockInput[];
}
interface DayAcc {
  laneOrder: string[];
  laneMap: Map<string, LaneAcc>;
  banners: BlockInput[];
}

export function csvToSchedule(text: string): Schedule {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) throw new Error("The file is empty.");

  // Skip the header row if present.
  const looksLikeHeader =
    (rows[0][0] || "").trim().toLowerCase() === "tournament";
  const dataRows = looksLikeHeader ? rows.slice(1) : rows;
  if (dataRows.length === 0) throw new Error("No data rows found in the file.");

  let title = "";
  const dayOrder: string[] = [];
  const dayMap = new Map<string, DayAcc>();

  for (const r of dataRows) {
    const tournament = (r[0] || "").trim();
    const dayName = (r[1] || "").trim() || "Day";
    const laneKey = (r[2] || "1").trim() || "1";
    const color = (r[3] || "").trim();
    const name = r[4] || "";
    const start = (r[5] || "").trim();
    const end = (r[6] || "").trim();
    const stream = r[7] || "";
    const stream2 = r[8] || "";

    if (!title && tournament) title = tournament;

    let day = dayMap.get(dayName);
    if (!day) {
      day = { laneOrder: [], laneMap: new Map(), banners: [] };
      dayMap.set(dayName, day);
      dayOrder.push(dayName);
    }

    const hasBlock = [name, start, end, stream, stream2].some(
      (v) => String(v).trim() !== "",
    );
    const block: BlockInput | null = hasBlock
      ? {
          name: name || "Untitled",
          start: start || "12:00",
          end: end || "13:00",
          stream,
          stream2,
        }
      : null;

    // Full-width banner rows live outside the lanes.
    if (laneKey.toLowerCase() === "banner") {
      if (block) day.banners.push(block);
      continue;
    }

    let lane = day.laneMap.get(laneKey);
    if (!lane) {
      lane = { color: "", blocks: [] };
      day.laneMap.set(laneKey, lane);
      day.laneOrder.push(laneKey);
    }
    if (color && !lane.color) lane.color = color;
    if (block) lane.blocks.push(block);
  }

  const days = dayOrder.map((dayName, di) => {
    const day = dayMap.get(dayName)!;
    const lanes = day.laneOrder.map((lk, li) => {
      const lane = day.laneMap.get(lk)!;
      return makeLane(li, {
        ...(lane.color ? { color: lane.color } : {}),
        blocks: lane.blocks.map((b) => makeBlock(b)),
      });
    });
    return makeDay(di, {
      name: dayName,
      banners: day.banners.map((b) => makeBlock(b)),
      lanes: lanes.length ? lanes : [makeLane(0)],
    });
  });

  return { title: title || "My Tournament", days };
}
