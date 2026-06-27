// Data model + persistence for the frontend.
import {
  uid,
  parseTime,
  formatTime,
  dayTimeRange,
  LANE_COLORS,
} from "../../shared/model.js";
import type {
  Block,
  Day,
  Lane,
  OutputSettings,
  Schedule,
} from "../../shared/types.js";

export { uid, parseTime, formatTime, dayTimeRange, LANE_COLORS };

const STORAGE_KEY = "sched.gg:v1";

export function makeBlock(partial: Partial<Block> = {}): Block {
  return {
    id: uid("block"),
    name: "New match",
    start: "12:00",
    end: "13:00",
    stream: "",
    stream2: "",
    ...partial,
  };
}

export function makeLane(index = 0, partial: Partial<Lane> = {}): Lane {
  return {
    id: uid("lane"),
    color: LANE_COLORS[index % LANE_COLORS.length],
    blocks: [],
    ...partial,
  };
}

export function makeDay(index = 0, partial: Partial<Day> = {}): Day {
  return {
    id: uid("day"),
    name: `Day ${index + 1}`,
    align: "left",
    dayWidth: "auto",
    banners: [],
    lanes: [makeLane(0)],
    ...partial,
  };
}

export function defaultSchedule(): Schedule {
  const day = makeDay(0, { name: "Saturday" });
  day.banners = [
    makeBlock({ name: "Doors open", start: "10:00", end: "11:00" }),
  ];
  day.lanes = [
    makeLane(0, {
      blocks: [
        makeBlock({
          name: "Pools — Round 1",
          start: "11:00",
          end: "13:30",
          stream: "Stream A",
        }),
        makeBlock({
          name: "Top 8",
          start: "18:00",
          end: "20:00",
          stream: "Main",
        }),
      ],
    }),
    makeLane(1, {
      blocks: [
        makeBlock({ name: "Doubles pools", start: "11:00", end: "14:00" }),
        makeBlock({
          name: "Doubles Top 6",
          start: "15:00",
          end: "17:00",
          stream: "Stream B",
        }),
      ],
    }),
  ];
  return { title: "My Tournament", days: [day] };
}

// --- Persistence ------------------------------------------------------------

export function loadSchedule(): Schedule {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSchedule();
    const parsed = JSON.parse(raw) as Schedule;
    if (!parsed || !Array.isArray(parsed.days) || parsed.days.length === 0) {
      return defaultSchedule();
    }
    return normalizeSchedule(parsed);
  } catch {
    return defaultSchedule();
  }
}

export function normalizeSchedule(s: Schedule): Schedule {
  for (const day of s.days) {
    if (day.dayWidth == null) day.dayWidth = "auto";
  }
  return s;
}

export function saveSchedule(schedule: Schedule): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule));
  } catch {
    // Ignore quota / unavailable storage.
  }
}

// --- Output settings --------------------------------------------------------

const OUTPUT_KEY = "sched.gg:output:v1";
const DEFAULT_OUTPUT: OutputSettings = { mode: "fit", w: 16, h: 9, scale: 2 };

export function loadOutputSettings(): OutputSettings {
  try {
    const raw = localStorage.getItem(OUTPUT_KEY);
    if (!raw) return { ...DEFAULT_OUTPUT };
    return {
      ...DEFAULT_OUTPUT,
      ...(JSON.parse(raw) as Partial<OutputSettings>),
    };
  } catch {
    return { ...DEFAULT_OUTPUT };
  }
}

export function saveOutputSettings(settings: OutputSettings): void {
  try {
    localStorage.setItem(OUTPUT_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota / unavailable storage.
  }
}
