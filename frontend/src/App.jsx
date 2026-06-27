import React, { useEffect, useRef, useState } from "react";
import {
  loadSchedule,
  saveSchedule,
  defaultSchedule,
  makeDay,
} from "./model.js";
import Editor from "./Editor.jsx";
import Preview from "./Preview.jsx";

export default function App() {
  const [schedule, setSchedule] = useState(loadSchedule);
  const [activeDayId, setActiveDayId] = useState(
    () => schedule.days[0]?.id ?? null,
  );
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  // Persist on every change.
  useEffect(() => {
    saveSchedule(schedule);
  }, [schedule]);

  // Keep the active day valid if days are added/removed.
  useEffect(() => {
    if (!schedule.days.some((d) => d.id === activeDayId)) {
      setActiveDayId(schedule.days[0]?.id ?? null);
    }
  }, [schedule, activeDayId]);

  // Apply a mutation to a fresh clone of the schedule.
  const update = (mutator) => {
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

  // Move the dragged day so it sits just before the drop-target day.
  const moveDay = (fromId, toId) => {
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
  const dragState = useRef(null);
  const suppressClick = useRef(false);
  const DRAG_THRESHOLD = 6; // px of movement before a press becomes a drag

  const onTabPointerDown = (dayId, e) => {
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

  const onTabPointerMove = (e) => {
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

  const onTabPointerUp = (e) => {
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

  const onTabClick = (dayId) => {
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
        <button className="btn ghost" onClick={resetAll}>
          Reset
        </button>
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
          {activeDay && (
            <Editor key={activeDay.id} day={activeDay} update={update} />
          )}
        </section>
        <section className="preview-pane">
          <Preview schedule={schedule} />
        </section>
      </main>
    </div>
  );
}
