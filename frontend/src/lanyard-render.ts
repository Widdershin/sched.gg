// Browser-side renderer for one lanyard side. Used by both the designer stage
// (screen px) and the PNG exporter (export px) so layout always matches.
import { THEME } from "../../shared/render.js";
import { elementRect } from "../../shared/lanyard.js";
import { renderSchedule } from "./render";
import type { LanyardSide, Schedule } from "./types";

export interface SideAssets {
  // The selected/entrant's rendered schedule (a canvas), or null when none.
  scheduleImg: HTMLCanvasElement | HTMLImageElement | null;
  // The player tag text used for `tag` elements.
  tag: string;
  // Preloaded images keyed by their data URL src.
  images: Map<string, HTMLImageElement>;
}

function imgAspect(img: HTMLImageElement | HTMLCanvasElement): number {
  const w = "naturalWidth" in img ? img.naturalWidth : img.width;
  const h = "naturalHeight" in img ? img.naturalHeight : img.height;
  return h > 0 ? w / h : 1;
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
      const r = elementRect(el, sideW, sideH, imgAspect(img));
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    } else if (el.type === "schedule") {
      const img = assets.scheduleImg;
      if (!img) continue;
      const r = elementRect(el, sideW, sideH, imgAspect(img));
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    } else if (el.type === "text" || el.type === "tag") {
      const text =
        el.type === "tag" ? assets.tag || "{Player Tag}" : el.text || "";
      const r = elementRect(el, sideW, sideH);
      ctx.font = `${el.bold ? 700 : 400} ${r.fontPx}px ${THEME.font}`;
      ctx.fillStyle = el.color || "#ffffff";
      ctx.textBaseline = "top";
      const align = el.align || "left";
      ctx.textAlign = align;
      const tx =
        align === "center" ? r.x + r.w / 2 : align === "right" ? r.x + r.w : r.x;
      ctx.fillText(text, tx, r.y);
      ctx.textAlign = "left";
    } else if (el.type === "shape") {
      const r = elementRect(el, sideW, sideH);
      ctx.fillStyle = el.fill || "#3c8ce2";
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }
}

// Render an entrant's personalized schedule (highlighted events, no name overlay —
// the player tag is a separate element) to an offscreen canvas.
export function renderEntrantSchedule(
  schedule: Schedule,
  scale: number,
  ratio: number | null,
  logoImg: HTMLImageElement | null,
  eventIds: string[],
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  renderSchedule(canvas, schedule, scale, ratio, logoImg, {
    highlightEventIds: new Set(eventIds),
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
