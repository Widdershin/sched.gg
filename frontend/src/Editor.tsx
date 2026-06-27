import { makeLane, makeBlock, LANE_COLORS, parseTime } from "./model";
import type { Block, Day, Lane, Schedule, UpdateFn } from "./types";

// Find a day within the schedule clone by id.
function findDay(s: Schedule, dayId: string): Day | undefined {
  return s.days.find((d) => d.id === dayId);
}

export default function Editor({ day, update }: { day: Day; update: UpdateFn }) {
  const setDay = (mutator: (d: Day) => void) =>
    update((s) => {
      const d = findDay(s, day.id);
      if (d) mutator(d);
    });

  const removeDay = () => {
    if (!confirm(`Delete "${day.name}" and all its lanes?`)) return;
    update((s) => {
      if (s.days.length === 1) return; // keep at least one day
      s.days = s.days.filter((d) => d.id !== day.id);
    });
  };

  const addLane = () =>
    setDay((d) => {
      d.lanes.push(makeLane(d.lanes.length));
    });

  const addBanner = () =>
    setDay((d) => {
      if (!d.banners) d.banners = [];
      d.banners.push(
        makeBlock({ name: "Doors open", start: "10:00", end: "11:00" }),
      );
    });

  const banners = day.banners ?? [];

  return (
    <div className="editor">
      <div className="day-head">
        <input
          className="day-name"
          value={day.name}
          placeholder="Day name (e.g. Saturday)"
          onChange={(e) => setDay((d) => (d.name = e.target.value))}
        />
        <button
          className="btn ghost"
          title="Align this day in the image"
          onClick={() =>
            setDay((d) => (d.align = d.align === "right" ? "left" : "right"))
          }
        >
          {day.align === "right" ? "Align ⇥" : "Align ⇤"}
        </button>
        <select
          className="day-width-select"
          value={day.dayWidth === "auto" ? "auto" : "manual"}
          title="Day width mode"
          onChange={(e) =>
            setDay((d) => {
              d.dayWidth = e.target.value === "auto" ? "auto" : 50;
            })
          }
        >
          <option value="auto">Auto width</option>
          <option value="manual">Custom %</option>
        </select>
        {typeof day.dayWidth === "number" && (
          <span className="ctl day-width-ctl">
            <input
              type="range"
              min={5}
              max={100}
              value={day.dayWidth}
              onChange={(e) =>
                setDay((d) => (d.dayWidth = Number(e.target.value)))
              }
            />
            <input
              className="ctl-num"
              type="number"
              min={5}
              max={100}
              value={day.dayWidth}
              onChange={(e) => {
                const v = Math.min(100, Math.max(5, Number(e.target.value) || 5));
                setDay((d) => (d.dayWidth = v));
              }}
            />
            <span className="ctl-unit">%</span>
          </span>
        )}
        <button className="btn ghost danger" onClick={removeDay}>
          Delete day
        </button>
      </div>

      <div className="banner-section">
        <span className="section-label">Banners</span>
        <div className="blocks">
          {banners.map((block) => (
            <BlockEditor
              key={block.id}
              block={block}
              setBlock={(mutator) =>
                update((s) => {
                  const b = findDay(s, day.id)?.banners?.find(
                    (x) => x.id === block.id,
                  );
                  if (b) mutator(b);
                })
              }
              removeBlock={() =>
                update((s) => {
                  const d = findDay(s, day.id);
                  if (d?.banners)
                    d.banners = d.banners.filter((b) => b.id !== block.id);
                })
              }
            />
          ))}
        </div>
        <button className="btn block-add small" onClick={addBanner}>
          + Add banner
        </button>
      </div>

      <div className="lanes">
        {day.lanes.map((lane) => (
          <LaneEditor
            key={lane.id}
            lane={lane}
            dayId={day.id}
            update={update}
          />
        ))}
      </div>

      <button className="btn block-add" onClick={addLane}>
        + Add lane
      </button>
    </div>
  );
}

function LaneEditor({
  lane,
  dayId,
  update,
}: {
  lane: Lane;
  dayId: string;
  update: UpdateFn;
}) {
  const setLane = (mutator: (l: Lane) => void) =>
    update((s) => {
      const l = findDay(s, dayId)?.lanes.find((x) => x.id === lane.id);
      if (l) mutator(l);
    });

  const removeLane = () =>
    update((s) => {
      const d = findDay(s, dayId);
      if (d && d.lanes.length > 1) {
        d.lanes = d.lanes.filter((l) => l.id !== lane.id);
      }
    });

  const addBlock = () =>
    setLane((l) => {
      const last = l.blocks[l.blocks.length - 1];
      // New blocks default to following the previous one.
      const start = last ? last.end : "12:00";
      const startMin = parseTime(start) ?? 12 * 60;
      const endMin = Math.min(startMin + 60, 23 * 60 + 59);
      const fmt = (mins: number) =>
        `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(
          mins % 60,
        ).padStart(2, "0")}`;
      l.blocks.push(makeBlock({ start: fmt(startMin), end: fmt(endMin) }));
    });

  return (
    <div className="lane" style={{ borderColor: lane.color }}>
      <div className="lane-head">
        <span className="swatch" style={{ background: lane.color }} />
        <span className="lane-label">Lane</span>
        <select
          className="color-select"
          value={lane.color}
          onChange={(e) => setLane((l) => (l.color = e.target.value))}
          title="Lane colour"
        >
          {LANE_COLORS.map((c) => (
            <option key={c} value={c}>
              {COLOR_NAMES[c] ?? c}
            </option>
          ))}
        </select>
        <button className="btn icon" onClick={removeLane} title="Remove lane">
          ✕
        </button>
      </div>

      <div className="blocks">
        {lane.blocks.length === 0 && <p className="empty">No blocks yet.</p>}
        {lane.blocks.map((block) => (
          <BlockEditor
            key={block.id}
            block={block}
            setBlock={(mutator) =>
              update((s) => {
                const l = findDay(s, dayId)?.lanes.find((x) => x.id === lane.id);
                const b = l?.blocks.find((x) => x.id === block.id);
                if (b) mutator(b);
              })
            }
            removeBlock={() =>
              update((s) => {
                const l = findDay(s, dayId)?.lanes.find((x) => x.id === lane.id);
                if (l) l.blocks = l.blocks.filter((b) => b.id !== block.id);
              })
            }
          />
        ))}
      </div>

      <button className="btn block-add small" onClick={addBlock}>
        + Add block
      </button>
    </div>
  );
}

// `setBlock(mutator)` applies a mutation to this block; `removeBlock()` deletes
// it. The parent supplies these so the same editor works for lane blocks and
// the day's full-width banner blocks.
function BlockEditor({
  block,
  setBlock,
  removeBlock,
}: {
  block: Block;
  setBlock: (mutator: (b: Block) => void) => void;
  removeBlock: () => void;
}) {
  const startMin = parseTime(block.start);
  const endMin = parseTime(block.end);
  const invalidTime = startMin == null || endMin == null || endMin <= startMin;

  return (
    <div className={`block ${invalidTime ? "invalid" : ""}`}>
      <input
        className="block-name"
        value={block.name}
        placeholder="Block name"
        onChange={(e) => setBlock((b) => (b.name = e.target.value))}
      />
      <div className="block-row">
        <label className="field">
          <span>Start</span>
          <input
            type="time"
            value={block.start}
            onChange={(e) => setBlock((b) => (b.start = e.target.value))}
          />
        </label>
        <label className="field">
          <span>End</span>
          <input
            type="time"
            value={block.end}
            onChange={(e) => setBlock((b) => (b.end = e.target.value))}
          />
        </label>
        <label className="field grow">
          <span>Stream label</span>
          <input
            type="text"
            value={block.stream}
            placeholder="optional"
            onChange={(e) => setBlock((b) => (b.stream = e.target.value))}
          />
        </label>
        <label className="field grow">
          <span>2nd stream label</span>
          <input
            type="text"
            value={block.stream2 ?? ""}
            placeholder="optional"
            onChange={(e) => setBlock((b) => (b.stream2 = e.target.value))}
          />
        </label>
        <button className="btn icon" onClick={removeBlock} title="Remove block">
          ✕
        </button>
      </div>
      {invalidTime && <p className="warn">End time must be after start time.</p>}
    </div>
  );
}

const COLOR_NAMES: Record<string, string> = {
  "#e23c5b": "Red",
  "#3c8ce2": "Blue",
  "#36b37e": "Green",
  "#f5a623": "Amber",
  "#9b5cf6": "Purple",
  "#16c2c2": "Teal",
};
