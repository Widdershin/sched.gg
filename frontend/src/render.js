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

const LAYOUT = {
  pad: 48,
  titleH: 64,
  subtitleH: 34,
  laneHeaderH: 48,
  gutterW: 70,
  laneGap: 14,
  minLaneW: 180,
  pxPerMin: 2.4, // vertical scale
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

// Compute the pixel dimensions needed to render a day.
export function measureDay(schedule, day) {
  const { min, max } = dayTimeRange(day);
  const laneCount = Math.max(day.lanes.length, 1);
  const trackH = (max - min) * LAYOUT.pxPerMin;
  const laneW = LAYOUT.minLaneW;
  const width =
    LAYOUT.pad * 2 +
    LAYOUT.gutterW +
    laneCount * laneW +
    (laneCount - 1) * LAYOUT.laneGap;
  const height =
    LAYOUT.pad * 2 +
    LAYOUT.titleH +
    LAYOUT.subtitleH +
    LAYOUT.laneHeaderH +
    trackH;
  return { width, height, min, max, laneW, trackH };
}

// Render a single day to a canvas. `scale` controls export resolution.
export function renderDay(canvas, schedule, day, scale = 2) {
  const m = measureDay(schedule, day);
  const ctx = canvas.getContext("2d");

  canvas.width = Math.round(m.width * scale);
  canvas.height = Math.round(m.height * scale);
  canvas.style.width = `${m.width}px`;
  canvas.style.height = `${m.height}px`;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // Background.
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, m.width, m.height);

  const left = LAYOUT.pad;
  let top = LAYOUT.pad;

  // Title.
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = THEME.title;
  ctx.font = `700 40px ${THEME.font}`;
  ctx.fillText(schedule.title || "Tournament", left, top + 40);
  top += LAYOUT.titleH;

  // Day subtitle.
  ctx.fillStyle = THEME.muted;
  ctx.font = `600 22px ${THEME.font}`;
  ctx.fillText(day.name || "", left, top + 22);
  top += LAYOUT.subtitleH;

  const gridTop = top + LAYOUT.laneHeaderH;
  const gridLeft = left + LAYOUT.gutterW;
  const minutesToY = (minutes) => gridTop + (minutes - m.min) * LAYOUT.pxPerMin;

  // Hour gridlines + time labels in the gutter.
  ctx.font = `500 14px ${THEME.font}`;
  for (let t = m.min; t <= m.max; t += 60) {
    const y = minutesToY(t);
    ctx.strokeStyle = THEME.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gridLeft, y);
    ctx.lineTo(m.width - LAYOUT.pad, y);
    ctx.stroke();

    ctx.fillStyle = THEME.muted;
    ctx.textAlign = "right";
    ctx.fillText(formatTime(t), gridLeft - 12, y + 5);
    ctx.textAlign = "left";
  }

  // Lanes.
  day.lanes.forEach((lane, i) => {
    const laneX = gridLeft + i * (m.laneW + LAYOUT.laneGap);
    const accent = lane.color || "#3c8ce2";

    // Lane header.
    ctx.fillStyle = THEME.panel;
    roundRect(ctx, laneX, top, m.laneW, LAYOUT.laneHeaderH - 8, 8);
    ctx.fill();
    ctx.fillStyle = accent;
    roundRect(ctx, laneX, top, 6, LAYOUT.laneHeaderH - 8, 3);
    ctx.fill();
    ctx.fillStyle = THEME.text;
    ctx.font = `700 18px ${THEME.font}`;
    const headerLines = wrapText(ctx, lane.name || "", m.laneW - 26, 1);
    ctx.fillText(headerLines[0] || "", laneX + 16, top + 26);

    // Blocks.
    for (const block of lane.blocks) {
      const start = parseTime(block.start);
      const end = parseTime(block.end);
      if (start == null || end == null || end <= start) continue;

      const y = minutesToY(start);
      const h = Math.max((end - start) * LAYOUT.pxPerMin, 26);

      // Block body.
      ctx.fillStyle = hexToRgba(accent, 0.18);
      roundRect(ctx, laneX, y, m.laneW, h, LAYOUT.blockRadius);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(accent, 0.85);
      ctx.lineWidth = 1.5;
      roundRect(ctx, laneX, y, m.laneW, h, LAYOUT.blockRadius);
      ctx.stroke();
      // Accent bar.
      ctx.fillStyle = accent;
      roundRect(ctx, laneX, y, 5, h, 2.5);
      ctx.fill();

      const innerX = laneX + 16;
      const innerW = m.laneW - 28;
      let textY = y + 22;

      // Block name (wrapped, height-aware).
      ctx.fillStyle = THEME.text;
      ctx.font = `700 16px ${THEME.font}`;
      const maxNameLines = h > 64 ? 2 : 1;
      const nameLines = wrapText(ctx, block.name || "", innerW, maxNameLines);
      for (const line of nameLines) {
        ctx.fillText(line, innerX, textY);
        textY += 20;
      }

      // Time range.
      if (h > 40) {
        ctx.fillStyle = THEME.muted;
        ctx.font = `500 13px ${THEME.font}`;
        ctx.fillText(`${block.start}–${block.end}`, innerX, textY);
      }

      // Stream label badge (bottom-right).
      if (block.stream) {
        ctx.font = `600 12px ${THEME.font}`;
        const label = block.stream;
        const tw = ctx.measureText(label).width;
        const badgeW = tw + 18;
        const badgeH = 22;
        const bx = laneX + m.laneW - badgeW - 8;
        const by = y + h - badgeH - 8;
        if (badgeH + 16 < h) {
          ctx.fillStyle = accent;
          roundRect(ctx, bx, by, badgeW, badgeH, 11);
          ctx.fill();
          ctx.fillStyle = "#0e1220";
          ctx.fillText(label, bx + 9, by + 15);
        }
      }
    }
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
