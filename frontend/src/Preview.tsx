import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { renderSchedule, onAssetsReady } from "./render";
import { api } from "./api";
import { fileToImageDataUrl } from "./images";
import type { OutputSettings, Schedule, UpdateFn, VisualSettings } from "./types";

// Aspect modes. "fit" sizes tightly to the content; presets fix the ratio;
// "custom" uses the W:H controls.
const ASPECTS = ["fit", "16:9", "4:3", "3:2", "1:1", "4:5", "9:16", "custom"];

// Resolve a mode + custom W/H into a numeric ratio (or null for "fit").
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

const DEFAULT_LOGO = { size: 18, x: 2, y: 2 };
const DEFAULT_BACKGROUND = { fit: "cover" as const, opacity: 100, blur: 0, darken: 0 };
const RENDER_DEBOUNCE_MS = 150;

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (v: number) => void;
}

// A labelled slider paired with a numeric input, both editing the same value.
function SliderControl({ label, value, min, max, unit = "", onChange }: SliderProps) {
  const set = (v: string | number) =>
    onChange(Math.min(max, Math.max(min, Number(v) || min)));
  return (
    <span className="ctl">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        className="ctl-num"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
      {unit && <span className="ctl-unit">{unit}</span>}
    </span>
  );
}

interface Props {
  schedule: Schedule;
  update: UpdateFn;
  output: OutputSettings;
  setOutput: Dispatch<SetStateAction<OutputSettings>>;
  visuals: VisualSettings;
  setVisuals: Dispatch<SetStateAction<VisualSettings>>;
  scheduleId?: string | null;
}

export default function Preview({ schedule, update, output, setOutput, visuals, setVisuals, scheduleId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);
  // Bumped when async render assets (the Twitch icon) load, to force a redraw.
  const [assetTick, setAssetTick] = useState(0);
  useEffect(() => onAssetsReady(() => setAssetTick((n) => n + 1)), []);

  const logo = schedule.logo;
  const background = schedule.background;

  // Output settings (aspect + resolution) are owned by App so they persist and
  // sync alongside the schedule.
  const setOutputField = (key: keyof OutputSettings, value: number | string) =>
    setOutput((prev) => ({ ...prev, [key]: value }));

  // Load the logo data URL into an Image element for the canvas to draw.
  useEffect(() => {
    if (!logo?.src) {
      setLogoImg(null);
      return;
    }
    const img = new Image();
    img.onload = () => setLogoImg(img);
    img.src = logo.src;
  }, [logo?.src]);

  // Load the custom background image (if any) for the canvas to draw.
  useEffect(() => {
    if (!background?.src) {
      setBgImg(null);
      return;
    }
    const img = new Image();
    img.onload = () => setBgImg(img);
    img.src = background.src;
  }, [background?.src]);

  // Debounce renders so rapid edits (typing, slider drags) only redraw the
  // canvas once the changes settle, rather than on every keystroke/tick.
  useEffect(() => {
    const id = setTimeout(() => {
      if (canvasRef.current) {
        renderSchedule(
          canvasRef.current,
          schedule,
          output.scale,
          resolveRatio(output),
          logoImg,
          {
            background:
              bgImg && background
                ? {
                    mode: "image",
                    image: bgImg,
                    fit: background.fit ?? "cover",
                    opacity: background.opacity ?? 100,
                    blur: background.blur ?? 0,
                    darken: background.darken ?? 0,
                  }
                : { mode: "theme" },
          },
          visuals,
        );
      }
    }, RENDER_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [schedule, output, logoImg, bgImg, background, assetTick, visuals]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = (s: string) =>
        (s || "schedule").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      a.href = url;
      a.download = `${safe(schedule.title)}-schedule.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  const onLogoFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const src = await fileToImageDataUrl(file);
      update((s) => {
        s.logo = { ...DEFAULT_LOGO, ...(s.logo || {}), src };
      });
      // Upload the downscaled PNG to the server immediately.
      if (scheduleId) {
        const blob = dataUrlToBlob(src);
        if (blob) api.uploadLogo(scheduleId, blob).catch(() => {});
      }
    } catch {
      alert("Could not load that image.");
    }
  };

  const setLogoField = (key: "size" | "x" | "y", value: number) =>
    update((s) => {
      if (s.logo) s.logo[key] = value;
    });

  const removeLogo = () => {
    if (scheduleId) api.deleteLogo(scheduleId).catch(() => {});
    update((s) => (s.logo = null));
  };

  const onBackgroundFile = async (file: File | undefined) => {
    if (!file) return;
    let src: string;
    try {
      // Larger than logos so full-bleed images stay sharp, and JPEG-encoded —
      // a photographic PNG at this size easily exceeds the server's size cap.
      src = await fileToImageDataUrl(file, 1600, "image/jpeg", 0.85);
    } catch {
      alert("Could not load that image.");
      return;
    }
    update((s) => {
      s.background = { ...DEFAULT_BACKGROUND, ...(s.background || {}), src };
    });
    // Upload the bytes immediately; surface failures rather than swallowing them
    // (a silent failure would leave the server showing the previous image).
    if (scheduleId) {
      const blob = dataUrlToBlob(src);
      if (blob) {
        try {
          await api.uploadBackground(scheduleId, blob);
        } catch (e) {
          alert(
            `Could not save the background: ${
              e instanceof Error ? e.message : "upload failed"
            }`,
          );
        }
      }
    }
  };

  const setBackgroundField = (
    key: "fit" | "opacity" | "blur" | "darken",
    value: string | number,
  ) =>
    update((s) => {
      if (s.background) (s.background as Record<string, unknown>)[key] = value;
    });

  const removeBackground = () => {
    if (scheduleId) api.deleteBackground(scheduleId).catch(() => {});
    update((s) => (s.background = null));
  };

  return (
    <div className="preview">
      <div className="preview-toolbar">
        <button
          className="btn ghost"
          onClick={() => logoInputRef.current?.click()}
        >
          {logo ? "Replace logo" : "Add logo"}
        </button>
        {logo && (
          <>
            <SliderControl
              label="Size"
              value={logo.size}
              min={3}
              max={60}
              unit="%"
              onChange={(v) => setLogoField("size", v)}
            />
            <SliderControl
              label="X"
              value={logo.x}
              min={0}
              max={100}
              unit="%"
              onChange={(v) => setLogoField("x", v)}
            />
            <SliderControl
              label="Y"
              value={logo.y}
              min={0}
              max={100}
              unit="%"
              onChange={(v) => setLogoField("y", v)}
            />
            <button className="btn ghost danger" onClick={removeLogo}>
              Remove
            </button>
          </>
        )}
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            onLogoFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          className="btn ghost"
          onClick={() => bgInputRef.current?.click()}
        >
          {background ? "Replace background" : "Add background"}
        </button>
        {background && (
          <>
            <label className="scale-field">
              Fit
              <select
                value={background.fit ?? "cover"}
                onChange={(e) => setBackgroundField("fit", e.target.value)}
              >
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
              </select>
            </label>
            <SliderControl
              label="Opacity"
              value={background.opacity ?? 100}
              min={0}
              max={100}
              unit="%"
              onChange={(v) => setBackgroundField("opacity", v)}
            />
            <SliderControl
              label="Blur"
              value={background.blur ?? 0}
              min={0}
              max={40}
              unit="px"
              onChange={(v) => setBackgroundField("blur", v)}
            />
            <SliderControl
              label="Darken"
              value={background.darken ?? 0}
              min={0}
              max={100}
              unit="%"
              onChange={(v) => setBackgroundField("darken", v)}
            />
            <button className="btn ghost danger" onClick={removeBackground}>
              Remove
            </button>
          </>
        )}
        <input
          ref={bgInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            onBackgroundFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <span className="scale-field">
          Theme
          <select
            value={visuals.mode}
            onChange={(e) =>
              setVisuals((prev) => ({
                ...prev,
                mode: e.target.value as "default" | "custom",
              }))
            }
          >
            <option value="default">Default</option>
            <option value="custom">Custom</option>
          </select>
        </span>
        {visuals.mode === "custom" && (
          <>
            <span className="ctl">
              BG
              <input
                type="color"
                value={visuals.bg || "#0e1220"}
                onChange={(e) =>
                  setVisuals((prev) => ({ ...prev, bg: e.target.value }))
                }
              />
            </span>
            <span className="ctl">
              Grid
              <input
                type="color"
                value={visuals.grid || "#252c42"}
                onChange={(e) =>
                  setVisuals((prev) => ({ ...prev, grid: e.target.value }))
                }
              />
            </span>
            <span className="ctl">
              Text
              <input
                type="color"
                value={visuals.text || "#f5f7fb"}
                onChange={(e) =>
                  setVisuals((prev) => ({ ...prev, text: e.target.value }))
                }
              />
            </span>
            <SliderControl
              label="Radius"
              value={visuals.blockRadius ?? 10}
              min={0}
              max={20}
              unit="px"
              onChange={(v) => setVisuals((prev) => ({ ...prev, blockRadius: v }))}
            />
            <SliderControl
              label="Lane H"
              value={visuals.laneH ?? 92}
              min={48}
              max={140}
              unit="px"
              onChange={(v) => setVisuals((prev) => ({ ...prev, laneH: v }))}
            />
            <SliderControl
              label="Scale"
              value={visuals.pxPerMin ?? 3.2}
              min={1.0}
              max={8.0}
              onChange={(v) => setVisuals((prev) => ({ ...prev, pxPerMin: v }))}
            />
            <SliderControl
              label="Padding"
              value={visuals.pad ?? 48}
              min={16}
              max={100}
              unit="px"
              onChange={(v) => setVisuals((prev) => ({ ...prev, pad: v }))}
            />
          </>
        )}
        <label className="scale-field push-right">
          Aspect
          <select
            value={output.mode}
            onChange={(e) => setOutputField("mode", e.target.value)}
          >
            {ASPECTS.map((a) => (
              <option key={a} value={a}>
                {a === "fit" ? "Fit content" : a === "custom" ? "Custom" : a}
              </option>
            ))}
          </select>
        </label>
        {output.mode === "custom" && (
          <span className="scale-field aspect-custom">
            <SliderControl
              label="W"
              value={output.w}
              min={1}
              max={32}
              onChange={(v) => setOutputField("w", v)}
            />
            <span className="ratio-colon">:</span>
            <SliderControl
              label="H"
              value={output.h}
              min={1}
              max={32}
              onChange={(v) => setOutputField("h", v)}
            />
          </span>
        )}
        <label className="scale-field">
          Resolution
          <select
            value={output.scale}
            onChange={(e) => setOutputField("scale", Number(e.target.value))}
          >
            <option value={1}>1× (standard)</option>
            <option value={2}>2× (sharp)</option>
            <option value={3}>3× (print)</option>
          </select>
        </label>
        <button className="btn primary" onClick={download}>
          Download PNG
        </button>
      </div>

      <div className="canvas-scroll">
        <canvas ref={canvasRef} className="schedule-canvas" />
      </div>
    </div>
  );
}
