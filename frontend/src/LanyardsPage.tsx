import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { useAuth } from "./AuthContext";
import { generateLanyardsZip, type LanyardFormat } from "./lanyards";
import LanyardDesigner from "./LanyardDesigner";
import { defaultDesign, entrantName } from "../../shared/lanyard.js";
import { fileToImageDataUrl } from "./images";
import type { Entrant, LanyardDesign, OutputSettings, Schedule } from "./types";

const DEFAULT_ROLE = "Competitor";

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
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);
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
  const [format, setFormat] = useState<LanyardFormat>("png");

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
    let bgBlobUrl: string | null = null;
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
        // Load the custom background (its src is stripped server-side).
        if (data.background) {
          try {
            const blob = await api.getBackgroundBlob(scheduleId);
            if (blob && !cancelled) {
              bgBlobUrl = URL.createObjectURL(blob);
              data.background.src = bgBlobUrl;
              const img = new Image();
              img.onload = () => !cancelled && setBgImg(img);
              img.src = bgBlobUrl;
            }
          } catch {
            /* draw without background */
          }
        }
        if (!data.lanyard) data.lanyard = defaultDesign();
        if (!data.roles || data.roles.length === 0) data.roles = [DEFAULT_ROLE];
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
      if (bgBlobUrl) URL.revokeObjectURL(bgBlobUrl);
    };
  }, [auth.loading, auth.user, scheduleId]);

  const selected = useMemo(
    () => entrants.find((e) => e.id === selectedId) ?? null,
    [entrants, selectedId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entrants;
    return entrants.filter((e) => entrantName(e).toLowerCase().includes(q));
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
      if (clean.background) delete (clean.background as unknown as Record<string, unknown>).src;
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
        bgImg,
        entrants: list,
        zipName,
        format,
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
      entrantName(selected)
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "lanyard";
    runGenerate([selected], `lanyard-${name}`);
  };

  // --- Players (custom name + manual entrants) -------------------------------
  const renameEntrant = (pid: string, name: string) => {
    if (!scheduleId) return;
    const clean = name.trim();
    setEntrants((prev) =>
      prev.map((e) => (e.id === pid ? { ...e, name: clean || undefined } : e)),
    );
    api.setEntrantName(scheduleId, pid, clean).catch((e) => {
      setActionError(e instanceof Error ? e.message : String(e));
    });
  };

  const addPlayer = async (name: string) => {
    if (!scheduleId) return;
    const clean = name.trim();
    if (!clean) return;
    try {
      const { entrant } = await api.addManualEntrant(scheduleId, { name: clean });
      setEntrants((prev) => [...prev, entrant]);
      setSelectedId(entrant.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const deletePlayer = (pid: string) => {
    if (!scheduleId) return;
    setEntrants((prev) => prev.filter((e) => e.id !== pid));
    if (selectedId === pid) setSelectedId(null);
    api.deleteEntrant(scheduleId, pid).catch((e) => {
      setActionError(e instanceof Error ? e.message : String(e));
    });
  };

  // --- Roles -----------------------------------------------------------------
  const roles = schedule?.roles ?? [DEFAULT_ROLE];

  const assignRole = (pid: string, role: string) => {
    if (!scheduleId) return;
    setEntrants((prev) =>
      prev.map((e) => (e.id === pid ? { ...e, role } : e)),
    );
    api.setEntrantRole(scheduleId, pid, role).catch((e) => {
      setActionError(e instanceof Error ? e.message : String(e));
    });
  };

  const addRole = (name: string) => {
    const r = name.trim();
    if (!r || roles.includes(r)) return;
    update((s) => {
      s.roles = [...(s.roles ?? [DEFAULT_ROLE]), r];
    });
  };

  const deleteRole = (name: string) => {
    if (name === DEFAULT_ROLE || !scheduleId) return;
    update((s) => {
      s.roles = (s.roles ?? [DEFAULT_ROLE]).filter((r) => r !== name);
      if (s.lanyard?.roleImages) delete s.lanyard.roleImages[name];
    });
    setEntrants((prev) =>
      prev.map((e) => (e.role === name ? { ...e, role: DEFAULT_ROLE } : e)),
    );
    api.reassignRole(scheduleId, name, DEFAULT_ROLE).catch((e) => {
      setActionError(e instanceof Error ? e.message : String(e));
    });
  };

  const setRoleImage = async (name: string, file: File | undefined) => {
    if (!file) return;
    try {
      const src = await fileToImageDataUrl(file);
      update((s) => {
        if (s.lanyard) {
          s.lanyard.roleImages = { ...(s.lanyard.roleImages ?? {}), [name]: src };
        }
      });
    } catch {
      setActionError("Could not load that image.");
    }
  };

  const clearRoleImage = (name: string) =>
    update((s) => {
      if (s.lanyard?.roleImages) delete s.lanyard.roleImages[name];
    });

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
            <label className="scale-field push-right">
              Format
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as LanyardFormat)}
                disabled={generating}
                title="PNG: front/back images. PDF: one 2-page card (front, then back) at the card's print size and DPI."
              >
                <option value="png">PNG</option>
                <option value="pdf">PDF ({schedule?.lanyard?.dpi ?? 300} DPI)</option>
              </select>
            </label>
            <button
              className="btn ghost"
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
                : format === "pdf"
                  ? "Generate all (PDF zip)"
                  : "Generate all (zip)"}
            </button>
          </div>
          {actionError && <p className="warn">{actionError}</p>}

          <div className="lanyard-body" style={{ display: "flex", gap: 16 }}>
            <div className="lanyard-list" style={{ flex: "0 0 260px" }}>
              <RolesPanel
                roles={roles}
                roleImages={schedule?.lanyard?.roleImages ?? {}}
                onAdd={addRole}
                onDelete={deleteRole}
                onUpload={setRoleImage}
                onClear={clearRoleImage}
              />
              <AddPlayerForm onAdd={addPlayer} />
              {selected && (
                <SelectedPlayerEditor
                  entrant={selected}
                  onRename={renameEntrant}
                  onDelete={deletePlayer}
                />
              )}
              <input
                className="startgg-slug"
                style={{ width: "100%", margin: "8px 0" }}
                placeholder="Search entrants…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: "55vh", overflow: "auto" }}>
                {filtered.map((e) => (
                  <li key={e.id} className="entrant-row">
                    <button
                      className={`btn ghost entrant-pick${e.id === selectedId ? " active" : ""}`}
                      onClick={() => setSelectedId(e.id)}
                      title={e.source === "manual" ? "Manually added" : undefined}
                    >
                      {entrantName(e) || "(no name)"}{" "}
                      <span className="startgg-hint">
                        {e.source === "manual" ? "· manual" : `· ${e.eventIds.length}`}
                      </span>
                    </button>
                    <select
                      className="role-select"
                      value={roles.includes(e.role) ? e.role : DEFAULT_ROLE}
                      onChange={(ev) => assignRole(e.id, ev.target.value)}
                      title="Player role"
                    >
                      {roles.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
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
                  bgImg={bgImg}
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

function AddPlayerForm({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  const submit = () => {
    onAdd(name);
    setName("");
  };
  return (
    <div className="role-add" style={{ marginBottom: 8 }}>
      <input
        className="startgg-slug"
        placeholder="Add a player (name)…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <button className="btn ghost" onClick={submit} disabled={!name.trim()}>
        Add player
      </button>
    </div>
  );
}

function SelectedPlayerEditor({
  entrant,
  onRename,
  onDelete,
}: {
  entrant: Entrant;
  onRename: (pid: string, name: string) => void;
  onDelete: (pid: string) => void;
}) {
  // Local input so typing is smooth; commit on blur / Enter.
  const [value, setValue] = useState(entrant.name ?? "");
  useEffect(() => setValue(entrant.name ?? ""), [entrant.id, entrant.name]);
  const commit = () => {
    if ((value.trim() || undefined) !== (entrant.name ?? undefined)) {
      onRename(entrant.id, value);
    }
  };
  return (
    <div className="selected-player">
      <span className="section-label">Selected player</span>
      <label className="prop-row">
        <span>Name</span>
        <input
          type="text"
          value={value}
          placeholder={entrant.gamerTag || "Custom name"}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
      {entrant.source === "manual" && (
        <button
          className="btn ghost danger"
          onClick={() => onDelete(entrant.id)}
        >
          Delete player
        </button>
      )}
    </div>
  );
}

function RolesPanel({
  roles,
  roleImages,
  onAdd,
  onDelete,
  onUpload,
  onClear,
}: {
  roles: string[];
  roleImages: Record<string, string>;
  onAdd: (name: string) => void;
  onDelete: (name: string) => void;
  onUpload: (name: string, file: File | undefined) => void;
  onClear: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const add = () => {
    onAdd(name);
    setName("");
  };
  return (
    <div className="roles-panel">
      <span className="section-label">Roles</span>
      <ul className="roles-list">
        {roles.map((r) => (
          <li key={r} className="role-row">
            <span className="role-name">{r}</span>
            <RoleImageButton
              has={!!roleImages[r]}
              onUpload={(f) => onUpload(r, f)}
              onClear={() => onClear(r)}
            />
            {r !== DEFAULT_ROLE && (
              <button
                className="btn icon"
                title="Delete role"
                onClick={() => onDelete(r)}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="role-add">
        <input
          className="startgg-slug"
          placeholder="New role…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button className="btn ghost" onClick={add} disabled={!name.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

function RoleImageButton({
  has,
  onUpload,
  onClear,
}: {
  has: boolean;
  onUpload: (file: File | undefined) => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="role-img">
      <button className="btn ghost small" onClick={() => ref.current?.click()}>
        {has ? "Image ✓" : "Image"}
      </button>
      {has && (
        <button className="btn icon" title="Remove image" onClick={onClear}>
          ⌫
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          onUpload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </span>
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
