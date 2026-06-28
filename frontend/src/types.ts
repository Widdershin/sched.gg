// Re-export shared domain types, add frontend-specific API shapes.
import type {
  Block,
  Lane,
  DayAlign,
  DayWidth,
  Day,
  Logo,
  Schedule,
  AspectMode,
  OutputSettings,
  StartggEvent,
  StartggBinding,
  Entrant,
  LanyardElementType,
  LanyardElement,
  LanyardSide,
  LanyardDesign,
} from "../../shared/types.js";

export type {
  Block,
  Lane,
  DayAlign,
  DayWidth,
  Day,
  Logo,
  Schedule,
  AspectMode,
  OutputSettings,
  StartggEvent,
  StartggBinding,
  Entrant,
  LanyardElementType,
  LanyardElement,
  LanyardSide,
  LanyardDesign,
};

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
