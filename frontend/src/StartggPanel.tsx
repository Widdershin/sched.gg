import { useState } from "react";
import { api } from "./api";
import { useAuth } from "./AuthContext";
import type { Schedule, UpdateFn } from "./types";

// Schedule-wide start.gg controls: bind the schedule to a tournament, load its
// events (for the per-block dropdowns), and jump to the lanyards page.
export default function StartggPanel({
  schedule,
  update,
  scheduleId,
}: {
  schedule: Schedule;
  update: UpdateFn;
  scheduleId: string | null;
}) {
  const auth = useAuth();
  const [slug, setSlug] = useState(schedule.startgg?.slug ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const events = schedule.startgg?.events ?? [];

  // start.gg sign-in isn't offered at all — hide the panel.
  if (!auth.methods.startgg) return null;

  const loadEvents = async () => {
    const trimmed = slug.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const { events } = await api.getTournament(trimmed);
      update((s) => {
        s.startgg = { slug: trimmed, events };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="startgg-panel">
      <div className="startgg-row">
        <span className="section-label">start.gg</span>
        {!auth.startggLinked ? (
          <a className="btn startgg-btn" href={api.startggLoginUrl()}>
            Sign in with start.gg to enable
          </a>
        ) : (
          <>
            <input
              className="startgg-slug"
              value={slug}
              placeholder="tournament/your-event-slug"
              onChange={(e) => setSlug(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadEvents();
              }}
            />
            <button
              className="btn ghost"
              onClick={loadEvents}
              disabled={loading || !slug.trim()}
            >
              {loading ? "Loading…" : events.length ? "Reload events" : "Load events"}
            </button>
            {events.length > 0 && (
              <span className="startgg-hint">{events.length} events</span>
            )}
            <a
              className="btn"
              href={scheduleId ? `/lanyards/${scheduleId}` : undefined}
              aria-disabled={!scheduleId}
              title={
                scheduleId
                  ? "Open the lanyards page"
                  : "Save this schedule first (sign in)"
              }
              style={
                !scheduleId ? { pointerEvents: "none", opacity: 0.5 } : undefined
              }
            >
              Lanyards →
            </a>
          </>
        )}
      </div>
      {error && <p className="warn">{error}</p>}
    </div>
  );
}
