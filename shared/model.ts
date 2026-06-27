// Data model helpers shared between frontend and backend.
import type { Block, Day } from "./types.js";

// A palette used to colour-code lanes by default.
export const LANE_COLORS = [
  "#e23c5b", // red
  "#3c8ce2", // blue
  "#36b37e", // green
  "#f5a623", // amber
  "#9b5cf6", // purple
  "#16c2c2", // teal
];

let counter = 0;
export function uid(prefix = "id"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

// --- Time helpers -----------------------------------------------------------

// Parse "HH:MM" into minutes since midnight. Returns null when invalid.
export function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

// Format minutes-since-midnight as a 12-hour time. `compact` drops the minutes
// on the hour (e.g. "10 AM" rather than "10:00 AM").
export function formatTime(
  minutes: number,
  { compact = false }: { compact?: boolean } = {},
): string {
  const total = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const meridiem = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (compact && m === 0) return `${h12} ${meridiem}`;
  return `${h12}:${String(m).padStart(2, "0")} ${meridiem}`;
}

// Compute [min, max] minute range covering every block in a day (lanes + banners).
export function dayTimeRange(day: Day): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  const consider = (block: Block) => {
    const start = parseTime(block.start);
    const end = parseTime(block.end);
    if (start != null) {
      min = Math.min(min, start);
      max = Math.max(max, start);
    }
    if (end != null) {
      min = Math.min(min, end);
      max = Math.max(max, end);
    }
  };
  for (const lane of day.lanes) for (const block of lane.blocks) consider(block);
  for (const block of day.banners ?? []) consider(block);
  if (min === Infinity || max === -Infinity) {
    return { min: 10 * 60, max: 20 * 60 };
  }
  // Snap the day bounds to the nearest half hour.
  min = Math.floor(min / 30) * 30;
  max = Math.ceil(max / 30) * 30;
  if (max - min < 30) max = min + 30;
  return { min, max };
}
