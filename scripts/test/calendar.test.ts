import assert from "node:assert/strict";
import { test } from "node:test";
import { nyseSessions, nyToUnix } from "../src/calendar.ts";

const utc = (iso: string) => BigInt(Date.parse(iso) / 1000);

test("daylight saving: 9:30 ET is 13:30 UTC in October, 14:30 UTC after Nov 1 2026", () => {
  assert.equal(nyToUnix("2026-10-02", "09:30"), utc("2026-10-02T13:30:00Z"));
  assert.equal(nyToUnix("2026-11-30", "09:30"), utc("2026-11-30T14:30:00Z"));
  assert.equal(nyToUnix("2026-03-09", "09:30"), utc("2026-03-09T13:30:00Z")); // DST started Mar 8 2026
});

test("Thanksgiving week 2026: Thursday closed, Friday closes 13:00 ET", () => {
  const s = nyseSessions("2026-11-25", 3);
  assert.deepEqual(s, [
    { openTs: utc("2026-11-25T14:30:00Z"), closeTs: utc("2026-11-25T21:00:00Z") },
    { openTs: utc("2026-11-27T14:30:00Z"), closeTs: utc("2026-11-27T18:00:00Z") },
    { openTs: utc("2026-11-30T14:30:00Z"), closeTs: utc("2026-11-30T21:00:00Z") },
  ]);
});

test("weekends and holidays are skipped; stops at the data's coverage", () => {
  const s = nyseSessions("2026-12-24", 4); // Thu early close, Fri Christmas, weekend
  assert.equal(s[0].closeTs, utc("2026-12-24T18:00:00Z"));
  assert.equal(s[1].openTs, utc("2026-12-28T14:30:00Z"));
  assert.equal(nyseSessions("2028-12-28", 48).length, 2); // Thu 28, Fri 29; then weekend and end of data
  assert.ok(nyseSessions("2026-09-25", 48).every((x, i, a) => i === 0 || a[i - 1].closeTs <= x.openTs));
});
