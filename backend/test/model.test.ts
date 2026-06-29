import test from "node:test";
import assert from "node:assert/strict";
import { parseTime, formatTime, dayTimeRange, uid } from "../../shared/model.js";
import type { Day } from "../../shared/types.js";

// ---------------------------------------------------------------------------
// parseTime
// ---------------------------------------------------------------------------

test("parseTime: valid times", () => {
  assert.equal(parseTime("00:00"), 0);
  assert.equal(parseTime("00:01"), 1);
  assert.equal(parseTime("09:30"), 9 * 60 + 30);
  assert.equal(parseTime("12:00"), 12 * 60);
  assert.equal(parseTime("13:30"), 13 * 60 + 30);
  assert.equal(parseTime("23:59"), 23 * 60 + 59);
});

test("parseTime: single-digit hours", () => {
  assert.equal(parseTime("1:00"), 60);
  assert.equal(parseTime("9:05"), 9 * 60 + 5);
});

test("parseTime: whitespace tolerant", () => {
  assert.equal(parseTime(" 13:30 "), 13 * 60 + 30);
  assert.equal(parseTime("\t09:00\t"), 9 * 60);
});

test("parseTime: invalid inputs return null", () => {
  assert.equal(parseTime(null), null);
  assert.equal(parseTime(undefined), null);
  assert.equal(parseTime(123), null);
  assert.equal(parseTime(""), null);
  assert.equal(parseTime("abc"), null);
  assert.equal(parseTime("12:60"), null); // invalid minute
  assert.equal(parseTime("24:00"), null); // hour 24
  assert.equal(parseTime("25:00"), null);
  assert.equal(parseTime("-1:00"), null);
  assert.equal(parseTime("12:30:00"), null); // seconds
  assert.equal(parseTime("1230"), null); // no colon
});

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------

test("formatTime: standard 12-hour format", () => {
  assert.equal(formatTime(0), "12:00 AM");
  assert.equal(formatTime(1), "12:01 AM");
  assert.equal(formatTime(60), "1:00 AM");
  assert.equal(formatTime(11 * 60 + 30), "11:30 AM");
  assert.equal(formatTime(12 * 60), "12:00 PM");
  assert.equal(formatTime(13 * 60 + 30), "1:30 PM");
  assert.equal(formatTime(23 * 60 + 59), "11:59 PM");
});

test("formatTime: compact mode drops :00", () => {
  assert.equal(formatTime(12 * 60, { compact: true }), "12 PM");
  assert.equal(formatTime(13 * 60, { compact: true }), "1 PM");
  assert.equal(formatTime(13 * 60 + 30, { compact: true }), "1:30 PM");
  assert.equal(formatTime(0, { compact: true }), "12 AM");
});

test("formatTime: wraps past 24 hours", () => {
  assert.equal(formatTime(24 * 60), "12:00 AM");
  assert.equal(formatTime(25 * 60), "1:00 AM");
  assert.equal(formatTime(-60), "11:00 PM");
});

// ---------------------------------------------------------------------------
// dayTimeRange
// ---------------------------------------------------------------------------

function makeTestDay(
  blocks: { start: string; end: string }[],
  banners: { start: string; end: string }[] = [],
): Day {
  return {
    id: "d1",
    name: "Test",
    align: "left",
    dayWidth: "auto",
    banners: banners.map((b, i) => ({
      id: `b${i}`,
      name: `Banner ${i}`,
      start: b.start,
      end: b.end,
      stream: "",
      stream2: "",
    })),
    lanes: [
      {
        id: "l1",
        color: "#3c8ce2",
        blocks: blocks.map((b, i) => ({
          id: `blk${i}`,
          name: `Block ${i}`,
          start: b.start,
          end: b.end,
          stream: "",
          stream2: "",
        })),
      },
    ],
  };
}

test("dayTimeRange: empty day defaults to 10:00-20:00", () => {
  const day: Day = { id: "d1", name: "Empty", align: "left", dayWidth: "auto", banners: [], lanes: [] };
  assert.deepEqual(dayTimeRange(day), { min: 10 * 60, max: 20 * 60 });
});

test("dayTimeRange: single block", () => {
  const day = makeTestDay([{ start: "11:00", end: "13:30" }]);
  assert.deepEqual(dayTimeRange(day), { min: 11 * 60, max: 13 * 60 + 30 });
});

test("dayTimeRange: multiple blocks, snaps to half hours", () => {
  const day = makeTestDay([
    { start: "10:15", end: "11:45" },
    { start: "14:50", end: "15:10" },
  ]);
  // min = floor(10*60+15 / 30) * 30 = floor(615/30)*30 = 600 = 10:00
  // max = ceil(15*60+10 / 30) * 30 = ceil(910/30)*30 = 930 = 15:30
  assert.deepEqual(dayTimeRange(day), { min: 10 * 60, max: 15 * 60 + 30 });
});

test("dayTimeRange: includes banners", () => {
  const day = makeTestDay(
    [{ start: "12:00", end: "14:00" }],
    [{ start: "08:00", end: "09:00" }],
  );
  assert.deepEqual(dayTimeRange(day), { min: 8 * 60, max: 14 * 60 });
});

test("dayTimeRange: min less than 30 min apart snaps to 30 min", () => {
  const day = makeTestDay([{ start: "12:00", end: "12:10" }]);
  // min = 12*60 = 720, max = ceil(730/30)*30 = 750 = 12:30
  assert.deepEqual(dayTimeRange(day), { min: 12 * 60, max: 12 * 60 + 30 });
  assert.ok(dayTimeRange(day).max - dayTimeRange(day).min >= 30);
});

test("dayTimeRange: multiple lanes combined correctly", () => {
  const day: Day = {
    id: "d1", name: "Multi", align: "left", dayWidth: "auto", banners: [],
    lanes: [
      {
        id: "l1", color: "#e23c5b",
        blocks: [{ id: "a", name: "A", start: "09:00", end: "10:00", stream: "", stream2: "" }],
      },
      {
        id: "l2", color: "#3c8ce2",
        blocks: [{ id: "b", name: "B", start: "16:00", end: "18:00", stream: "", stream2: "" }],
      },
    ],
  };
  assert.deepEqual(dayTimeRange(day), { min: 9 * 60, max: 18 * 60 });
});

test("dayTimeRange: blocks with invalid times are skipped", () => {
  const day: Day = {
    id: "d1", name: "Bad", align: "left", dayWidth: "auto", banners: [],
    lanes: [{
      id: "l1", color: "#3c8ce2",
      blocks: [
        { id: "a", name: "A", start: "bad", end: "bad", stream: "", stream2: "" },
        { id: "b", name: "B", start: "12:00", end: "14:00", stream: "", stream2: "" },
      ],
    }],
  };
  // Only the valid block contributes: 12:00-14:00
  assert.deepEqual(dayTimeRange(day), { min: 12 * 60, max: 14 * 60 });
});

// ---------------------------------------------------------------------------
// uid
// ---------------------------------------------------------------------------

test("uid: returns non-empty string with prefix", () => {
  const id = uid("test");
  assert.ok(id.startsWith("test-"));
  assert.ok(id.length > 6);
});

test("uid: unique per call", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) ids.add(uid("x"));
  assert.equal(ids.size, 100);
});
