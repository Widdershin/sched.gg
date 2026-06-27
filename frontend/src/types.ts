// Shared domain + API types for the frontend.

export interface Block {
  id: string;
  name: string;
  start: string; // "HH:MM" (24h)
  end: string; // "HH:MM" (24h)
  stream: string;
  stream2: string;
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
  src: string; // PNG data URL
  size: number; // % of canvas width
  x: number; // 0-100 % of free space
  y: number; // 0-100 % of free space
}

export interface Schedule {
  title: string;
  days: Day[];
  logo?: Logo | null;
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

// Mutate a draft schedule in place (used with App's structuredClone helper).
export type UpdateFn = (mutator: (schedule: Schedule) => void) => void;

// --- API shapes ------------------------------------------------------------

export interface User {
  id: string;
  username: string | null;
  displayName: string | null;
}

export interface ScheduleMeta {
  id: string;
  name: string;
  updated_at: number;
}

export interface FullSchedule {
  id: string;
  name: string;
  data: Schedule;
  output: OutputSettings | null;
  updated_at: number;
}

export interface SharedSchedule {
  name: string;
  data: Schedule;
  output: OutputSettings | null;
}

export interface HealthInfo {
  ok: boolean;
  devLogin: boolean;
  startgg: boolean;
}
