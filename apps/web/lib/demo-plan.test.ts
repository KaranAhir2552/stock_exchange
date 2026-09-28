import assert from "node:assert/strict";
import { test } from "node:test";
import { nyDate, nyToUnix } from "@afterbell/sdk";
import { demoStep, demoTimeline, demoWeekSessions, isDemoWeek, largestOk } from "./demo-plan.ts";

const day = (t: bigint) => nyDate(Number(t) * 1000);

test("demo week is the next holiday-free Mon-Fri plus next Monday", () => {
  // From Wednesday 2026-11-18: the week of Nov 23 has Thanksgiving (26th) and an early close, so skip to Nov 30.
  const { monday, sessions } = demoWeekSessions(nyToUnix("2026-11-18", "12:00"));
  assert.equal(monday, "2026-11-30");
  assert.deepEqual(
    sessions.map((s) => day(s.openTs)),
    ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-07"],
  );
  assert.ok(isDemoWeek(sessions));
  assert.ok(!isDemoWeek(sessions.slice(0, 5)));
  // A Monday start moves to the following Monday (strictly after).
  assert.equal(demoWeekSessions(nyToUnix("2026-10-05", "08:00")).monday, "2026-10-12");
});

test("steps follow the simulated clock", () => {
  const t = demoTimeline(demoWeekSessions(nyToUnix("2026-10-01", "12:00")).sessions);
  assert.equal(t.fridayClose, nyToUnix("2026-10-09", "16:00"));
  assert.equal(t.news, nyToUnix("2026-10-10", "10:00"));
  assert.equal(t.mondayOpen, nyToUnix("2026-10-12", "09:30"));
  assert.equal(demoStep(null, 0n, false), 0);
  assert.equal(demoStep(t, t.weekStart + 5n, false), 1);
  assert.equal(demoStep(t, t.fridayClose + 1n, false), 2);
  assert.equal(demoStep(t, t.news + 1n, false), 3);
  assert.equal(demoStep(t, t.halt + 1n, true), 4);
  assert.equal(demoStep(t, t.haltEnds + 1n, true), 4, "still halted: lift it first");
  assert.equal(demoStep(t, t.haltEnds + 1n, false), 5);
  assert.equal(demoStep(t, t.mondayOpen + 5n, false), 6);
});

test("largestOk finds the band edge", () => {
  assert.equal(
    largestOk(1_000n, (x) => x <= 377n),
    377n,
  );
  assert.equal(
    largestOk(1_000n, () => false),
    0n,
  );
  assert.equal(
    largestOk(1_000n, () => true),
    1_000n,
  );
});
