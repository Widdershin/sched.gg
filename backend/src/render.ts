// Server-side schedule renderer using @napi-rs/canvas.
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import {
  measureSchedule,
  renderScheduleToContext,
} from "../../shared/render.js";
import type { Schedule, OutputSettings } from "../../shared/types.js";
import type { TwitchGlypher } from "../../shared/render.js";
import { LAYOUT } from "../../shared/render.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

// --- Font registration -------------------------------------------------------

// Inter static weight files are copied into shared/ at build time (from ./fonts).
function tryRegisterFont() {
  for (const weight of ["Regular", "Medium", "Bold", "ExtraBold"]) {
    for (const baseDir of [currentDir, join(currentDir, ".."), join(currentDir, "..", "..")]) {
      const p = join(baseDir, "shared", `Inter-${weight}.ttf`);
      try {
        GlobalFonts.registerFromPath(p, "Inter");
        break;
      } catch {
        // try next path
      }
    }
  }
}
tryRegisterFont();

// --- Twitch icon -------------------------------------------------------------

const TWITCH_SVG =
  '<svg fill="#000" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M80,32,48,112V416h96v64h64l64-64h80L464,304V32ZM416,288l-64,64H256l-64,64V352H112V80H416Z"/>' +
  '<rect x="320" y="143" width="48" height="129"/>' +
  '<rect x="208" y="143" width="48" height="129"/></svg>';

let twitchIcon: Awaited<ReturnType<typeof loadImage>> | null = null;
let twitchReady = false;

async function ensureTwitchIcon() {
  if (twitchReady) return;
  twitchIcon = await loadImage(Buffer.from(TWITCH_SVG));
  twitchReady = true;
}

const iconCache = new Map<string, any>();
const twitchGlyph: TwitchGlypher = (ctx, color, size) => {
  if (!twitchReady || !twitchIcon) return null;
  const px = Math.max(1, Math.round(size));
  const key = `${color}@${px}`;
  const cached = iconCache.get(key);
  if (cached) return cached as unknown as import("../../shared/render.js").CanvasLike;
  const c = createCanvas(px, px);
  const ic = c.getContext("2d");
  if (!ic) return null;
  ic.drawImage(twitchIcon, 0, 0, px, px);
  ic.globalCompositeOperation = "source-in";
  ic.fillStyle = color;
  ic.fillRect(0, 0, px, px);
  iconCache.set(key, c);
  return c as unknown as import("../../shared/render.js").CanvasLike;
};

// --- Render entry point ------------------------------------------------------

export interface RenderOptions {
  schedule: Schedule;
  output?: OutputSettings | null;
  logoBytes?: Buffer | null;
}

function resolveRatio(output?: OutputSettings | null): number | null {
  if (!output || output.mode === "fit") return null;
  if (output.mode === "custom") {
    const r = Number(output.w) / Number(output.h);
    return Number.isFinite(r) && r > 0 ? r : null;
  }
  const [pw, ph] = output.mode.split(":").map(Number);
  return pw / ph;
}

export async function renderScheduleToPng(
  opts: RenderOptions,
): Promise<Buffer> {
  await ensureTwitchIcon();

  const scale = 2;
  const logoAvailable = !!(opts.logoBytes && opts.logoBytes.length > 0);
  const hasLogo = !!(opts.schedule.logo && logoAvailable);

  // Aspect ratio handling — same logic as frontend render.ts.
  const aspectRatio = resolveRatio(opts.output);
  const base = measureSchedule(opts.schedule, 1, undefined, hasLogo);
  let hScale = 1;
  let forcedWidth: number | undefined;
  if (aspectRatio && aspectRatio > 0) {
    const targetW = base.height * aspectRatio;
    const autoTracks = opts.schedule.days
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
      : measureSchedule(opts.schedule, hScale, forcedWidth, hasLogo);
  const W = m.width;
  const H = m.height;

  const canvas = createCanvas(Math.round(W * scale), Math.round(H * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context");

  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // Load logo if present.
  let logoImg: Awaited<ReturnType<typeof loadImage>> | null = null;
  if (opts.logoBytes && opts.logoBytes.length > 0) {
    try {
      logoImg = await loadImage(opts.logoBytes);
    } catch {
      // logo failed to load — draw without it
    }
  }

  renderScheduleToContext(ctx, {
    schedule: opts.schedule,
    measure: m,
    W,
    H,
    titleH: hasLogo ? 0 : LAYOUT.titleH,
    logoImg: logoImg as unknown as import("../../shared/render.js").ImageLike,
    twitchGlyph,
  });

  return canvas.toBuffer("image/png");
}
