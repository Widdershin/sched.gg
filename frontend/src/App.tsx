import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  loadSchedule,
  saveSchedule,
  normalizeSchedule,
  defaultSchedule,
  makeDay,
  loadOutputSettings,
  saveOutputSettings,
  loadVisualSettings,
  saveVisualSettings,
} from "./model";
import Editor from "./Editor";
import Preview from "./Preview";
import StartggPanel from "./StartggPanel";
import { scheduleToCsv, csvToSchedule } from "./csv";
import { useAuth } from "./AuthContext";
import AccountMenu from "./AccountMenu";
import ScheduleList from "./ScheduleList";
import { api } from "./api";
import type { Schedule, ScheduleMeta } from "./types";

const SERVER_SAVE_DEBOUNCE_MS = 800;
const DRAG_THRESHOLD = 6; // px of movement before a press becomes a drag

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  id: string;
  overId: string | null;
  dragging: boolean;
}

export default function App() {
  const auth = useAuth();
  const [schedule, setSchedule] = useState<Schedule>(loadSchedule);
  const [output, setOutput] = useState(loadOutputSettings);
  const [visuals, setVisuals] = useState(loadVisualSettings);
  const [activeDayId, setActiveDayId] = useState<string | null>(
    () => schedule.days[0]?.id ?? null,
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const logoBlobUrlRef = useRef<string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);

  // Server-synced schedule list + the one currently being edited.
  const [scheduleList, setScheduleList] = useState<ScheduleMeta[]>([]);
  const [currentScheduleId, setCurrentScheduleId] = useState<string | null>(
    null,
  );

  // Persist locally on every change (offline fallback, always on).
  useEffect(() => {
    saveSchedule(schedule);
  }, [schedule]);
  useEffect(() => {
    saveOutputSettings(output);
  }, [output]);
  useEffect(() => {
    saveVisualSettings(visuals);
  }, [visuals]);

  // Load a schedule from the server into the editor.
  const loadScheduleFromServer = async (id: string) => {
    const full = await api.getSchedule(id);
    const normalized = normalizeSchedule(full.data);

    // Load the logo as a blob URL if one exists on the server.
    if (normalized.logo) {
      try {
        const blob = await api.getLogoBlob(id);
        if (blob) {
          if (logoBlobUrlRef.current) URL.revokeObjectURL(logoBlobUrlRef.current);
          const url = URL.createObjectURL(blob);
          logoBlobUrlRef.current = url;
          normalized.logo.src = url;
        }
      } catch {
        // Logo fetch failed — leave src undefined, title will show instead.
      }
    }

    setSchedule(normalized);
    if (full.output) {
      setOutput(full.output);
      if (full.output.visuals) setVisuals(full.output.visuals);
    }
    setActiveDayId(full.data.days?.[0]?.id ?? null);
    setCurrentScheduleId(id);
  };

  // On sign-in, load the user's schedules (adopting the local one if empty).
  // On sign-out, drop the server list back to local-only.
  useEffect(() => {
    if (!auth.user) {
      setScheduleList([]);
      setCurrentScheduleId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { schedules } = await api.listSchedules();
        if (cancelled) return;
        if (schedules.length) {
          setScheduleList(schedules);
          await loadScheduleFromServer(schedules[0].id);
        } else {
          const created = await api.createSchedule({
            name: schedule.title || "My Tournament",
            data: schedule,
        output: { ...output, visuals },
          });
          if (cancelled) return;
          setScheduleList([created]);
          setCurrentScheduleId(created.id);
        }
      } catch {
        /* stay in local-only mode on error */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user]);

  // Debounced server autosave of the active schedule (data + output only; the
  // list name is changed explicitly via Rename). Logo src is stripped — the
  // logo PNG is uploaded separately via the logo endpoint.
  useEffect(() => {
    if (!auth.user || !currentScheduleId) return;
    const t = setTimeout(() => {
      const clean = structuredClone(schedule);
      if (clean.logo) {
        delete (clean.logo as unknown as Record<string, unknown>).src;
      }
      api
        .updateSchedule(currentScheduleId, {
          data: clean,
          output: { ...output, visuals },
        })
        .catch(() => {});
    }, SERVER_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [schedule, output, auth.user, currentScheduleId]);

  // Keep the active day valid if days are added/removed.
  useEffect(() => {
    if (!schedule.days.some((d) => d.id === activeDayId)) {
      setActiveDayId(schedule.days[0]?.id ?? null);
    }
  }, [schedule, activeDayId]);

  // Apply a mutation to a fresh clone of the schedule.
  const update = (mutator: (s: Schedule) => void) => {
    setSchedule((prev) => {
      const next = structuredClone(prev);
      mutator(next);
      return next;
    });
  };

  const activeDay =
    schedule.days.find((d) => d.id === activeDayId) ?? schedule.days[0];

  const resetAll = () => {
    if (confirm("Discard the current schedule and start fresh?")) {
      const fresh = defaultSchedule();
      setSchedule(fresh);
      setActiveDayId(fresh.days[0].id);
    }
  };

  const addDay = () => {
    update((s) => {
      const day = makeDay(s.days.length);
      s.days.push(day);
    });
  };

  // --- Server schedule management -------------------------------------------
  const selectSchedule = (id: string) => {
    if (id && id !== currentScheduleId) {
      loadScheduleFromServer(id).catch((e) => alert(e.message));
    }
  };

  const createServerSchedule = async () => {
    const fresh = defaultSchedule();
    try {
      const created = await api.createSchedule({
        name: fresh.title,
        data: fresh,
        output,
      });
      setScheduleList((prev) => [created, ...prev]);
      setSchedule(fresh);
      setActiveDayId(fresh.days[0].id);
      setCurrentScheduleId(created.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const renameSchedule = async (id: string, name: string) => {
    try {
      await api.updateSchedule(id, { name });
      setScheduleList((prev) =>
        prev.map((s) => (s.id === id ? { ...s, name } : s)),
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteSchedule = async (id: string) => {
    try {
      await api.deleteSchedule(id);
      const remaining = scheduleList.filter((s) => s.id !== id);
      setScheduleList(remaining);
      if (currentScheduleId === id) {
        if (remaining.length) {
          await loadScheduleFromServer(remaining[0].id);
        } else {
          const fresh = defaultSchedule();
          setSchedule(fresh);
          setActiveDayId(fresh.days[0].id);
          setCurrentScheduleId(null);
        }
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const shareSchedule = async () => {
    if (!currentScheduleId) return;
    try {
      const { token } = await api.createShare(currentScheduleId);
      setShareToken(token);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const exportCsv = () => {
    const blob = new Blob([scheduleToCsv(schedule)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (s: string) =>
      (s || "schedule").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    a.href = url;
    a.download = `${safe(schedule.title)}-schedule.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = csvToSchedule(text);
      setSchedule(imported);
      setActiveDayId(imported.days[0]?.id ?? null);
    } catch (e) {
      alert(`Could not import CSV: ${e instanceof Error ? e.message : e}`);
    }
  };

  // Move the dragged day so it sits just before the drop-target day.
  const moveDay = (fromId: string, toId: string) => {
    if (!fromId || fromId === toId) return;
    update((s) => {
      const from = s.days.findIndex((d) => d.id === fromId);
      const to = s.days.findIndex((d) => d.id === toId);
      if (from === -1 || to === -1) return;
      const [moved] = s.days.splice(from, 1);
      s.days.splice(to, 0, moved);
    });
  };

  // Pointer-based drag reordering (works for mouse, touch and pen).
  const dragState = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  const onTabPointerDown = (
    dayId: string,
    e: PointerEvent<HTMLButtonElement>,
  ) => {
    if (e.button != null && e.button > 0) return; // ignore non-primary buttons
    suppressClick.current = false;
    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      id: dayId,
      overId: null,
      dragging: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onTabPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const st = dragState.current;
    if (!st || st.pointerId !== e.pointerId) return;
    if (!st.dragging) {
      const moved =
        Math.abs(e.clientX - st.startX) + Math.abs(e.clientY - st.startY);
      if (moved < DRAG_THRESHOLD) return;
      st.dragging = true;
      setDragId(st.id);
    }
    // Pointer capture keeps events here, so find the tab under the pointer.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const tab = el && el.closest("[data-day-id]");
    st.overId = tab ? tab.getAttribute("data-day-id") : null;
    setDragOverId(st.overId);
  };

  const onTabPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const st = dragState.current;
    if (!st || st.pointerId !== e.pointerId) return;
    if (st.dragging) {
      if (st.overId) moveDay(st.id, st.overId);
      suppressClick.current = true; // don't let the trailing click re-select
    }
    dragState.current = null;
    setDragId(null);
    setDragOverId(null);
  };

  const onTabClick = (dayId: string) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setActiveDayId(dayId);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">sched.gg</span>
          <span className="brand-sub">tournament schedule builder</span>
        </div>
        <input
          className="title-input"
          value={schedule.title}
          placeholder="Tournament name"
          onChange={(e) => update((s) => (s.title = e.target.value))}
        />
        <button className="btn ghost" onClick={exportCsv}>
          Export CSV
        </button>
        <button
          className="btn ghost"
          onClick={() => importInputRef.current?.click()}
        >
          Import CSV
        </button>
        <button className="btn ghost" onClick={resetAll}>
          Reset
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => {
            importCsv(e.target.files?.[0]);
            e.target.value = ""; // allow re-importing the same file
          }}
        />
        <div className="topbar-account">
          {auth.user && (
            <>
              <ScheduleList
                schedules={scheduleList}
                currentId={currentScheduleId}
                onSelect={selectSchedule}
                onCreate={createServerSchedule}
                onRename={renameSchedule}
                onDelete={deleteSchedule}
              />
              <button
                className="btn ghost"
                onClick={shareSchedule}
                disabled={!currentScheduleId}
                title="Create a public share link"
              >
                Share
              </button>
            </>
          )}
          <AccountMenu />
        </div>
      </header>

      <div className="tabs">
        {schedule.days.map((day) => (
          <button
            key={day.id}
            data-day-id={day.id}
            className={[
              "tab",
              day.id === activeDay?.id ? "active" : "",
              day.id === dragId ? "dragging" : "",
              day.id === dragOverId && dragId && day.id !== dragId
                ? "drag-over"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            draggable={false}
            onPointerDown={(e) => onTabPointerDown(day.id, e)}
            onPointerMove={onTabPointerMove}
            onPointerUp={onTabPointerUp}
            onPointerCancel={onTabPointerUp}
            onClick={() => onTabClick(day.id)}
            title="Drag to reorder"
          >
            {day.name || "Untitled day"}
          </button>
        ))}
        <button className="tab add" onClick={addDay}>
          + Day
        </button>
      </div>

      <main className="workspace">
        <section className="editor-pane">
          <StartggPanel
            schedule={schedule}
            update={update}
            scheduleId={currentScheduleId}
          />
          {activeDay && (
            <Editor
              key={activeDay.id}
              day={activeDay}
              update={update}
              events={schedule.startgg?.events ?? []}
            />
          )}
        </section>
        <section className="preview-pane">
          <Preview
            schedule={schedule}
            update={update}
            output={output}
            setOutput={setOutput}
            visuals={visuals}
            setVisuals={setVisuals}
            scheduleId={currentScheduleId}
          />
        </section>
      </main>

      {shareToken && (
        <ShareModal
          token={shareToken}
          onClose={() => setShareToken(null)}
        />
      )}
    </div>
  );
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function ShareModal({ token, onClose }: { token: string; onClose: () => void }) {
  const pageUrl = `${window.location.origin}/?share=${token}`;
  const imageUrl = `${window.location.origin}/api/share/${token}/image`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Share schedule</h2>
        <label className="modal-field">
          <span>Live preview page</span>
          <span className="modal-row">
            <input className="modal-input" value={pageUrl} readOnly onFocus={(e) => e.target.select()} />
            <button className="btn" onClick={() => copyToClipboard(pageUrl)}>Copy</button>
            <button className="btn" onClick={() => window.open(pageUrl, "_blank")}>View</button>
          </span>
        </label>
        <label className="modal-field">
          <span>Embed image</span>
          <span className="modal-row">
            <input className="modal-input" value={imageUrl} readOnly onFocus={(e) => e.target.select()} />
            <button className="btn" onClick={() => copyToClipboard(imageUrl)}>Copy</button>
            <button className="btn" onClick={() => window.open(imageUrl, "_blank")}>View</button>
          </span>
        </label>
        <button className="btn ghost modal-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
