// Domain types shared between frontend and backend.

export interface Block {
  id: string;
  name: string;
  start: string; // "HH:MM" (24h)
  end: string; // "HH:MM" (24h)
  stream: string;
  stream2: string;
  eventId?: string; // linked start.gg event id (for per-entrant highlighting)
}

export interface Lane {
  id: string;
  color: string;
  blocks: Block[];
}

export type DayAlign = "left" | "right";

export type DayWidth = "auto" | number;

export interface Day {
  id: string;
  name: string;
  align: DayAlign;
  dayWidth: DayWidth;
  banners: Block[];
  lanes: Lane[];
}

export interface Logo {
  src: string; // PNG data URL (frontend) or blob URL
  size: number; // % of canvas width
  x: number; // 0-100 % of free space
  y: number; // 0-100 % of free space
}

// A start.gg event the schedule's blocks can be linked to.
export interface StartggEvent {
  id: string;
  name: string;
}

// The start.gg tournament a schedule is bound to, plus its event list (cached
// for the per-block event dropdowns in the editor).
export interface StartggBinding {
  slug: string;
  events: StartggEvent[];
}

export interface Schedule {
  title: string;
  days: Day[];
  logo?: Logo | null;
  startgg?: StartggBinding | null;
}

// A tournament entrant (start.gg participant) and the events they're in.
// Persisted server-side per schedule; drives the lanyards page.
export interface Entrant {
  id: string; // start.gg participant id
  gamerTag: string;
  eventIds: string[];
}

export type AspectMode =
  | "fit"
  | "16:9"
  | "4:3"
  | "3:2"
  | "1:1"
  | "4:5"
  | "9:16"
  | "custom";

export interface OutputSettings {
  mode: AspectMode | string;
  w: number;
  h: number;
  scale: number;
}
