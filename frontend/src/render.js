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
  gutterW: 170, // left column holding lane names
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

// Pixel size of a single day section (excludes the shared title).
function measureDaySection(day) {
  const { min, max } = dayTimeRange(day);
  const laneCount = Math.max(day.lanes.length, 1);
  const trackW = (max - min) * LAYOUT.pxPerMin;
  const w = LAYOUT.gutterW + trackW;
  const lanesH =
    laneCount * LAYOUT.laneH + (laneCount - 1) * LAYOUT.laneGap;
  const h = LAYOUT.subtitleH + LAYOUT.timeHeaderH + lanesH;
  return { w, h, min, max, trackW };
}

// Pixel dimensions for the whole schedule (all days stacked).
export function measureSchedule(schedule) {
  const days = schedule.days.length ? schedule.days : [];
  const sections = days.map(measureDaySection);
  const contentW = sections.reduce((acc, s) => Math.max(acc, s.w), 0);
  const stacked = sections.reduce((acc, s) => acc + s.h, 0);
  const width = LAYOUT.pad * 2 + Math.max(contentW, 400);
  const height =
    LAYOUT.pad * 2 +
    LAYOUT.titleH +
    stacked +
    Math.max(sections.length - 1, 0) * LAYOUT.dayGap;
  return { width, height, sections };
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
    gridLeft + (mins - section.min) * LAYOUT.pxPerMin;

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
    ctx.fillText(formatTime(t), gx, headerTop + 14);
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

    // Lane label in the left gutter.
    ctx.fillStyle = THEME.panel;
    roundRect(ctx, x, laneY, LAYOUT.gutterW - 14, LAYOUT.laneH, 8);
    ctx.fill();
    ctx.fillStyle = accent;
    roundRect(ctx, x, laneY, 6, LAYOUT.laneH, 3);
    ctx.fill();
    ctx.fillStyle = THEME.text;
    ctx.font = `700 18px ${THEME.font}`;
    const nameLines = wrapText(ctx, lane.name || "", LAYOUT.gutterW - 44, 2);
    let ny = laneY + LAYOUT.laneH / 2 - (nameLines.length - 1) * 11 + 6;
    for (const line of nameLines) {
      ctx.fillText(line, x + 18, ny);
      ny += 22;
    }

    // Blocks.
    for (const block of lane.blocks) {
      const start = parseTime(block.start);
      const end = parseTime(block.end);
      if (start == null || end == null || end <= start) continue;

      const bx = minutesToX(start);
      const w = Math.max((end - start) * LAYOUT.pxPerMin, 30);
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
      // Accent bar (left edge).
      ctx.fillStyle = accent;
      roundRect(ctx, bx, by, 5, bh, 2.5);
      ctx.fill();

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
        ellipsize(ctx, `${block.start}–${block.end}`, innerW),
        innerX,
        textY,
      );

      // Stream label badge (bottom of block).
      if (block.stream) {
        ctx.font = `600 12px ${THEME.font}`;
        const label = ellipsize(ctx, block.stream, innerW - 18);
        const tw = ctx.measureText(label).width;
        const badgeW = tw + 18;
        const badgeH = 22;
        const lbx = bx + 12;
        const lby = by + bh - badgeH - 8;
        if (lby > textY + 4) {
          ctx.fillStyle = accent;
          roundRect(ctx, lbx, lby, badgeW, badgeH, 11);
          ctx.fill();
          ctx.fillStyle = "#0e1220";
          ctx.fillText(label, lbx + 9, lby + 15);
        }
      }
    }
  });
}

// Render the whole schedule (all days stacked) to a canvas.
// `scale` controls export resolution.
export function renderSchedule(canvas, schedule, scale = 2) {
  const m = measureSchedule(schedule);
  const ctx = canvas.getContext("2d");

  canvas.width = Math.round(m.width * scale);
  canvas.height = Math.round(m.height * scale);
  // Display at logical size, but let CSS (max-width:100% + height:auto) scale it
  // down proportionally while preserving the aspect ratio.
  canvas.style.width = `${m.width}px`;
  canvas.style.height = "auto";
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // Background.
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, m.width, m.height);

  const left = LAYOUT.pad;

  // Shared tournament title.
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = THEME.title;
  ctx.font = `800 40px ${THEME.font}`;
  ctx.fillText(schedule.title || "Tournament", left, LAYOUT.pad + 40);

  // Day sections, stacked.
  let y = LAYOUT.pad + LAYOUT.titleH;
  schedule.days.forEach((day, i) => {
    const section = m.sections[i];
    drawDaySection(ctx, day, left, y, section);
    y += section.h + LAYOUT.dayGap;
  });

  return m;
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
