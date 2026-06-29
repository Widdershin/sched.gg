import test from "node:test";
import assert from "node:assert/strict";
import {
  entrantName,
  elementRect,
  sidePixels,
  mmToPx,
  makeElement,
  defaultDesign,
} from "../../shared/lanyard.js";
import { parseTime, formatTime } from "../../shared/model.js";

test("entrantName prefers a non-blank custom name", () => {
  assert.equal(entrantName({ gamerTag: "Tag", name: "Custom" }), "Custom");
  assert.equal(entrantName({ gamerTag: "Tag", name: "  " }), "Tag");
  assert.equal(entrantName({ gamerTag: "Tag" }), "Tag");
});

test("sidePixels derives from mm + dpi", () => {
  const d = defaultDesign();
  d.widthMm = 54;
  d.heightMm = 86;
  d.dpi = 300;
  assert.deepEqual(sidePixels(d), { w: mmToPx(54, 300), h: mmToPx(86, 300) });
  assert.equal(mmToPx(25.4, 300), 300); // 1 inch
});

test("elementRect: image height tracks aspect", () => {
  const el = makeElement("image", { x: 0.1, y: 0.2, w: 0.5 });
  const r = elementRect(el, 1000, 2000, { aspect: 2 });
  assert.deepEqual(
    { x: r.x, y: r.y, w: r.w, h: r.h },
    { x: 100, y: 400, w: 500, h: 250 },
  );
});

test("elementRect: text height from fontPx; shape from h", () => {
  const t = makeElement("text", { h: undefined });
  const rt = elementRect(t, 1000, 1000, { fontPx: 40 });
  assert.equal(rt.fontPx, 40);
  assert.equal(rt.h, 52); // 40 * 1.3

  const s = makeElement("shape", { w: 0.4, h: 0.1 });
  const rs = elementRect(s, 1000, 1000);
  assert.deepEqual({ w: rs.w, h: rs.h }, { w: 400, h: 100 });
});

test("elementRect: roleImage behaves like an image", () => {
  const el = makeElement("roleImage", { x: 0, y: 0, w: 0.25 });
  const r = elementRect(el, 800, 800, { aspect: 1 });
  assert.deepEqual({ w: r.w, h: r.h }, { w: 200, h: 200 });
});

test("makeElement defaults", () => {
  assert.equal(makeElement("tag").bold, true);
  assert.equal(makeElement("schedule").w, 0.9);
  assert.equal(makeElement("roleImage").w, 0.25);
  assert.equal(defaultDesign().front.elements[0].type, "schedule");
});

test("parseTime / formatTime (12-hour)", () => {
  assert.equal(parseTime("13:30"), 13 * 60 + 30);
  assert.equal(parseTime("00:00"), 0);
  assert.equal(parseTime("bad"), null);
  assert.equal(formatTime(13 * 60 + 30), "1:30 PM");
  assert.equal(formatTime(13 * 60, { compact: true }), "1 PM");
});
