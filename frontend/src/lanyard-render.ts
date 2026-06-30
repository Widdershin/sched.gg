// Browser-side renderer for one lanyard side. Used by both the designer stage
// (screen px) and the PNG exporter (export px) so layout always matches.
import { THEME } from "../../shared/render.js";
import type { BackgroundSpec } from "../../shared/render.js";
import { elementRect } from "../../shared/lanyard.js";
import { renderSchedule } from "./render";
import type { LanyardDesign, LanyardSide, Schedule, ScheduleBackground } from "./types";

export interface SideAssets {
  // The selected/entrant's rendered schedule (a canvas), or null when none.
  scheduleImg: HTMLCanvasElement | HTMLImageElement | null;
  // The player tag text used for `tag` elements.
  tag: string;
  // The player's role, used to pick the roleImage source.
  role: string;
  // role name → data URL, shared across roleImage elements.
  roleImages: Record<string, string>;
  // Preloaded images keyed by their data URL src.
  images: Map<string, HTMLImageElement>;
}

function imgAspect(img: HTMLImageElement | HTMLCanvasElement): number {
  const w = "naturalWidth" in img ? img.naturalWidth : img.width;
  const h = "naturalHeight" in img ? img.naturalHeight : img.height;
  return h > 0 ? w / h : 1;
}

// Font size (px) to draw `text`: the requested `maxFontPx`, shrunk only as far
// as needed so it still fits `targetWidthPx` on one line (so long player tags
// never overflow the box).
export function fitTextFontPx(
  ctx: CanvasRenderingContext2D,
  text: string,
  bold: boolean,
  maxFontPx: number,
  targetWidthPx: number,
  fontFamily: string = THEME.font,
): number {
  const base = 100;
  ctx.font = `${bold ? 700 : 400} ${base}px ${fontFamily}`;
  const w = ctx.measureText(text || " ").width;
  const widthFit = w > 0 ? (targetWidthPx / w) * base : maxFontPx;
  return Math.min(maxFontPx, widthFit);
}

// Draw a full side (background + elements in z-order) into ctx, scaled to sideW×sideH.
export function renderLanyardSide(
  ctx: CanvasRenderingContext2D,
  side: LanyardSide,
  sideW: number,
  sideH: number,
  assets: SideAssets,
): void {
  ctx.fillStyle = side.background || "#0e1220";
  ctx.fillRect(0, 0, sideW, sideH);

  for (const el of side.elements) {
    if (el.type === "image") {
      const img = el.src ? assets.images.get(el.src) : undefined;
      if (!img) continue;
      const r = elementRect(el, sideW, sideH, { aspect: imgAspect(img) });
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    } else if (el.type === "schedule") {
      const img = assets.scheduleImg;
      if (!img) continue;
      const r = elementRect(el, sideW, sideH, { aspect: imgAspect(img) });
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    } else if (el.type === "roleImage") {
      const src = assets.roleImages[assets.role];
      const img = src ? assets.images.get(src) : undefined;
      if (!img) continue;
      const r = elementRect(el, sideW, sideH, { aspect: imgAspect(img) });
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    } else if (el.type === "text" || el.type === "tag") {
      const text =
        el.type === "tag" ? assets.tag || "{Player Tag}" : el.text || "";
      // Draw at the requested size, shrinking only to fit the box width.
      const maxFontPx = (el.fontFrac ?? 0.07) * sideH;
      const fontPx = fitTextFontPx(ctx, text, !!el.bold, maxFontPx, el.w * sideW);
      const r = elementRect(el, sideW, sideH, { fontPx });
      ctx.font = `${el.bold ? 700 : 400} ${fontPx}px ${THEME.font}`;
      ctx.fillStyle = el.color || "#ffffff";
      ctx.textBaseline = "middle";
      const align = el.align || "left";
      ctx.textAlign = align;
      const tx =
        align === "center" ? r.x + r.w / 2 : align === "right" ? r.x + r.w : r.x;
      ctx.fillText(text, tx, r.y + r.h / 2);
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
    } else if (el.type === "shape") {
      const r = elementRect(el, sideW, sideH);
      ctx.fillStyle = el.fill || "#3c8ce2";
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }
}

// Resolve a lanyard design's schedule background mode into a render spec. Falls
// back to a solid theme-colored background when "image" is chosen but no custom
// background image is available — and that's also the default (preserves the old
// look). `bgImg` is the schedule's loaded custom background, if any.
export function lanyardScheduleBackground(
  design: LanyardDesign,
  bgImg: HTMLImageElement | null,
  scheduleBackground?: ScheduleBackground | null,
): BackgroundSpec {
  const mode = design.scheduleBg ?? "color";
  if (mode === "transparent") return { mode: "transparent" };
  if (mode === "image" && bgImg) {
    return {
      mode: "image",
      image: bgImg,
      fit: scheduleBackground?.fit ?? "cover",
      opacity: scheduleBackground?.opacity ?? 100,
      blur: scheduleBackground?.blur ?? 0,
      darken: scheduleBackground?.darken ?? 0,
    };
  }
  return { mode: "color", color: design.scheduleBgColor || THEME.bg };
}

// Render an entrant's personalized schedule (highlighted events, no name overlay —
// the player tag is a separate element) to an offscreen canvas.
export function renderEntrantSchedule(
  schedule: Schedule,
  scale: number,
  ratio: number | null,
  logoImg: HTMLImageElement | null,
  eventIds: string[],
  background?: BackgroundSpec | null,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  renderSchedule(canvas, schedule, scale, ratio, logoImg, {
    highlightEventIds: new Set(eventIds),
    background,
  });
  return canvas;
}

// Load each unique data URL into an HTMLImageElement (failures are skipped).
export async function preloadImages(
  srcs: string[],
): Promise<Map<string, HTMLImageElement>> {
  const unique = Array.from(new Set(srcs.filter(Boolean)));
  const map = new Map<string, HTMLImageElement>();
  await Promise.all(
    unique.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            map.set(src, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = src;
        }),
    ),
  );
  return map;
}
