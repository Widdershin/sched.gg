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
    name: `Lane ${index + 1}`,
    color: LANE_COLORS[index % LANE_COLORS.length],
    blocks: [],
    ...partial,
  };
}

export function makeDay(index = 0, partial = {}) {
  return {
    id: uid("day"),
    name: `Day ${index + 1}`,
    lanes: [makeLane(0)],
    ...partial,
  };
}

export function defaultSchedule() {
  const day = makeDay(0, { name: "Saturday" });
  day.lanes = [
    makeLane(0, {
      name: "Main Stage",
      blocks: [
        makeBlock({ name: "Doors open", start: "10:00", end: "11:00" }),
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
      name: "Side Bracket",
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

export function formatTime(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Compute [min, max] minute range covering every block in a day.
export function dayTimeRange(day) {
  let min = Infinity;
  let max = -Infinity;
  for (const lane of day.lanes) {
    for (const block of lane.blocks) {
      const start = parseTime(block.start);
      const end = parseTime(block.end);
      if (start != null) min = Math.min(min, start);
      if (end != null) max = Math.max(max, end);
      if (start != null) max = Math.max(max, start);
      if (end != null) min = Math.min(min, end);
    }
  }
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
