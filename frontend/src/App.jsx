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
            className={`tab ${day.id === activeDay?.id ? "active" : ""}`}
            onClick={() => setActiveDayId(day.id)}
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
          {activeDay && <Preview schedule={schedule} day={activeDay} />}
        </section>
      </main>
    </div>
  );
}
