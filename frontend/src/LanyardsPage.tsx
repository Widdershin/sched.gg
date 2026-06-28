import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { useAuth } from "./AuthContext";
import { generateLanyardsZip } from "./lanyards";
import LanyardDesigner from "./LanyardDesigner";
import { defaultDesign } from "../../shared/lanyard.js";
import type { Entrant, LanyardDesign, OutputSettings, Schedule } from "./types";

const DEFAULT_OUTPUT: OutputSettings = { mode: "fit", w: 16, h: 9, scale: 2 };
const SAVE_DEBOUNCE_MS = 800;

function formatSynced(ts: number | null): string {
  if (!ts) return "never";
  return new Date(ts).toLocaleString();
}

export default function LanyardsPage({ scheduleId }: { scheduleId: string | null }) {
  const auth = useAuth();

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

  // Suppress the autosave that would otherwise fire from the initial load.
  const loadedScheduleRef = useRef(false);

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
        if (!data.lanyard) data.lanyard = defaultDesign();
        setSchedule(data);
        loadedScheduleRef.current = true;
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

  // Apply a mutation to a fresh clone of the schedule (mirrors App.tsx).
  const update = (mutator: (s: Schedule) => void) =>
    setSchedule((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      mutator(next);
      return next;
    });

  // Edit the lanyard design in place.
  const updateDesign = (mutator: (d: LanyardDesign) => void) =>
    update((s) => {
      if (s.lanyard) mutator(s.lanyard);
    });

  // Debounced server autosave of the design (data only). Strip the logo blob src
  // (the PNG lives in the dedicated logo endpoint), like App.tsx.
  useEffect(() => {
    if (!scheduleId || !schedule || !loadedScheduleRef.current) return;
    const t = setTimeout(() => {
      const clean = structuredClone(schedule);
      if (clean.logo) delete (clean.logo as unknown as Record<string, unknown>).src;
      api.updateSchedule(scheduleId, { data: clean }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [schedule, scheduleId]);

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

  const runGenerate = async (list: Entrant[], zipName?: string) => {
    if (!schedule || !schedule.lanyard || list.length === 0) return;
    setGenerating(true);
    setActionError(null);
    setProgress({ done: 0, total: list.length });
    try {
      await generateLanyardsZip({
        schedule,
        design: schedule.lanyard,
        output,
        logoImg,
        entrants: list,
        zipName,
        onProgress: (done, total) => setProgress({ done, total }),
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  const generate = () => runGenerate(entrants);
  const generateSelected = () => {
    if (!selected) return;
    const name =
      (selected.gamerTag || "lanyard")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "lanyard";
    runGenerate([selected], `lanyard-${name}`);
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
              className="btn ghost push-right"
              onClick={generateSelected}
              disabled={generating || !selected}
              title="Download just the selected entrant's lanyard"
            >
              Generate selected
            </button>
            <button
              className="btn primary"
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
              {schedule?.lanyard && (
                <LanyardDesigner
                  design={schedule.lanyard}
                  update={updateDesign}
                  schedule={schedule}
                  output={output}
                  logoImg={logoImg}
                  selectedEntrant={selected}
                />
              )}
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
