import React, { useEffect, useRef, useState } from "react";
import { renderSchedule } from "./render.js";
import { api } from "./api.js";

// Resolve an output settings object into a numeric aspect ratio (or null = fit).
function resolveRatio(output) {
  const mode = output?.mode ?? "fit";
  if (mode === "fit") return null;
  if (mode === "custom") {
    const r = Number(output.w) / Number(output.h);
    return Number.isFinite(r) && r > 0 ? r : null;
  }
  const [w, h] = String(mode).split(":").map(Number);
  return w / h;
}

export default function ShareView({ token }) {
  const canvasRef = useRef(null);
  const [state, setState] = useState({ status: "loading" });
  const [logoImg, setLogoImg] = useState(null);

  // Fetch the shared schedule once.
  useEffect(() => {
    let cancelled = false;
    api
      .getShared(token)
      .then((res) => {
        if (!cancelled) setState({ status: "ok", ...res });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const logoSrc = state.data?.logo?.src;
  useEffect(() => {
    if (!logoSrc) {
      setLogoImg(null);
      return;
    }
    const img = new Image();
    img.onload = () => setLogoImg(img);
    img.src = logoSrc;
  }, [logoSrc]);

  // Render whenever data / logo are ready.
  useEffect(() => {
    if (state.status !== "ok" || !canvasRef.current) return;
    const scale = state.output?.scale ?? 2;
    renderSchedule(
      canvasRef.current,
      state.data,
      scale,
      resolveRatio(state.output),
      logoImg,
    );
  }, [state, logoImg]);

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
      a.download = `${safe(state.data?.title || state.name)}-schedule.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  if (state.status === "loading") {
    return <div className="share-view share-message">Loading…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="share-view share-message">
        This share link is invalid or has been revoked.
      </div>
    );
  }

  return (
    <div className="share-view">
      <header className="share-header">
        <div className="brand">
          <span className="brand-mark">sched.gg</span>
          <span className="brand-sub">{state.name}</span>
        </div>
        <button className="btn primary" onClick={download}>
          Download PNG
        </button>
      </header>
      <div className="canvas-scroll">
        <canvas ref={canvasRef} className="schedule-canvas" />
      </div>
    </div>
  );
}
