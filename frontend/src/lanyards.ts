// Batch-render the designed front/back lanyard for every entrant and bundle them
// into a single zip, entirely client-side (keeps load off the backend machine and
// reuses the already-loaded fonts + Twitch icon).
import { zip } from "fflate";
import { entrantName, sidePixels } from "../../shared/lanyard.js";
import {
  lanyardScheduleBackground,
  preloadImages,
  renderEntrantSchedule,
  renderLanyardSide,
} from "./lanyard-render";
import { imagesToPdf, type PdfPage } from "./pdf";
import type { Entrant, LanyardDesign, OutputSettings, Schedule } from "./types";

export type LanyardFormat = "png" | "pdf";

// Physical millimetres to PDF points (1/72 inch).
function mmToPt(mm: number): number {
  return (mm / 25.4) * 72;
}

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

function canvasToBytes(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) return reject(new Error("toBlob failed"));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      type,
      quality,
    );
  });
}

// JPEG quality for PDF pages — high enough for crisp 300 DPI print, while
// keeping per-card files small (a lossless PNG export remains available too).
const PDF_JPEG_QUALITY = 0.95;

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  zip: "application/zip",
};

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
  bgImg?: HTMLImageElement | null;
  entrants: Entrant[];
  onProgress?: (done: number, total: number) => void;
  // Zip filename without extension; defaults to `lanyards-<title>`.
  zipName?: string;
  // Output format per card: "png" (front/back PNGs) or "pdf" (one 2-page PDF,
  // front then back, sized to the physical card at its DPI). Defaults to "png".
  format?: LanyardFormat;
}

// Render each entrant's designed front (+ back when non-empty) in the chosen
// format and download them: a single file when there's just one, otherwise a zip.
export async function generateLanyardsZip(opts: GenerateOpts): Promise<void> {
  const { schedule, design, output, logoImg, bgImg, entrants, onProgress, zipName } =
    opts;
  const format: LanyardFormat = opts.format ?? "png";
  const ratio = resolveRatio(output);
  const background = lanyardScheduleBackground(
    design,
    bgImg ?? null,
    schedule.background,
  );
  const { w: sideW, h: sideH } = sidePixels(design);
  const hasBack = design.back.elements.length > 0;

  const srcs = [
    ...[...design.front.elements, ...design.back.elements]
      .filter(
        (e) => (e.type === "image" || e.type === "backgroundImage") && e.src,
      )
      .map((e) => e.src as string),
    ...Object.values(design.roleImages ?? {}),
  ];
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
      background,
    );
    const assets = {
      scheduleImg,
      tag: entrantName(entrant),
      role: entrant.role,
      roleImages: design.roleImages ?? {},
      images,
    };

    let base = safeName(entrantName(entrant));
    if (usedNames.has(base)) base = `${base}-${entrant.id}`;
    usedNames.add(base);

    fctx.setTransform(1, 0, 0, 1, 0, 0);
    renderLanyardSide(fctx, design.front, sideW, sideH, assets);

    if (hasBack) {
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      renderLanyardSide(bctx, design.back, sideW, sideH, assets);
    }

    if (format === "pdf") {
      const ptW = mmToPt(design.widthMm);
      const ptH = mmToPt(design.heightMm);
      const pages: PdfPage[] = [
        {
          jpeg: await canvasToBytes(front, "image/jpeg", PDF_JPEG_QUALITY),
          pxW: sideW,
          pxH: sideH,
          ptW,
          ptH,
        },
      ];
      if (hasBack) {
        pages.push({
          jpeg: await canvasToBytes(back, "image/jpeg", PDF_JPEG_QUALITY),
          pxW: sideW,
          pxH: sideH,
          ptW,
          ptH,
        });
      }
      files[`${base}.pdf`] = imagesToPdf(pages);
    } else {
      files[`${base}-front.png`] = await canvasToBytes(front, "image/png");
      if (hasBack) {
        files[`${base}-back.png`] = await canvasToBytes(back, "image/png");
      }
    }

    onProgress?.(i + 1, entrants.length);
    await new Promise((r) => setTimeout(r, 0)); // yield so progress can paint
  }

  // A single produced file downloads directly; multiple are bundled into a zip.
  const names = Object.keys(files);
  if (names.length === 1) {
    const name = names[0];
    const ext = name.split(".").pop() ?? "";
    triggerDownload(
      new Blob([files[name] as unknown as BlobPart], {
        type: MIME_BY_EXT[ext] ?? "application/octet-stream",
      }),
      name,
    );
    return;
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)));
  });

  const part = zipped as unknown as BlobPart;
  const name = zipName || `lanyards-${safeName(schedule.title)}`;
  triggerDownload(new Blob([part], { type: "application/zip" }), `${name}.zip`);
}
