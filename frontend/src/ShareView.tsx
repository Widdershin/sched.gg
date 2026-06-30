import { useEffect, useRef, useState } from "react";
import { renderSchedule, onAssetsReady } from "./render";
import { api } from "./api";
import type { OutputSettings, SharedSchedule } from "./types";

// Resolve an output settings object into a numeric aspect ratio (or null = fit).
function resolveRatio(output: OutputSettings | null): number | null {
  const mode = output?.mode ?? "fit";
  if (mode === "fit") return null;
  if (mode === "custom") {
    const r = Number(output!.w) / Number(output!.h);
    return Number.isFinite(r) && r > 0 ? r : null;
  }
  const [w, h] = String(mode).split(":").map(Number);
  return w / h;
}

type ShareState =
  | { status: "loading" }
  | { status: "error" }
  | ({ status: "ok" } & SharedSchedule);

export default function ShareView({ token }: { token: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<ShareState>({ status: "loading" });
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);
  const [bgSrc, setBgSrc] = useState<string | null>(null);
  const [assetTick, setAssetTick] = useState(0);
  useEffect(() => onAssetsReady(() => setAssetTick((n) => n + 1)), []);

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

  // Fetch the logo blob if the shared schedule has one.
  useEffect(() => {
    if (state.status !== "ok" || !state.data.logo) return;
    let cancelled = false;
    let blobUrl: string | null = null;
    api
      .getSharedLogoBlob(token)
      .then((blob) => {
        if (cancelled || !blob) return;
        blobUrl = URL.createObjectURL(blob);
        setLogoSrc(blobUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [state.status, token]);

  useEffect(() => {
    if (!logoSrc) {
      setLogoImg(null);
      return;
    }
    const img = new Image();
    img.onload = () => setLogoImg(img);
    img.src = logoSrc;
  }, [logoSrc]);

  // Fetch the background blob if the shared schedule has one.
  useEffect(() => {
    if (state.status !== "ok" || !state.data.background) return;
    let cancelled = false;
    let blobUrl: string | null = null;
    api
      .getSharedBackgroundBlob(token)
      .then((blob) => {
        if (cancelled || !blob) return;
        blobUrl = URL.createObjectURL(blob);
        setBgSrc(blobUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [state.status, token]);

  useEffect(() => {
    if (!bgSrc) {
      setBgImg(null);
      return;
    }
    const img = new Image();
    img.onload = () => setBgImg(img);
    img.src = bgSrc;
  }, [bgSrc]);

  // Render whenever data / logo are ready.
  useEffect(() => {
    if (state.status !== "ok" || !canvasRef.current) return;
    const data = logoSrc && state.data.logo
      ? { ...state.data, logo: { ...state.data.logo, src: logoSrc } }
      : state.data;
    const scale = state.output?.scale ?? 2;
    const bg = state.data.background;
    renderSchedule(
      canvasRef.current,
      data,
      scale,
      resolveRatio(state.output),
      logoImg,
      {
        background:
          bgImg && bg
            ? {
                mode: "image",
                image: bgImg,
                fit: bg.fit ?? "cover",
                opacity: bg.opacity ?? 100,
                blur: bg.blur ?? 0,
                darken: bg.darken ?? 0,
              }
            : { mode: "theme" },
      },
      state.output?.visuals,
    );
  }, [state, logoImg, bgImg, assetTick, logoSrc, bgSrc]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas || state.status !== "ok") return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = (s: string | undefined) =>
        (s || "schedule").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      a.href = url;
      a.download = `${safe(state.data.title || state.name)}-schedule.png`;
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
