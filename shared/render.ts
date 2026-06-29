// Core schedule renderer — shared between frontend (browser canvas) and backend
// (@napi-rs/canvas). Platform-specific glue (image loading, canvas creation,
// Twitch icon caching) lives in each platform's own render.ts.
import { dayTimeRange, parseTime, formatTime } from "./model.js";
import type { Block, Day, Schedule, VisualSettings } from "./types.js";

// --- Theme & layout constants -------------------------------------------------

export const THEME = {
  bg: "#0e1220",
  panel: "#161c2e",
  grid: "#252c42",
  text: "#f5f7fb",
  muted: "#8c95ad",
  title: "#ffffff",
  font: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
  bannerColor: "#7c8699",
  blockFillAlpha: 0.20,
  blockStrokeAlpha: 0.85,
  laneBgAlpha: 0.02,
  watermarkAlpha: 0.22,
  badgeTextColor: "#0e1220", // matches bg for contrast on accent fill
};

export const LAYOUT = {
  pad: 48,
  titleH: 70,
  subtitleH: 38,
  timeHeaderH: 36,
  gutterW: 0,
  laneH: 92,
  laneGap: 12,
  dayGap: 40,
  pxPerMin: 3.2,
  blockRadius: 10,
  blockBorderWidth: 1.5,
  gridLineWidth: 1.0,
};

export type ResolvedTheme = typeof THEME;
export type ResolvedLayout = typeof LAYOUT;

export function resolveTheme(vs?: VisualSettings | null): ResolvedTheme {
  if (!vs || vs.mode !== "custom") return THEME;
  return { ...THEME, ...Object.fromEntries(Object.entries(vs).filter(([k]) => k !== "mode")) };
}

export function resolveLayout(vs?: VisualSettings | null): ResolvedLayout {
  if (!vs || vs.mode !== "custom") return LAYOUT;
  return { ...LAYOUT, ...Object.fromEntries(Object.entries(vs).filter(([k]) => k !== "mode")) };
}

// --- Types -------------------------------------------------------------------

export interface Section {
  w: number;
  h: number;
  min: number;
  max: number;
  trackW: number;
  pxPerMin: number;
}

export interface Measure {
  width: number;
  height: number;
  sections: Section[];
}

interface BlockOpts {
  center?: boolean;
  hideEnd?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
}

export interface CanvasLike {
  width: number;
  height: number;
}

export interface ImageLike {
  readonly width: number;
  readonly height: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

export type TwitchGlypher = (
  ctx: CanvasRenderingContext2D,
  color: string,
  size: number,
) => CanvasLike | null;

// --- Helpers -----------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number(v) || 0));
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    if (words.join(" ") !== lines.join(" ")) lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function ellipsize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

// --- Layout measurement -------------------------------------------------------

function measureDaySection(day: Day, hScale = 1, layout: ResolvedLayout = LAYOUT): Section {
  const { min, max } = dayTimeRange(day);
  const laneCount = Math.max(day.lanes.length, 1);
  const pxPerMin = layout.pxPerMin * hScale;
  const trackW = (max - min) * pxPerMin;
  const w = layout.gutterW + trackW;
  const lanesH = laneCount * layout.laneH + (laneCount - 1) * layout.laneGap;
  const h = layout.subtitleH + layout.timeHeaderH + lanesH;
  return { w, h, min, max, trackW, pxPerMin };
}

export function measureSchedule(
  schedule: Schedule,
  hScale = 1,
  targetWidth?: number,
  hasLogo?: boolean,
  layout: ResolvedLayout = LAYOUT,
): Measure {
  const days = schedule.days.length ? schedule.days : [];

  const naturalSections = days.map((d) => measureDaySection(d, hScale, layout));

  let autoContentW = 0;
  for (let i = 0; i < days.length; i++) {
    if (days[i].dayWidth === "auto") {
      autoContentW = Math.max(autoContentW, naturalSections[i].w);
    }
  }
  if (autoContentW === 0) autoContentW = 400;

  const contentBase =
    targetWidth != null ? targetWidth - layout.pad * 2 : autoContentW;

  const sections = days.map((day, i) => {
    if (day.dayWidth === "auto") return naturalSections[i];

    const pct = clamp(Number(day.dayWidth), 5, 100);
    const targetW = Math.round((contentBase * pct) / 100);
    const targetTrackW = Math.max(targetW - layout.gutterW, 30);

    const { min, max } = naturalSections[i];
    const range = max - min;
    const pxPerMin =
      range > 0 ? targetTrackW / range : layout.pxPerMin * hScale;
    const laneCount = Math.max(day.lanes.length, 1);
    const lanesH = laneCount * layout.laneH + (laneCount - 1) * layout.laneGap;
    const h = layout.subtitleH + layout.timeHeaderH + lanesH;

    return { w: targetW, h, min, max, trackW: targetTrackW, pxPerMin };
  });

  const contentW = sections.reduce((acc, s) => Math.max(acc, s.w), 0);
  const width =
    targetWidth != null
      ? targetWidth
      : layout.pad * 2 + (sections.length ? contentW : 400);
  const stacked = sections.reduce((acc, s) => acc + s.h, 0);
  const height =
    layout.pad * 2 +
    titleHeight(!!hasLogo, layout) +
    stacked +
    Math.max(sections.length - 1, 0) * layout.dayGap;
  return { width, height, sections };
}

function titleHeight(hasLogo: boolean, layout: ResolvedLayout = LAYOUT): number {
  return hasLogo ? 0 : layout.titleH;
}

// --- Drawing -----------------------------------------------------------------

function drawBlock(
  ctx: CanvasRenderingContext2D,
  block: Block,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: string,
  opts: BlockOpts,
  twitchGlyph: TwitchGlypher,
  theme: ResolvedTheme = THEME,
  layout: ResolvedLayout = LAYOUT,
): void {
  // Personalized renders fade events the entrant isn't in so their own pop.
  if (opts.dimmed) {
    ctx.save();
    ctx.globalAlpha = 0.7;
  }

  ctx.fillStyle = hexToRgba(accent, theme.blockFillAlpha);
  roundRect(ctx, x, y, w, h, layout.blockRadius);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(accent, theme.blockStrokeAlpha);
  ctx.lineWidth = layout.blockBorderWidth;
  roundRect(ctx, x, y, w, h, layout.blockRadius);
  ctx.stroke();

  // Emphasis pass for an entrant's own events: a brighter, thicker glowing
  // outline so their blocks pop out of the full schedule.
  if (opts.highlighted) {
    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = hexToRgba(accent, 1);
    ctx.lineWidth = 3;
    roundRect(ctx, x, y, w, h, layout.blockRadius);
    ctx.stroke();
    ctx.restore();
  }

  const innerX = x + 14;
  const innerW = w - 22;
  if (innerW < 24) {
    if (opts.dimmed) ctx.restore();
    return;
  }

  const lineH = 19;
  ctx.font = `700 16px ${theme.font}`;
  const nLines = wrapText(ctx, block.name || "", innerW, 2);
  const start = parseTime(block.start);
  const end = parseTime(block.end);
  const hasTime = start != null && end != null;

  const groupH = nLines.length * lineH + (hasTime ? 16 : 0);
  let textY = opts.center ? y + (h - groupH) / 2 + 15 : y + 22;
  const textX = opts.center ? x + w / 2 : innerX;
  ctx.textAlign = opts.center ? "center" : "left";

  ctx.fillStyle = theme.text;
  for (const line of nLines) {
    ctx.fillText(line, textX, textY);
    textY += lineH;
  }

  if (hasTime) {
    ctx.fillStyle = theme.muted;
    ctx.font = `500 12px ${theme.font}`;
    let timeText = `${formatTime(start, { compact: true })}–${formatTime(end, {
      compact: true,
    })}`;
    if (opts.hideEnd) {
      timeText = `${formatTime(start, { compact: true })}`;
    }
    ctx.fillText(timeText, textX, textY);
  }
  ctx.textAlign = "left";

  const streams = [block.stream, block.stream2].filter(Boolean);
  if (streams.length) {
    ctx.font = `600 12px ${theme.font}`;
    const badgeH = 22;
    const icon = 14;
    const padL = 8;
    const gap = 4;
    const padR = 8;
    const reserved = padL + icon + gap + padR;
    const lby = y + h - badgeH - 8;
    const rightEdge = x + w - 8;
    let lbx = x + 12;
    if (lby > textY + 4) {
      streams.forEach((text, idx) => {
        const avail = rightEdge - lbx - reserved;
        if (avail < 12) return;
        const label = ellipsize(ctx, text, avail);
        const labelW = ctx.measureText(label).width;
        const badgeW = padL + icon + gap + labelW + padR;
        const fg = idx === 0 ? theme.badgeTextColor : accent;
        if (idx === 0) {
          ctx.fillStyle = accent;
          roundRect(ctx, lbx, lby, badgeW, badgeH, 11);
          ctx.fill();
        } else {
          roundRect(ctx, lbx, lby, badgeW, badgeH, 11);
          ctx.strokeStyle = accent;
          ctx.lineWidth = layout.blockBorderWidth;
          ctx.stroke();
        }
        const glyph = twitchGlyph(ctx, fg, icon);
        if (glyph) {
          ctx.drawImage(glyph as never, lbx + padL, lby + (badgeH - icon) / 2, icon, icon);
        }
        ctx.fillStyle = fg;
        ctx.fillText(label, lbx + padL + icon + gap, lby + 15);
        lbx += badgeW + 6;
      });
    }
  }

  if (opts.dimmed) ctx.restore();
}

function drawDaySection(
  ctx: CanvasRenderingContext2D,
  day: Day,
  x: number,
  y: number,
  section: Section,
  canvasW: number,
  twitchGlyph: TwitchGlypher,
  highlightEventIds?: Set<string>,
  theme: ResolvedTheme = THEME,
  layout: ResolvedLayout = LAYOUT,
): void {
  const gridLeft = x + layout.gutterW;
  const headerTop = y + layout.subtitleH;
  const lanesTop = headerTop + layout.timeHeaderH;
  const banners = day.banners ?? [];
  const laneCount = Math.max(day.lanes.length, 1);
  const lanesBottom =
    lanesTop + laneCount * layout.laneH + (laneCount - 1) * layout.laneGap;
  const minutesToX = (mins: number) =>
    gridLeft + (mins - section.min) * section.pxPerMin;
  const blockW = (start: number, end: number) =>
    Math.max((end - start) * section.pxPerMin, 30);

  ctx.fillStyle = theme.text;
  ctx.textAlign = "left";
  ctx.font = `700 24px ${theme.font}`;
  ctx.fillText(day.name || "", x, y + 24);

  ctx.font = `500 14px ${theme.font}`;
  const contentRight = canvasW - layout.pad;
  const rightEdge = minutesToX(section.max);
  const ticks: number[] = [section.min];
  for (
    let t = Math.ceil((section.min + 1) / 60) * 60;
    t < section.max;
    t += 60
  ) {
    ticks.push(t);
  }
  ticks.push(section.max);

  ticks.forEach((t, idx) => {
    const gx = minutesToX(t);
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = layout.gridLineWidth;
    ctx.beginPath();
    ctx.moveTo(gx, headerTop + 20);
    ctx.lineTo(gx, lanesBottom);
    ctx.stroke();

    const isFinal = idx === ticks.length - 1;
    const label = formatTime(t, { compact: true });
    const show =
      !isFinal ||
      (rightEdge < contentRight - 1 &&
        gx + ctx.measureText(label).width <= canvasW);
    if (show) {
      ctx.fillStyle = theme.muted;
      ctx.textAlign = "left";
      ctx.fillText(label, gx, headerTop + 14);
    }
  });
  ctx.textAlign = "left";

  const INSET = 6;

  const bannerDraws = banners
    .map((block) => {
      const start = parseTime(block.start);
      const end = parseTime(block.end);
      if (start == null || end == null || end <= start) return null;
      return { block, x: minutesToX(start), w: blockW(start, end) };
    })
    .filter((b): b is { block: Block; x: number; w: number } => b !== null);

  ctx.save();
  if (bannerDraws.length) {
    const top = lanesTop;
    const fullH = lanesBottom - lanesTop;
    ctx.beginPath();
    ctx.rect(gridLeft, top, section.trackW, fullH);
    for (const b of bannerDraws) ctx.rect(b.x, top, b.w, fullH);
    ctx.clip("evenodd");
  }
  day.lanes.forEach((_, i) => {
    const laneY = lanesTop + i * (layout.laneH + layout.laneGap);
    ctx.fillStyle = hexToRgba(theme.text, theme.laneBgAlpha);
    roundRect(ctx, gridLeft, laneY, section.trackW, layout.laneH, 8);
    ctx.fill();
  });
  ctx.restore();

  for (const { block, x: bx, w: bw } of bannerDraws) {
    drawBlock(
      ctx,
      block,
      bx,
      lanesTop + INSET,
      bw,
      lanesBottom - lanesTop - INSET * 2,
      theme.bannerColor,
      { center: true, hideEnd: true },
      twitchGlyph,
      theme,
      layout,
    );
  }

  day.lanes.forEach((lane, i) => {
    const laneY = lanesTop + i * (layout.laneH + layout.laneGap);
    const accent = lane.color || "#3c8ce2";
    for (const block of lane.blocks) {
      const start = parseTime(block.start);
      const end = parseTime(block.end);
      if (start == null || end == null || end <= start) continue;
      const highlighted =
        !!block.eventId && !!highlightEventIds?.has(block.eventId);
      const dimmed = highlightEventIds != null && !highlighted;
      drawBlock(
        ctx,
        block,
        minutesToX(start),
        laneY + INSET,
        blockW(start, end),
        layout.laneH - INSET * 2,
        accent,
        { highlighted, dimmed },
        twitchGlyph,
        theme,
        layout,
      );
    }
  });
}

// --- Top-level render function ------------------------------------------------

export interface RenderOpts {
  schedule: Schedule;
  measure: Measure;
  W: number;
  H: number;
  titleH: number;
  logoImg: ImageLike | null;
  twitchGlyph: TwitchGlypher;
  watermark?: boolean;
  visuals?: VisualSettings | null;
  // Per-entrant personalization (lanyards): blocks whose eventId is in this set
  // get a glowing emphasis, and `subtitle` (the entrant name) is drawn by the title.
  highlightEventIds?: Set<string>;
  subtitle?: string | null;
}

export function renderScheduleToContext(
  ctx: CanvasRenderingContext2D,
  opts: RenderOpts,
): void {
  const {
    schedule,
    measure: m,
    W,
    H,
    titleH: th,
    logoImg,
    twitchGlyph,
    watermark = true,
    highlightEventIds,
    subtitle,
    visuals,
  } = opts;

  const theme = resolveTheme(visuals);
  const layout = resolveLayout(visuals);

  ctx.fillStyle = theme.bg;

  ctx.fillRect(0, 0, W, H);

  const left = layout.pad;

  if (th > 0) {
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = theme.title;
    ctx.font = `800 40px ${theme.font}`;
    ctx.fillText(schedule.title || "Tournament", left, layout.pad + 40);
  }

  // Entrant name, top-right, inset to match the watermark.
  if (subtitle) {
    const wmMargin = layout.pad / 2 - 8;
    ctx.textBaseline = "top";
    ctx.textAlign = "right";
    ctx.font = `700 22px ${theme.font}`;
    ctx.fillStyle = theme.muted;
    ctx.fillText(subtitle, W - wmMargin, wmMargin);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  const contentRight = W - layout.pad;
  let y = layout.pad + th;
  schedule.days.forEach((day, i) => {
    const section = m.sections[i];
    const x = day.align === "right" ? contentRight - section.w : left;
    drawDaySection(ctx, day, x, y, section, W, twitchGlyph, highlightEventIds, theme, layout);
    y += section.h + layout.dayGap;
  });

  if (logoImg && schedule.logo && (logoImg.naturalWidth ?? logoImg.width) > 0) {
    const lw = (clamp(schedule.logo.size, 1, 100) / 100) * W;
    const lh =
      lw * ((logoImg.naturalHeight ?? logoImg.height) / (logoImg.naturalWidth ?? logoImg.width));
    const lx = (clamp(schedule.logo.x, 0, 100) / 100) * (W - lw);
    const ly = (clamp(schedule.logo.y, 0, 100) / 100) * (H - lh);
    ctx.drawImage(logoImg as never, lx, ly, lw, lh);
  }

  if (watermark) {
    const wmMargin = layout.pad / 2 - 8;
    ctx.font = `600 15px ${theme.font}`;
    ctx.fillStyle = hexToRgba(theme.text, theme.watermarkAlpha);
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("sched.gg", W - wmMargin, H - wmMargin);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
}
