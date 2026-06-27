// Data model + helpers for the schedule.
//
// schedule = {
//   title: string,
//   days: [
//     {
//       id, name,
//       lanes: [
//         { id, name, color, blocks: [
//           { id, name, start, end, stream }
//         ] }
//       ]
//     }
//   ]
// }

const STORAGE_KEY = "sched.gg:v1";

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
export function uid(prefix = "id") {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function makeBlock(partial = {}) {
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

export function makeLane(index = 0, partial = {}) {
  return {
    id: uid("lane"),
    color: LANE_COLORS[index % LANE_COLORS.length],
    blocks: [],
    ...partial,
  };
}

export function makeDay(index = 0, partial = {}) {
  return {
    id: uid("day"),
    name: `Day ${index + 1}`,
    align: "left", // "left" | "right" — horizontal placement in the image
    banners: [], // full-width blocks spanning all lanes (e.g. "Doors open")
    lanes: [makeLane(0)],
    ...partial,
  };
}

export function defaultSchedule() {
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

// --- Time helpers -----------------------------------------------------------

// Parse "HH:MM" into minutes since midnight. Returns null when invalid.
export function parseTime(value) {
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
export function formatTime(minutes, { compact = false } = {}) {
  const total = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const meridiem = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (compact && m === 0) return `${h12} ${meridiem}`;
  return `${h12}:${String(m).padStart(2, "0")} ${meridiem}`;
}

// Compute [min, max] minute range covering every block in a day (lanes + banners).
export function dayTimeRange(day) {
  let min = Infinity;
  let max = -Infinity;
  const consider = (block) => {
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
  // Pad to whole hours for tidy gridlines.
  min = Math.floor(min / 60) * 60;
  max = Math.ceil(max / 60) * 60;
  if (max - min < 60) max = min + 60;
  return { min, max };
}

// --- Persistence ------------------------------------------------------------

export function loadSchedule() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSchedule();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.days) || parsed.days.length === 0) {
      return defaultSchedule();
    }
    return parsed;
  } catch {
    return defaultSchedule();
  }
}

export function saveSchedule(schedule) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule));
  } catch {
    // Ignore quota / unavailable storage.
  }
}

// --- Output settings: aspect ratio + resolution (persisted separately) ---

const OUTPUT_KEY = "sched.gg:output:v1";
const DEFAULT_OUTPUT = { mode: "fit", w: 16, h: 9, scale: 2 };

export function loadOutputSettings() {
  try {
    const raw = localStorage.getItem(OUTPUT_KEY);
    if (!raw) return { ...DEFAULT_OUTPUT };
    return { ...DEFAULT_OUTPUT, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_OUTPUT };
  }
}

export function saveOutputSettings(settings) {
  try {
    localStorage.setItem(OUTPUT_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota / unavailable storage.
  }
}
