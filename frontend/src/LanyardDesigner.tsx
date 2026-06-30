import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  elementRect,
  entrantName,
  makeElement,
  sideElementsForRender,
  sidePixels,
  type ElementRectOpts,
} from "../../shared/lanyard.js";
import {
  renderLanyardSide,
  renderEntrantSchedule,
  lanyardScheduleBackground,
  fitTextFontPx,
} from "./lanyard-render";
import { onAssetsReady } from "./render";
import { fileToImageDataUrl } from "./images";
import { THEME } from "../../shared/render.js";
import type {
  Entrant,
  LanyardDesign,
  LanyardElement,
  LanyardElementType,
  LanyardScheduleBg,
  OutputSettings,
  Schedule,
} from "./types";

type SideKey = "front" | "back";

interface DragState {
  mode: "move" | "resize";
  id: string;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
}

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

const STAGE_H = 520; // on-screen card height in CSS px
const SNAP = 0.012; // centre snap threshold (fraction of side)
const BLEED_MM = 3; // bleed indicator inset

interface Props {
  design: LanyardDesign;
  update: (mutator: (d: LanyardDesign) => void) => void;
  schedule: Schedule;
  output: OutputSettings;
  logoImg: HTMLImageElement | null;
  bgImg: HTMLImageElement | null;
  selectedEntrant: Entrant | null;
}

export default function LanyardDesigner({
  design,
  update,
  schedule,
  output,
  logoImg,
  bgImg,
  selectedEntrant,
}: Props) {
  const [side, setSide] = useState<SideKey>("front");
  const [selectedElId, setSelectedElId] = useState<string | null>(null);
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [assetTick, setAssetTick] = useState(0);
  const [guides, setGuides] = useState({ v: false, h: false });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);
  // Offscreen context just for measuring fitted text size.
  const measureCtx = useMemo(
    () => document.createElement("canvas").getContext("2d"),
    [],
  );

  useEffect(() => onAssetsReady(() => setAssetTick((n) => n + 1)), []);

  const currentSide = design[side];
  // What actually draws on this side: its own elements plus the other side's
  // shared elements (behind). The overlay/layers still use currentSide.elements,
  // so shared elements are edited from their home side.
  const renderEls = useMemo(
    () => sideElementsForRender(design, side),
    [design, side],
  );
  const aspect = design.widthMm / design.heightMm;
  const stageW = STAGE_H * aspect;
  const tag = selectedEntrant ? entrantName(selectedEntrant) : "";
  const role = selectedEntrant?.role ?? "Competitor";
  const roleImages = design.roleImages ?? {};

  // The entrant's (or default) personalized schedule, rendered once.
  const scheduleImg = useMemo(
    () =>
      renderEntrantSchedule(
        schedule,
        output.scale,
        resolveRatio(output),
        logoImg,
        selectedEntrant?.eventIds ?? [],
        lanyardScheduleBackground(design, bgImg, schedule.background),
      ),
    [
      schedule,
      output,
      logoImg,
      bgImg,
      selectedEntrant,
      assetTick,
      design.scheduleBg,
      design.scheduleBgColor,
    ],
  );

  // Preload image data URLs drawn on the current side (incl. shared from the
  // other side and role badges).
  useEffect(() => {
    const srcs = [
      ...renderEls
        .filter(
          (e) => (e.type === "image" || e.type === "backgroundImage") && e.src,
        )
        .map((e) => e.src as string),
      ...Object.values(roleImages),
    ];
    let cancelled = false;
    (async () => {
      const map = new Map<string, HTMLImageElement>();
      await Promise.all(
        srcs.map(
          (src) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => (map.set(src, img), resolve());
              img.onerror = () => resolve();
              img.src = src;
            }),
        ),
      );
      if (!cancelled) setImages(map);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(renderEls.map((e) => e.src ?? "")),
    JSON.stringify(roleImages),
  ]);

  // Draw the stage canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(stageW * dpr);
    canvas.height = Math.round(STAGE_H * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderLanyardSide(
      ctx,
      { background: currentSide.background, elements: renderEls },
      stageW,
      STAGE_H,
      { scheduleImg, tag, role, roleImages, images },
    );
  }, [
    currentSide,
    renderEls,
    design,
    scheduleImg,
    images,
    tag,
    role,
    roleImages,
    stageW,
    side,
    assetTick,
  ]);

  // --- element helpers -------------------------------------------------------
  const updateEl = (id: string, fn: (el: LanyardElement) => void) =>
    update((d) => {
      const el = d[side].elements.find((e) => e.id === id);
      if (el) fn(el);
    });

  const addEl = (type: LanyardElementType, partial?: Partial<LanyardElement>) => {
    const el = makeElement(type, partial);
    update((d) => {
      d[side].elements.push(el);
    });
    setSelectedElId(el.id);
  };

  const removeEl = (id: string) => {
    update((d) => {
      d[side].elements = d[side].elements.filter((e) => e.id !== id);
    });
    setSelectedElId(null);
  };

  const reorder = (id: string, dir: -1 | 1) =>
    update((d) => {
      const arr = d[side].elements;
      const i = arr.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    });

  const onAddImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const src = await fileToImageDataUrl(file);
      addEl("image", { src });
    } catch {
      alert("Could not load that image.");
    }
  };

  const onAddBackgroundImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      // Full-bleed photo: JPEG-encode at a larger size to stay sharp without
      // bloating the schedule JSON (it embeds as a data URL).
      const src = await fileToImageDataUrl(file, 1600, "image/jpeg", 0.85);
      const el = makeElement("backgroundImage", { src });
      // Insert at the bottom of the z-order so it sits behind everything.
      update((d) => d[side].elements.unshift(el));
      setSelectedElId(el.id);
    } catch {
      alert("Could not load that image.");
    }
  };

  // --- drag / resize ---------------------------------------------------------
  const elAspect = (el: LanyardElement): number | undefined => {
    if (el.type === "image" && el.src) {
      const img = images.get(el.src);
      return img ? img.naturalWidth / img.naturalHeight : 1;
    }
    if (el.type === "roleImage") {
      const img = images.get(roleImages[role]);
      return img ? img.naturalWidth / img.naturalHeight : 1;
    }
    if (el.type === "schedule") {
      return scheduleImg.width / scheduleImg.height || 1;
    }
    return undefined;
  };

  // elementRect options for an element at a given side size (px): image/schedule
  // use intrinsic aspect; text/tag use the fitted (max, then width-capped) size.
  const rectOpts = (
    el: LanyardElement,
    sideWpx: number,
    sideHpx: number,
  ): ElementRectOpts => {
    if (
      el.type === "image" ||
      el.type === "schedule" ||
      el.type === "roleImage"
    ) {
      return { aspect: elAspect(el) };
    }
    if ((el.type === "text" || el.type === "tag") && measureCtx) {
      const text = el.type === "tag" ? tag || "{Player Tag}" : el.text || "";
      const maxFontPx = (el.fontFrac ?? 0.07) * sideHpx;
      return {
        fontPx: fitTextFontPx(measureCtx, text, !!el.bold, maxFontPx, el.w * sideWpx),
      };
    }
    return {};
  };

  const onElPointerDown = (
    el: LanyardElement,
    mode: "move" | "resize",
    e: ReactPointerEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedElId(el.id);
    drag.current = {
      mode,
      id: el.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: el.x,
      origY: el.y,
      origW: el.w,
    };
    // Capture on the stage so the stage's move/up handlers keep firing.
    stageRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const st = drag.current;
    const box = stageRef.current?.getBoundingClientRect();
    if (!st || !box) return;
    const dx = (e.clientX - st.startX) / box.width;
    const dy = (e.clientY - st.startY) / box.height;

    if (st.mode === "resize") {
      updateEl(st.id, (el) => {
        el.w = Math.min(1, Math.max(0.03, st.origW + dx));
      });
      return;
    }

    // Move, snapping the element's centre to the side's centre on either axis.
    let nx = Math.min(1, Math.max(0, st.origX + dx));
    let ny = Math.min(1, Math.max(0, st.origY + dy));
    let gv = false;
    let gh = false;
    const el = currentSide.elements.find((e2) => e2.id === st.id);
    if (el) {
      const r = elementRect(el, stageW, STAGE_H, rectOpts(el, stageW, STAGE_H));
      const wFrac = r.w / stageW;
      const hFrac = r.h / STAGE_H;
      if (Math.abs(nx + wFrac / 2 - 0.5) < SNAP) {
        nx = 0.5 - wFrac / 2;
        gv = true;
      }
      if (Math.abs(ny + hFrac / 2 - 0.5) < SNAP) {
        ny = 0.5 - hFrac / 2;
        gh = true;
      }
    }
    setGuides({ v: gv, h: gh });
    updateEl(st.id, (el2) => {
      el2.x = nx;
      el2.y = ny;
    });
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    drag.current = null;
    setGuides({ v: false, h: false });
    stageRef.current?.releasePointerCapture?.(e.pointerId);
  };

  const selectedEl =
    currentSide.elements.find((e) => e.id === selectedElId) ?? null;

  return (
    <div className="lanyard-designer">
      {/* Toolbar */}
      <div className="lanyard-design-toolbar">
        <div className="side-tabs">
          {(["front", "back"] as SideKey[]).map((s) => (
            <button
              key={s}
              className={`btn ghost${s === side ? " active" : ""}`}
              onClick={() => {
                setSide(s);
                setSelectedElId(null);
              }}
            >
              {s === "front" ? "Front" : "Back"}
            </button>
          ))}
        </div>
        <span className="design-add">
          <button className="btn ghost" onClick={() => imageInputRef.current?.click()}>
            + Image
          </button>
          <button
            className="btn ghost"
            onClick={() => bgImageInputRef.current?.click()}
          >
            + Background
          </button>
          <button className="btn ghost" onClick={() => addEl("text")}>
            + Text
          </button>
          <button className="btn ghost" onClick={() => addEl("tag")}>
            + Player tag
          </button>
          <button className="btn ghost" onClick={() => addEl("schedule")}>
            + Schedule
          </button>
          <button className="btn ghost" onClick={() => addEl("roleImage")}>
            + Role image
          </button>
          <button className="btn ghost" onClick={() => addEl("shape")}>
            + Shape
          </button>
        </span>
        <label className="design-bg">
          Background
          <input
            type="color"
            value={currentSide.background}
            onChange={(e) =>
              update((d) => (d[side].background = e.target.value))
            }
          />
        </label>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            onAddImage(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={bgImageInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            onAddBackgroundImage(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      <div className="lanyard-design-body">
        {/* Stage */}
        <div
          className="lanyard-stage"
          ref={stageRef}
          style={{ width: stageW, height: STAGE_H }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerDown={() => setSelectedElId(null)}
        >
          <canvas
            ref={canvasRef}
            style={{ width: stageW, height: STAGE_H, display: "block" }}
          />
          {/* 3mm bleed indicator (preview only — not exported). */}
          <div
            className="bleed-guide"
            style={{
              left: (BLEED_MM / design.widthMm) * stageW,
              right: (BLEED_MM / design.widthMm) * stageW,
              top: (BLEED_MM / design.heightMm) * STAGE_H,
              bottom: (BLEED_MM / design.heightMm) * STAGE_H,
            }}
          />
          {guides.v && <div className="snap-guide v" />}
          {guides.h && <div className="snap-guide h" />}
          {currentSide.elements.map((el) => {
            const r = elementRect(el, stageW, STAGE_H, rectOpts(el, stageW, STAGE_H));
            const isSel = el.id === selectedElId;
            // The background image fills the side — it's selectable but not
            // movable/resizable.
            const isBg = el.type === "backgroundImage";
            return (
              <div
                key={el.id}
                className={`el-box${isSel ? " selected" : ""}`}
                style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                onPointerDown={(e) => {
                  if (isBg) {
                    e.stopPropagation();
                    setSelectedElId(el.id);
                  } else {
                    onElPointerDown(el, "move", e);
                  }
                }}
              >
                {isSel && !isBg && (
                  <span
                    className="el-handle"
                    onPointerDown={(e) => onElPointerDown(el, "resize", e)}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Properties */}
        <div className="lanyard-props">
          <LayersPanel
            elements={currentSide.elements}
            selectedId={selectedElId}
            onSelect={setSelectedElId}
            onReorder={reorder}
          />
          <CardSizeControls design={design} update={update} />
          {selectedEl ? (
            <ElementProps
              el={selectedEl}
              updateEl={updateEl}
              removeEl={removeEl}
              reorder={reorder}
              design={design}
              updateDesign={update}
              hasBackground={!!schedule.background}
              onReplaceImage={(file) => {
                if (!file) return;
                // Background images get the same JPEG encoding as when added.
                const p =
                  selectedEl.type === "backgroundImage"
                    ? fileToImageDataUrl(file, 1600, "image/jpeg", 0.85)
                    : fileToImageDataUrl(file);
                p.then((src) =>
                  updateEl(selectedEl.id, (e) => (e.src = src)),
                ).catch(() => alert("Could not load that image."));
              }}
            />
          ) : (
            <p className="startgg-hint">Select an element to edit it.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function layerLabel(el: LanyardElement): string {
  switch (el.type) {
    case "image":
      return "Image";
    case "backgroundImage":
      return "Background image";
    case "text":
      return el.text?.trim() ? `Text: ${el.text}` : "Text";
    case "tag":
      return "Player tag";
    case "schedule":
      return "Schedule";
    case "roleImage":
      return "Role image";
    case "shape":
      return "Shape";
    default:
      return el.type;
  }
}

// Layer list: pick elements directly (easier than clicking overlapping boxes)
// and reorder z-order. Listed front-most first.
function LayersPanel({
  elements,
  selectedId,
  onSelect,
  onReorder,
}: {
  elements: LanyardElement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (id: string, dir: -1 | 1) => void;
}) {
  const top = [...elements].reverse();
  return (
    <div className="layers-panel">
      <span className="section-label">Layers</span>
      {elements.length === 0 ? (
        <p className="startgg-hint">No elements yet.</p>
      ) : (
        <ul className="layers-list">
          {top.map((el, i) => (
            <li
              key={el.id}
              className={`layer-row${el.id === selectedId ? " active" : ""}`}
              onClick={() => onSelect(el.id)}
            >
              <span className="layer-name">
                {layerLabel(el)}
                {el.shared && <span className="layer-tag"> · both sides</span>}
              </span>
              <button
                className="btn icon"
                title="Bring forward"
                disabled={i === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onReorder(el.id, 1);
                }}
              >
                ↑
              </button>
              <button
                className="btn icon"
                title="Send back"
                disabled={i === top.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  onReorder(el.id, -1);
                }}
              >
                ↓
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CardSizeControls({
  design,
  update,
}: {
  design: LanyardDesign;
  update: (mutator: (d: LanyardDesign) => void) => void;
}) {
  const num = (key: "widthMm" | "heightMm" | "dpi", min: number, max: number) => (
    <input
      className="ctl-num"
      type="number"
      min={min}
      max={max}
      value={design[key]}
      onChange={(e) => {
        const v = Math.min(max, Math.max(min, Number(e.target.value) || min));
        update((d) => (d[key] = v));
      }}
    />
  );
  const { w, h } = sidePixels(design);
  return (
    <div className="card-size">
      <span className="section-label">Card</span>
      <label>W {num("widthMm", 10, 200)} mm</label>
      <label>H {num("heightMm", 10, 300)} mm</label>
      <label>DPI {num("dpi", 72, 600)}</label>
      <span className="startgg-hint">
        {w}×{h}px
      </span>
    </div>
  );
}

function ElementProps({
  el,
  updateEl,
  removeEl,
  reorder,
  onReplaceImage,
  design,
  updateDesign,
  hasBackground,
}: {
  el: LanyardElement;
  updateEl: (id: string, fn: (el: LanyardElement) => void) => void;
  removeEl: (id: string) => void;
  reorder: (id: string, dir: -1 | 1) => void;
  onReplaceImage: (file: File | undefined) => void;
  design: LanyardDesign;
  updateDesign: (mutator: (d: LanyardDesign) => void) => void;
  hasBackground: boolean;
}) {
  const replaceRef = useRef<HTMLInputElement>(null);
  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
  ) => (
    <label className="prop-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );

  return (
    <div className="prop-panel">
      <span className="section-label">
        {el.type === "tag"
          ? "Player tag"
          : el.type === "roleImage"
            ? "Role image"
            : el.type === "backgroundImage"
              ? "Background image"
              : el.type}
      </span>

      <label className="prop-row">
        <span>Both sides</span>
        <input
          type="checkbox"
          checked={!!el.shared}
          onChange={(ev) =>
            updateEl(el.id, (e) => (e.shared = ev.target.checked))
          }
        />
      </label>

      {/* Background image covers the whole side, so it has no width control. */}
      {el.type !== "backgroundImage" &&
        slider("Width", el.w, 0.05, 1, 0.01, (v) =>
          updateEl(el.id, (e) => (e.w = v)),
        )}

      {(el.type === "text" || el.type === "tag") && (
        <>
          {el.type === "text" && (
            <label className="prop-row">
              <span>Text</span>
              <input
                type="text"
                value={el.text ?? ""}
                onChange={(ev) =>
                  updateEl(el.id, (e) => (e.text = ev.target.value))
                }
              />
            </label>
          )}
          {slider("Max size", el.fontFrac ?? 0.07, 0.02, 0.25, 0.005, (v) =>
            updateEl(el.id, (e) => (e.fontFrac = v)),
          )}
          {slider("Height", el.h ?? 0.1, 0.02, 1, 0.005, (v) =>
            updateEl(el.id, (e) => (e.h = v)),
          )}
          <label className="prop-row">
            <span>Color</span>
            <input
              type="color"
              value={el.color ?? "#ffffff"}
              onChange={(ev) =>
                updateEl(el.id, (e) => (e.color = ev.target.value))
              }
            />
          </label>
          <label className="prop-row">
            <span>Align</span>
            <select
              value={el.align ?? "left"}
              onChange={(ev) =>
                updateEl(el.id, (e) => (e.align = ev.target.value as never))
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label className="prop-row">
            <span>Bold</span>
            <input
              type="checkbox"
              checked={!!el.bold}
              onChange={(ev) =>
                updateEl(el.id, (e) => (e.bold = ev.target.checked))
              }
            />
          </label>
        </>
      )}

      {el.type === "shape" && (
        <>
          {slider("Height", el.h ?? 0.05, 0.005, 1, 0.005, (v) =>
            updateEl(el.id, (e) => (e.h = v)),
          )}
          <label className="prop-row">
            <span>Fill</span>
            <input
              type="color"
              value={el.fill ?? "#3c8ce2"}
              onChange={(ev) =>
                updateEl(el.id, (e) => (e.fill = ev.target.value))
              }
            />
          </label>
        </>
      )}

      {(el.type === "image" || el.type === "backgroundImage") && (
        <>
          <button className="btn ghost" onClick={() => replaceRef.current?.click()}>
            Replace image
          </button>
          <input
            ref={replaceRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              onReplaceImage(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {slider("Opacity", el.opacity ?? 100, 0, 100, 1, (v) =>
            updateEl(el.id, (e) => (e.opacity = v)),
          )}
          {slider("Blur", el.blur ?? 0, 0, 100, 1, (v) =>
            updateEl(el.id, (e) => (e.blur = v)),
          )}
          {slider("Darken", el.darken ?? 0, 0, 100, 1, (v) =>
            updateEl(el.id, (e) => (e.darken = v)),
          )}
        </>
      )}

      {el.type === "schedule" && (
        <>
          <p className="startgg-hint">
            Shows each entrant's highlighted schedule.
          </p>
          <label className="prop-row">
            <span>Background</span>
            <select
              value={design.scheduleBg ?? "color"}
              onChange={(e) =>
                updateDesign(
                  (d) => (d.scheduleBg = e.target.value as LanyardScheduleBg),
                )
              }
            >
              <option value="image">Custom image</option>
              <option value="color">Solid color</option>
              <option value="transparent">Transparent</option>
            </select>
          </label>
          {(design.scheduleBg ?? "color") === "color" && (
            <label className="prop-row">
              <span>BG color</span>
              <input
                type="color"
                value={design.scheduleBgColor || THEME.bg}
                onChange={(e) =>
                  updateDesign((d) => (d.scheduleBgColor = e.target.value))
                }
              />
            </label>
          )}
          {(design.scheduleBg ?? "color") === "image" && !hasBackground && (
            <p className="startgg-hint">
              No custom background uploaded — add one on the schedule editor page.
              Falls back to a solid color until then.
            </p>
          )}
        </>
      )}

      {el.type === "roleImage" && (
        <p className="startgg-hint">
          Shows the image for each player's role. Upload images per role in the
          Roles panel.
        </p>
      )}

      <div className="prop-actions">
        <button className="btn ghost" onClick={() => reorder(el.id, 1)} title="Bring forward">
          ↑
        </button>
        <button className="btn ghost" onClick={() => reorder(el.id, -1)} title="Send back">
          ↓
        </button>
        <button className="btn ghost danger" onClick={() => removeEl(el.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}
