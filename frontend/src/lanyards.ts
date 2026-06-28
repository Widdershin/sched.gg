// Batch-render one personalized schedule image per entrant and bundle them into
// a single zip, entirely client-side (keeps the load off the single backend
// machine and reuses the already-loaded fonts + Twitch icon).
import { zip } from "fflate";
import { renderSchedule } from "./render";
import type { Entrant, OutputSettings, Schedule } from "./types";

// Resolve an aspect mode + custom W/H into a numeric ratio (or null for "fit").
// Mirrors the helper in Preview.tsx.
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
  return (s || "entrant").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "entrant";
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
  output: OutputSettings;
  logoImg: HTMLImageElement | null;
  entrants: Entrant[];
  onProgress?: (done: number, total: number) => void;
}

// Render every entrant's image, zip (stored — PNGs are already compressed), and
// download a single archive.
export async function generateLanyardsZip(opts: GenerateOpts): Promise<void> {
  const { schedule, output, logoImg, entrants, onProgress } = opts;
  const ratio = resolveRatio(output);
  const canvas = document.createElement("canvas");
  const files: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();

  for (let i = 0; i < entrants.length; i++) {
    const entrant = entrants[i];
    renderSchedule(canvas, schedule, output.scale, ratio, logoImg, {
      highlightEventIds: new Set(entrant.eventIds),
      subtitle: entrant.gamerTag,
    });
    // Dedupe filenames (gamerTags can repeat) by appending the participant id.
    let base = safeName(entrant.gamerTag);
    if (usedNames.has(base)) base = `${base}-${entrant.id}`;
    usedNames.add(base);
    files[`${base}.png`] = await canvasToPngBytes(canvas);
    onProgress?.(i + 1, entrants.length);
    // Yield to the event loop so the progress UI can paint.
    await new Promise((r) => setTimeout(r, 0));
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 0 }, (err, data) =>
      err ? reject(err) : resolve(data),
    );
  });

  const title = safeName(schedule.title);
  const part = zipped as unknown as BlobPart;
  triggerDownload(new Blob([part], { type: "application/zip" }), `lanyards-${title}.zip`);
}
