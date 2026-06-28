// Batch-render the designed front/back lanyard for every entrant and bundle them
// into a single zip, entirely client-side (keeps load off the backend machine and
// reuses the already-loaded fonts + Twitch icon).
import { zip } from "fflate";
import { sidePixels } from "../../shared/lanyard.js";
import {
  preloadImages,
  renderEntrantSchedule,
  renderLanyardSide,
} from "./lanyard-render";
import type { Entrant, LanyardDesign, OutputSettings, Schedule } from "./types";

// Resolve an aspect mode + custom W/H into a numeric ratio (or null for "fit").
function resolveRatio(output: OutputSettings): number | null {
  const { mode, w, h } = output;
  if (mode === "fit") return null;
  if (mode === "custom") {
    const r = Number(w) / Number(h);
    return Number.isFinite(r) && r > 0 ? r : null;
  }
  const [pw, ph] = mode.split(":").map(Number);
  return pw / ph;
}

function safeName(s: string): string {
  return (
    (s || "entrant")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "entrant"
  );
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("toBlob failed"));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface GenerateOpts {
  schedule: Schedule;
  design: LanyardDesign;
  output: OutputSettings;
  logoImg: HTMLImageElement | null;
  entrants: Entrant[];
  onProgress?: (done: number, total: number) => void;
}

// Render each entrant's designed front (+ back when non-empty), zip (stored —
// PNGs are already compressed), and download a single archive.
export async function generateLanyardsZip(opts: GenerateOpts): Promise<void> {
  const { schedule, design, output, logoImg, entrants, onProgress } = opts;
  const ratio = resolveRatio(output);
  const { w: sideW, h: sideH } = sidePixels(design);
  const hasBack = design.back.elements.length > 0;

  const srcs = [...design.front.elements, ...design.back.elements]
    .filter((e) => e.type === "image" && e.src)
    .map((e) => e.src as string);
  const images = await preloadImages(srcs);

  const front = document.createElement("canvas");
  front.width = sideW;
  front.height = sideH;
  const back = document.createElement("canvas");
  back.width = sideW;
  back.height = sideH;
  const fctx = front.getContext("2d");
  const bctx = back.getContext("2d");
  if (!fctx || !bctx) throw new Error("2d context unavailable");

  const files: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();

  for (let i = 0; i < entrants.length; i++) {
    const entrant = entrants[i];
    const scheduleImg = renderEntrantSchedule(
      schedule,
      output.scale,
      ratio,
      logoImg,
      entrant.eventIds,
    );
    const assets = { scheduleImg, tag: entrant.gamerTag, images };

    let base = safeName(entrant.gamerTag);
    if (usedNames.has(base)) base = `${base}-${entrant.id}`;
    usedNames.add(base);

    fctx.setTransform(1, 0, 0, 1, 0, 0);
    renderLanyardSide(fctx, design.front, sideW, sideH, assets);
    files[`${base}-front.png`] = await canvasToPngBytes(front);

    if (hasBack) {
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      renderLanyardSide(bctx, design.back, sideW, sideH, assets);
      files[`${base}-back.png`] = await canvasToPngBytes(back);
    }

    onProgress?.(i + 1, entrants.length);
    await new Promise((r) => setTimeout(r, 0)); // yield so progress can paint
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)));
  });

  const part = zipped as unknown as BlobPart;
  triggerDownload(
    new Blob([part], { type: "application/zip" }),
    `lanyards-${safeName(schedule.title)}.zip`,
  );
}
