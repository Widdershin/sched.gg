import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { useAuth } from "./AuthContext";
import { renderSchedule, onAssetsReady } from "./render";
import { generateLanyardsZip } from "./lanyards";
import type { Entrant, OutputSettings, Schedule } from "./types";

const DEFAULT_OUTPUT: OutputSettings = { mode: "fit", w: 16, h: 9, scale: 2 };

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

function formatSynced(ts: number | null): string {
  if (!ts) return "never";
  return new Date(ts).toLocaleString();
}

export default function LanyardsPage({ scheduleId }: { scheduleId: string | null }) {
  const auth = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [output, setOutput] = useState<OutputSettings>(DEFAULT_OUTPUT);
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);
  const [entrants, setEntrants] = useState<Entrant[]>([]);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const [assetTick, setAssetTick] = useState(0);
  useEffect(() => onAssetsReady(() => setAssetTick((n) => n + 1)), []);

  // Load the schedule, its logo, and the persisted entrants.
  useEffect(() => {
    if (auth.loading) return;
    if (!auth.user || !scheduleId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    let blobUrl: string | null = null;
    (async () => {
      try {
        const full = await api.getSchedule(scheduleId);
        if (cancelled) return;
        const data = full.data;
        if (full.output) setOutput(full.output);
        // Load the logo (its src is stripped server-side).
        if (data.logo) {
          try {
            const blob = await api.getLogoBlob(scheduleId);
            if (blob && !cancelled) {
              blobUrl = URL.createObjectURL(blob);
              data.logo.src = blobUrl;
              const img = new Image();
              img.onload = () => !cancelled && setLogoImg(img);
              img.src = blobUrl;
            }
          } catch {
            /* draw without logo */
          }
        }
        setSchedule(data);
        const res = await api.getEntrants(scheduleId);
        if (cancelled) return;
        setEntrants(res.entrants);
        setSyncedAt(res.syncedAt);
        setSelectedId(res.entrants[0]?.id ?? null);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [auth.loading, auth.user, scheduleId]);

  const selected = useMemo(
    () => entrants.find((e) => e.id === selectedId) ?? null,
    [entrants, selectedId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entrants;
    return entrants.filter((e) => e.gamerTag.toLowerCase().includes(q));
  }, [entrants, search]);

  // Render the selected entrant's personalized preview.
  useEffect(() => {
    if (!schedule || !canvasRef.current) return;
    renderSchedule(
      canvasRef.current,
      schedule,
      output.scale,
      resolveRatio(output),
      logoImg,
      selected
        ? { highlightEventIds: new Set(selected.eventIds), subtitle: selected.gamerTag }
        : {},
    );
  }, [schedule, output, logoImg, selected, assetTick]);

  const syncEntrants = async () => {
    if (!scheduleId) return;
    setSyncing(true);
    setActionError(null);
    try {
      const res = await api.syncEntrants(scheduleId);
      setEntrants(res.entrants);
      setSyncedAt(res.syncedAt);
      if (!res.entrants.some((e) => e.id === selectedId)) {
        setSelectedId(res.entrants[0]?.id ?? null);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const generate = async () => {
    if (!schedule || entrants.length === 0) return;
    setGenerating(true);
    setActionError(null);
    setProgress({ done: 0, total: entrants.length });
    try {
      await generateLanyardsZip({
        schedule,
        output,
        logoImg,
        entrants,
        onProgress: (done, total) => setProgress({ done, total }),
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  // --- Gating states ---------------------------------------------------------
  if (auth.loading || !loaded) {
    return <Shell><p className="empty">Loading…</p></Shell>;
  }
  if (!auth.user) {
    return (
      <Shell>
        <p className="empty">
          Please <a href="/">sign in</a> to generate lanyards.
        </p>
      </Shell>
    );
  }
  if (!scheduleId) {
    return (
      <Shell>
        <p className="empty">No schedule selected. <a href="/">Back to editor</a>.</p>
      </Shell>
    );
  }
  if (loadError) {
    return (
      <Shell>
        <p className="warn">{loadError}</p>
        <p><a href="/">Back to editor</a></p>
      </Shell>
    );
  }

  const slug = schedule?.startgg?.slug;

  return (
    <Shell title={schedule?.title}>
      {!slug ? (
        <p className="empty">
          This schedule isn't linked to a start.gg tournament yet. Set the
          tournament slug in the <a href="/">editor</a> first.
        </p>
      ) : !auth.startggLinked ? (
        <p className="empty">
          <a href={api.startggLoginUrl()}>Sign in with start.gg</a> to fetch
          entrants.
        </p>
      ) : (
        <>
          <div className="lanyard-toolbar">
            <button className="btn ghost" onClick={syncEntrants} disabled={syncing}>
              {syncing
                ? "Fetching…"
                : entrants.length
                  ? "Re-fetch entrants"
                  : "Fetch entrants"}
            </button>
            <span className="startgg-hint">
              {entrants.length} entrants · last synced {formatSynced(syncedAt)}
            </span>
            <button
              className="btn primary push-right"
              onClick={generate}
              disabled={generating || entrants.length === 0}
            >
              {generating && progress
                ? `Generating ${progress.done}/${progress.total}…`
                : "Generate all (zip)"}
            </button>
          </div>
          {actionError && <p className="warn">{actionError}</p>}

          <div className="lanyard-body" style={{ display: "flex", gap: 16 }}>
            <div className="lanyard-list" style={{ flex: "0 0 240px" }}>
              <input
                className="startgg-slug"
                style={{ width: "100%", marginBottom: 8 }}
                placeholder="Search entrants…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: "70vh", overflow: "auto" }}>
                {filtered.map((e) => (
                  <li key={e.id}>
                    <button
                      className={`btn ghost${e.id === selectedId ? " active" : ""}`}
                      style={{ width: "100%", textAlign: "left", justifyContent: "flex-start" }}
                      onClick={() => setSelectedId(e.id)}
                    >
                      {e.gamerTag || "(no tag)"}{" "}
                      <span className="startgg-hint">· {e.eventIds.length}</span>
                    </button>
                  </li>
                ))}
                {filtered.length === 0 && <li className="empty">No entrants.</li>}
              </ul>
            </div>
            <div className="canvas-scroll" style={{ flex: 1 }}>
              <canvas ref={canvasRef} className="schedule-canvas" />
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">sched.gg</span>
          <span className="brand-sub">lanyards{title ? ` · ${title}` : ""}</span>
        </div>
        <a className="btn ghost push-right" href="/">
          ← Back to editor
        </a>
      </header>
      <main className="workspace" style={{ display: "block", padding: 16 }}>
        {children}
      </main>
    </div>
  );
}
