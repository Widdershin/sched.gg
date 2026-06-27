import React from "react";

// Compact per-user schedule switcher for the topbar. Presentational: all state
// lives in App.
export default function ScheduleList({
  schedules,
  currentId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}) {
  return (
    <div className="schedule-list">
      <select
        className="schedule-select"
        value={currentId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        title="Switch schedule"
      >
        {!currentId && <option value="">Unsaved</option>}
        {schedules.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name || "Untitled"}
          </option>
        ))}
      </select>
      <button className="btn ghost" onClick={onCreate} title="New schedule">
        New
      </button>
      <button
        className="btn ghost"
        disabled={!currentId}
        title="Rename schedule"
        onClick={() => {
          const current = schedules.find((s) => s.id === currentId);
          const name = prompt("Rename schedule", current?.name || "");
          if (name && name.trim()) onRename(currentId, name.trim());
        }}
      >
        Rename
      </button>
      <button
        className="btn ghost danger"
        disabled={!currentId}
        title="Delete schedule"
        onClick={() => {
          const current = schedules.find((s) => s.id === currentId);
          if (confirm(`Delete "${current?.name || "this schedule"}"?`)) {
            onDelete(currentId);
          }
        }}
      >
        Delete
      </button>
    </div>
  );
}
