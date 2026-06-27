import React, { useEffect, useRef, useState } from "react";
import { renderSchedule } from "./render.js";
import { loadOutputSettings, saveOutputSettings } from "./model.js";

// Aspect modes. "fit" sizes tightly to the content; presets fix the ratio;
// "custom" uses the W:H controls.
const ASPECTS = ["fit", "16:9", "4:3", "3:2", "1:1", "4:5", "9:16", "custom"];

// Resolve a mode + custom W/H into a numeric ratio (or null for "fit").
function resolveRatio({ mode, w, h }) {
  if (mode === "fit") return null;
  if (mode === "custom") {
    const r = Number(w) / Number(h);
    return Number.isFinite(r) && r > 0 ? r : null;
  }
  const [pw, ph] = mode.split(":").map(Number);
  return pw / ph;
}

// Read an image file, downscale to keep localStorage small, return a PNG data URL.
function fileToLogoDataUrl(file, max = 1000) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const DEFAULT_LOGO = { size: 18, x: 2, y: 2 };
const RENDER_DEBOUNCE_MS = 150;

// A labelled slider paired with a numeric input, both editing the same value.
function SliderControl({ label, value, min, max, unit = "", onChange }) {
  const set = (v) => onChange(Math.min(max, Math.max(min, Number(v) || min)));
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

export default function Preview({ schedule, update }) {
  const canvasRef = useRef(null);
  const logoInputRef = useRef(null);
  const [output, setOutput] = useState(loadOutputSettings);
  const [logoImg, setLogoImg] = useState(null);

  const logo = schedule.logo;

  // Persist output settings (aspect mode + custom W/H + resolution) across sessions.
  useEffect(() => {
    saveOutputSettings(output);
  }, [output]);

  const setOutputField = (key, value) =>
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
        );
      }
    }, RENDER_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [schedule, output, logoImg]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = (s) =>
        (s || "schedule").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      a.href = url;
      a.download = `${safe(schedule.title)}-schedule.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  const onLogoFile = async (file) => {
    if (!file) return;
    try {
      const src = await fileToLogoDataUrl(file);
      update((s) => {
        s.logo = { ...DEFAULT_LOGO, ...(s.logo || {}), src };
      });
    } catch {
      alert("Could not load that image.");
    }
  };

  const setLogoField = (key, value) =>
    update((s) => {
      if (s.logo) s.logo[key] = value;
    });

  const removeLogo = () => update((s) => (s.logo = null));

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
