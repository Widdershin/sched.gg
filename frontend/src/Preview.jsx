import React, { useEffect, useRef, useState } from "react";
import { renderSchedule } from "./render.js";

export default function Preview({ schedule }) {
  const canvasRef = useRef(null);
  const [scale, setScale] = useState(2);

  useEffect(() => {
    if (canvasRef.current) {
      renderSchedule(canvasRef.current, schedule, scale);
    }
  }, [schedule, scale]);

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

  const dayCount = schedule.days.length;

  return (
    <div className="preview">
      <div className="preview-toolbar">
        <span className="preview-label">
          Preview · {dayCount} {dayCount === 1 ? "day" : "days"}
        </span>
        <label className="scale-field">
          Resolution
          <select
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
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
