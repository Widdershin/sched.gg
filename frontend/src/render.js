import { dayTimeRange, parseTime, formatTime } from "./model.js";

// Visual theme for the rendered schedule image.
const THEME = {
  bg: "#0e1220",
  panel: "#161c2e",
  grid: "#252c42",
  text: "#f5f7fb",
  muted: "#8c95ad",
  title: "#ffffff",
  font: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
};

// Horizontal layout: time runs left→right, lanes are stacked rows. Days are
// stacked vertically into a single image, sharing one title at the top.
const LAYOUT = {
  pad: 48,
  titleH: 70, // shared tournament title block at the top
  subtitleH: 38, // per-day name
  timeHeaderH: 36,
  gutterW: 0, // no left gutter (lanes are distinguished by block colour)
  laneH: 92,
  laneGap: 12,
  dayGap: 40, // vertical space between day sections
  pxPerMin: 3.2, // horizontal scale
  blockRadius: 10,
};

// Rounded rectangle path helper.
function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// Wrap text to a max width, returning an array of lines (capped).
function wrapText(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
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

// Truncate a single line with an ellipsis to fit a width.
function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

// Pixel size of a single day section (excludes the shared title). `hScale`
// compresses only the time axis, so blocks change width while text, block
// heights and corner radii keep their natural proportions.
function measureDaySection(day, hScale = 1) {
  const { min, max } = dayTimeRange(day);
  const laneCount = Math.max(day.lanes.length, 1);
  const pxPerMin = LAYOUT.pxPerMin * hScale;
  const trackW = (max - min) * pxPerMin;
  const w = LAYOUT.gutterW + trackW;
  const lanesH =
    laneCount * LAYOUT.laneH + (laneCount - 1) * LAYOUT.laneGap;
  const h = LAYOUT.subtitleH + LAYOUT.timeHeaderH + lanesH;
  return { w, h, min, max, trackW, pxPerMin };
}

// Pixel dimensions for the whole schedule (all days stacked). `hScale` only
// affects horizontal (time) sizing; height is unaffected.
export function measureSchedule(schedule, hScale = 1) {
  const days = schedule.days.length ? schedule.days : [];
  const sections = days.map((d) => measureDaySection(d, hScale));
  const contentW = sections.reduce((acc, s) => Math.max(acc, s.w), 0);
  const stacked = sections.reduce((acc, s) => acc + s.h, 0);
  // Only floor the width for an empty schedule; otherwise honour the (possibly
  // compressed) content width so aspect-ratio fitting can reach narrow targets.
  const width = LAYOUT.pad * 2 + (sections.length ? contentW : 400);
  const height =
    LAYOUT.pad * 2 +
    titleHeight(schedule) +
    stacked +
    Math.max(sections.length - 1, 0) * LAYOUT.dayGap;
  return { width, height, sections };
}

// The title (and its reserved whitespace) is hidden when a logo is present.
function titleHeight(schedule) {
  return schedule.logo?.src ? 0 : LAYOUT.titleH;
}

// Draw one day section with its top-left at (x, y). Time range is per-day.
function drawDaySection(ctx, day, x, y, section) {
  const gridLeft = x + LAYOUT.gutterW;
  const headerTop = y + LAYOUT.subtitleH;
  const lanesTop = headerTop + LAYOUT.timeHeaderH;
  const laneCount = Math.max(day.lanes.length, 1);
  const lanesBottom =
    lanesTop + laneCount * LAYOUT.laneH + (laneCount - 1) * LAYOUT.laneGap;
  const minutesToX = (mins) =>
    gridLeft + (mins - section.min) * section.pxPerMin;

  // Day name.
  ctx.fillStyle = THEME.text;
  ctx.textAlign = "left";
  ctx.font = `700 24px ${THEME.font}`;
  ctx.fillText(day.name || "", x, y + 24);

  // Hour gridlines (vertical) + time labels along the top.
  ctx.font = `500 14px ${THEME.font}`;
  for (let t = section.min; t <= section.max; t += 60) {
    const gx = minutesToX(t);
    ctx.strokeStyle = THEME.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gx, headerTop + 20);
    ctx.lineTo(gx, lanesBottom);
    ctx.stroke();

    ctx.fillStyle = THEME.muted;
    ctx.textAlign = "center";
    ctx.fillText(formatTime(t, { compact: true }), gx, headerTop + 14);
  }
  ctx.textAlign = "left";

  // Lanes (rows).
  day.lanes.forEach((lane, i) => {
    const laneY = lanesTop + i * (LAYOUT.laneH + LAYOUT.laneGap);
    const accent = lane.color || "#3c8ce2";

    // Row background spanning the time track.
    ctx.fillStyle = hexToRgba("#ffffff", 0.02);
    roundRect(ctx, gridLeft, laneY, section.trackW, LAYOUT.laneH, 8);
    ctx.fill();

    // Blocks.
    for (const block of lane.blocks) {
      const start = parseTime(block.start);
      const end = parseTime(block.end);
      if (start == null || end == null || end <= start) continue;

      const bx = minutesToX(start);
      const w = Math.max((end - start) * section.pxPerMin, 30);
      const by = laneY + 6;
      const bh = LAYOUT.laneH - 12;

      // Block body.
      ctx.fillStyle = hexToRgba(accent, 0.2);
      roundRect(ctx, bx, by, w, bh, LAYOUT.blockRadius);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(accent, 0.85);
      ctx.lineWidth = 1.5;
      roundRect(ctx, bx, by, w, bh, LAYOUT.blockRadius);
      ctx.stroke();

      const innerX = bx + 14;
      const innerW = w - 22;
      if (innerW < 24) continue; // too narrow for any text

      // Block name (wrapped).
      ctx.fillStyle = THEME.text;
      ctx.font = `700 16px ${THEME.font}`;
      const nLines = wrapText(ctx, block.name || "", innerW, 2);
      let textY = by + 22;
      for (const line of nLines) {
        ctx.fillText(line, innerX, textY);
        textY += 19;
      }

      // Time range.
      ctx.fillStyle = THEME.muted;
      ctx.font = `500 13px ${THEME.font}`;
      ctx.fillText(
        ellipsize(
          ctx,
          `${formatTime(start, { compact: true })}–${formatTime(end, {
            compact: true,
          })}`,
          innerW,
        ),
        innerX,
        textY,
      );

      // Stream label badges (bottom of block). Primary is a solid accent pill;
      // the secondary is an outlined pill so the two read distinctly.
      const streams = [block.stream, block.stream2].filter(Boolean);
      if (streams.length) {
        ctx.font = `600 12px ${THEME.font}`;
        const badgeH = 22;
        const lby = by + bh - badgeH - 8;
        const rightEdge = bx + w - 8;
        let lbx = bx + 12;
        if (lby > textY + 4) {
          streams.forEach((text, idx) => {
            const avail = rightEdge - lbx - 18;
            if (avail < 16) return; // no room left for another pill
            const label = ellipsize(ctx, text, avail);
            const badgeW = ctx.measureText(label).width + 18;
            if (idx === 0) {
              ctx.fillStyle = accent;
              roundRect(ctx, lbx, lby, badgeW, badgeH, 11);
              ctx.fill();
              ctx.fillStyle = "#0e1220";
            } else {
              roundRect(ctx, lbx, lby, badgeW, badgeH, 11);
              ctx.strokeStyle = accent;
              ctx.lineWidth = 1.5;
              ctx.stroke();
              ctx.fillStyle = accent;
            }
            ctx.fillText(label, lbx + 9, lby + 15);
            lbx += badgeW + 6;
          });
        }
      }
    }
  });
}

// Render the whole schedule (all days stacked) to a canvas.
// `scale` controls export resolution. `aspectRatio` (width/height) forces the
// canvas to that ratio by keeping the content's natural height and compressing
// (or stretching) the time axis so blocks change width — text, block heights and
// radii keep their proportions. Pass null to size tightly to the content.
export function renderSchedule(
  canvas,
  schedule,
  scale = 2,
  aspectRatio = null,
  logoImg = null,
) {
  const ctx = canvas.getContext("2d");

  // Natural layout, then solve for the time-axis factor that makes the content
  // width match the target ratio (height is independent of the factor).
  const base = measureSchedule(schedule, 1);
  let hScale = 1;
  if (aspectRatio && aspectRatio > 0) {
    const targetW = base.height * aspectRatio;
    const baseTrackMax = Math.max(...base.sections.map((s) => s.trackW), 1);
    const targetTrack = targetW - LAYOUT.pad * 2 - LAYOUT.gutterW;
    hScale = targetTrack / baseTrackMax;
    if (!Number.isFinite(hScale) || hScale <= 0) hScale = 0.05;
  }

  const m = hScale === 1 ? base : measureSchedule(schedule, hScale);
  const W = m.width;
  const H = m.height;

  // Only resize the backing buffer when it actually changes — reallocating it
  // is expensive, and many edits (text, logo position) don't alter dimensions.
  const dw = Math.round(W * scale);
  const dh = Math.round(H * scale);
  if (canvas.width !== dw) canvas.width = dw;
  if (canvas.height !== dh) canvas.height = dh;
  // Display at logical size, but let CSS (max-width:100% + height:auto) scale it
  // down proportionally while preserving the aspect ratio.
  canvas.style.width = `${W}px`;
  canvas.style.height = "auto";
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // Background (also clears the previous frame when the buffer wasn't resized).
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, H);

  const left = LAYOUT.pad;
  const titleH = titleHeight(schedule);

  // Shared tournament title (hidden when a logo replaces it).
  if (titleH > 0) {
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = THEME.title;
    ctx.font = `800 40px ${THEME.font}`;
    ctx.fillText(schedule.title || "Tournament", left, LAYOUT.pad + 40);
  }

  // Day sections, stacked. Right-aligned days hug the right content edge.
  const contentRight = W - LAYOUT.pad;
  let y = LAYOUT.pad + titleH;
  schedule.days.forEach((day, i) => {
    const section = m.sections[i];
    const x = day.align === "right" ? contentRight - section.w : left;
    drawDaySection(ctx, day, x, y, section);
    y += section.h + LAYOUT.dayGap;
  });

  // Logo overlay. Positioned as a percentage of the free space so it stays in
  // bounds; size is a percentage of the canvas width, aspect preserved.
  const logo = schedule.logo;
  if (logoImg && logo?.src && logoImg.naturalWidth > 0) {
    const lw = (clamp(logo.size, 1, 100) / 100) * W;
    const lh = lw * (logoImg.naturalHeight / logoImg.naturalWidth);
    const lx = (clamp(logo.x, 0, 100) / 100) * (W - lw);
    const ly = (clamp(logo.y, 0, 100) / 100) * (H - lh);
    ctx.drawImage(logoImg, lx, ly, lw, lh);
  }

  return m;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, Number(v) || 0));
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
