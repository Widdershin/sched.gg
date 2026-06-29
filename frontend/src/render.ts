import {
  THEME,
  LAYOUT,
  measureSchedule,
  renderScheduleToContext,
} from "../../shared/render.js";
import type { Schedule } from "../../shared/types.js";
import type { Measure, TwitchGlypher } from "../../shared/render.js";

export { measureSchedule };
export type { Measure };

// --- Twitch icon (browser-specific) ------------------------------------------

const TWITCH_SVG =
  '<svg fill="#000" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M80,32,48,112V416h96v64h64l64-64h80L464,304V32ZM416,288l-64,64H256l-64,64V352H112V80H416Z"/>' +
  '<rect x="320" y="143" width="48" height="129"/>' +
  '<rect x="208" y="143" width="48" height="129"/></svg>';

let twitchIcon: HTMLImageElement | null = null;
let twitchReady = false;
const readyListeners = new Set<() => void>();

export function onAssetsReady(cb: () => void): () => void {
  readyListeners.add(cb);
  return () => readyListeners.delete(cb);
}

if (typeof Image !== "undefined") {
  const img = new Image();
  img.onload = () => {
    twitchIcon = img;
    twitchReady = true;
    readyListeners.forEach((cb) => cb());
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(TWITCH_SVG)}`;
}

const iconCache = new Map<string, HTMLCanvasElement>();
const twitchGlyph: TwitchGlypher = (ctx, color, size) => {
  if (!twitchReady || !twitchIcon) return null;
  const dpr = ctx.getTransform().a || 1;
  const px = Math.max(1, Math.round(size * dpr));
  const key = `${color}@${px}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = px;
  c.height = px;
  const ic = c.getContext("2d");
  if (!ic) return null;
  ic.drawImage(twitchIcon, 0, 0, px, px);
  ic.globalCompositeOperation = "source-in";
  ic.fillStyle = color;
  ic.fillRect(0, 0, px, px);
  iconCache.set(key, c);
  return c;
};

// --- Render entry point ------------------------------------------------------

export interface RenderExtra {
  highlightEventIds?: Set<string>;
  subtitle?: string | null;
}

export function renderSchedule(
  canvas: HTMLCanvasElement,
  schedule: Schedule,
  scale = 2,
  aspectRatio: number | null = null,
  logoImg: HTMLImageElement | null = null,
  extra: RenderExtra = {},
): Measure {
  const hasLogo = schedule.logo != null;
  const base = measureSchedule(schedule, 1, undefined, hasLogo);
  let hScale = 1;
  let forcedWidth: number | undefined;
  if (aspectRatio && aspectRatio > 0) {
    const targetW = base.height * aspectRatio;
    const autoTracks = schedule.days
      .map((d, i) =>
        d.dayWidth === "auto" ? base.sections[i]?.trackW ?? 0 : 0,
      )
      .filter((w) => w > 0);
    if (autoTracks.length > 0) {
      const baseTrackMax = Math.max(...autoTracks);
      const targetTrack = targetW - LAYOUT.pad * 2 - LAYOUT.gutterW;
      hScale = targetTrack / baseTrackMax;
      if (!Number.isFinite(hScale) || hScale <= 0) hScale = 0.05;
    } else {
      forcedWidth = targetW;
    }
  }
  const m =
    hScale === 1 && forcedWidth == null
      ? base
      : measureSchedule(schedule, hScale, forcedWidth, hasLogo);

  const W = m.width;
  const H = m.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return m;

  const dw = Math.round(W * scale);
  const dh = Math.round(H * scale);
  if (canvas.width !== dw) canvas.width = dw;
  if (canvas.height !== dh) canvas.height = dh;
  canvas.style.width = `${W}px`;
  canvas.style.height = "auto";
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  renderScheduleToContext(ctx, {
    schedule,
    measure: m,
    W,
    H,
    titleH: hasLogo ? 0 : LAYOUT.titleH,
    logoImg,
    twitchGlyph,
    highlightEventIds: extra.highlightEventIds,
    subtitle: extra.subtitle,
  });

  return m;
}
