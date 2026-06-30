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

// --- Lanyard designer --------------------------------------------------------

export type LanyardElementType =
  | "image"
  | "backgroundImage"
  | "text"
  | "tag"
  | "schedule"
  | "shape"
  | "roleImage";

// A placeable element on one side of a lanyard. Positions/sizes are fractions of
// the side (0..1) so they're resolution-independent. `tag` and `schedule` are
// dynamic — filled per entrant at render time; the rest are shared across cards.
export interface LanyardElement {
  id: string;
  type: LanyardElementType;
  x: number; // top-left, fraction of side width
  y: number; // top-left, fraction of side height
  w: number; // width, fraction of side width
  h?: number; // shapes only: height, fraction of side height (others derive)
  // When true, the element is drawn on both sides with identical settings. It is
  // stored on (and edited from) its home side; the other side renders a copy.
  shared?: boolean;
  // image / backgroundImage ("backgroundImage" ignores x/y/w and covers the side)
  src?: string; // downscaled image data URL
  opacity?: number; // 0-100, default 100
  blur?: number; // 0-100 (relative to card height), default 0
  darken?: number; // 0-100 (% black overlay), default 0
  // text / tag
  text?: string; // static content (type "text")
  fontFrac?: number; // font size, fraction of side height
  color?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  // shape
  shape?: "rect" | "line";
  fill?: string;
}

export interface LanyardSide {
  background: string; // hex color
  elements: LanyardElement[]; // array order = z-order (last drawn on top)
}

// How the schedule embedded on a lanyard card draws its background. "image" uses
// the schedule's custom background image, "color" a solid color, "transparent"
// nothing (so the lanyard card's own background/elements show through).
export type LanyardScheduleBg = "image" | "color" | "transparent";

export interface LanyardDesign {
  widthMm: number;
  heightMm: number;
  dpi: number;
  front: LanyardSide;
  back: LanyardSide;
  // role name → downscaled image data URL, shared across all roleImage elements.
  roleImages?: Record<string, string>;
  // Background mode for the embedded schedule (one choice for all cards).
  // Defaults to a solid theme-colored background, preserving the prior look.
  scheduleBg?: LanyardScheduleBg;
  scheduleBgColor?: string; // used when scheduleBg === "color"
}

// A custom background image drawn behind the schedule grid. Mirrors the logo:
// `src` (a data/blob URL) is frontend-only; the bytes are stored server-side in a
// dedicated BLOB column and loaded for server renders.
export interface ScheduleBackground {
  src?: string; // data URL (frontend) or blob URL
  fit?: "cover" | "contain"; // default "cover"
  opacity?: number; // 0-100, default 100
  blur?: number; // px, default 0
  darken?: number; // 0-100 (% black overlay), default 0
}

export interface Schedule {
  title: string;
  days: Day[];
  logo?: Logo | null;
  background?: ScheduleBackground | null;
  startgg?: StartggBinding | null;
  lanyard?: LanyardDesign | null;
  roles?: string[]; // player role types (defaults to ["Competitor"])
}

// A tournament entrant (start.gg participant) and the events they're in.
// Persisted server-side per schedule; drives the lanyards page.
export interface Entrant {
  id: string; // start.gg participant id, or "manual-<uuid>" for manual entrants
  gamerTag: string;
  eventIds: string[];
  role: string; // assigned role (defaults to "Competitor")
  name?: string; // custom display-name override
  source: "startgg" | "manual";
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
  visuals?: VisualSettings | null;
}

export interface VisualSettings {
  mode: "default" | "custom";
  // Colors
  bg?: string;
  grid?: string;
  text?: string;
  muted?: string;
  title?: string;
  bannerColor?: string;
  laneBgAlpha?: number;
  blockFillAlpha?: number;
  blockStrokeAlpha?: number;
  // Layout
  pad?: number;
  laneH?: number;
  laneGap?: number;
  dayGap?: number;
  pxPerMin?: number;
  blockRadius?: number;
  blockBorderWidth?: number;
  gridLineWidth?: number;
  // Typography
  font?: string;
  blockNameSize?: number;
  blockTimeSize?: number;
  dayNameSize?: number;
  timeLabelSize?: number;
}
