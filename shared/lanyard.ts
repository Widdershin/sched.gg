// Pure layout helpers + factories for the lanyard designer. Shared by the
// on-screen stage and the PNG exporter so the two can't diverge.
import { uid } from "./model.js";
import type {
  LanyardDesign,
  LanyardElement,
  LanyardElementType,
  LanyardSide,
} from "./types.js";

const CARD_BG = "#0e1220";

export const DEFAULT_ROLE = "Competitor";

export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4);
}

// Export pixel dimensions of a side from its physical size + dpi.
export function sidePixels(design: LanyardDesign): { w: number; h: number } {
  return {
    w: mmToPx(design.widthMm, design.dpi),
    h: mmToPx(design.heightMm, design.dpi),
  };
}

export interface ElementRect {
  x: number;
  y: number;
  w: number;
  h: number;
  fontPx: number;
}

export interface ElementRectOpts {
  aspect?: number; // image/schedule intrinsic w/h
  fontPx?: number; // text/tag: measured size that fits the box width
}

// Resolve an element's pixel rect within a side of the given pixel size.
// `aspect` (w/h) is required for image/schedule so height tracks the source;
// text/tag take a measured `fontPx` (the text is fit to the box width); shapes
// use their own h.
export function elementRect(
  el: LanyardElement,
  sideW: number,
  sideH: number,
  opts: ElementRectOpts = {},
): ElementRect {
  const x = el.x * sideW;
  const y = el.y * sideH;
  const w = el.w * sideW;

  if (el.type === "image" || el.type === "schedule" || el.type === "roleImage") {
    const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 1;
    return { x, y, w, h: w / aspect, fontPx: 0 };
  }
  if (el.type === "text" || el.type === "tag") {
    const fontPx = opts.fontPx ?? (el.fontFrac ?? 0.07) * sideH;
    // Explicit container height (text is centred within it); else the line box.
    const h = el.h != null ? el.h * sideH : fontPx * 1.3;
    return { x, y, w, h, fontPx };
  }
  // shape
  const h = (el.h ?? 0.05) * sideH;
  return { x, y, w, h, fontPx: 0 };
}

// Per-type starting values for a newly added element.
export function makeElement(
  type: LanyardElementType,
  partial: Partial<LanyardElement> = {},
): LanyardElement {
  const base: LanyardElement = { id: uid("el"), type, x: 0.1, y: 0.1, w: 0.4 };
  switch (type) {
    case "text":
      Object.assign(base, {
        text: "Text",
        fontFrac: 0.06,
        color: "#ffffff",
        align: "left",
        w: 0.5,
        h: 0.1,
      });
      break;
    case "tag":
      Object.assign(base, {
        fontFrac: 0.09,
        color: "#ffffff",
        align: "left",
        bold: true,
        w: 0.7,
        h: 0.14,
      });
      break;
    case "schedule":
      Object.assign(base, { x: 0.05, y: 0.05, w: 0.9 });
      break;
    case "shape":
      Object.assign(base, { shape: "rect", fill: "#3c8ce2", w: 0.4, h: 0.06 });
      break;
    case "image":
      Object.assign(base, { w: 0.4 });
      break;
    case "roleImage":
      Object.assign(base, { w: 0.25 });
      break;
  }
  return { ...base, ...partial };
}

export function emptySide(): LanyardSide {
  return { background: CARD_BG, elements: [] };
}

// A sensible starting design: a single schedule element filling the front, so
// generated output matches today's behavior until the user edits it.
export function defaultDesign(): LanyardDesign {
  return {
    widthMm: 54,
    heightMm: 86,
    dpi: 300,
    front: { background: CARD_BG, elements: [makeElement("schedule")] },
    back: emptySide(),
  };
}
