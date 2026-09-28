// The demo's simulated week (brief 8.6, DECISIONS.md #59): pure planning, no I/O, so it can be tested.
import { nyDate, nyseSessions, nyToUnix } from "@afterbell/sdk";

export interface Session {
  openTs: bigint;
  closeTs: bigint;
}

export const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday

/** Six NYSE sessions: Monday-Friday of one week plus the next Monday, with no holidays in between. */
export function demoWeekSessions(afterUnix: bigint): { monday: string; sessions: Session[] } {
  let d = nyDate(Number(afterUnix) * 1000);
  d = addDays(d, (8 - weekday(d)) % 7 || 7); // the next Monday strictly after `afterUnix`'s date
  for (let tries = 0; tries < 20; tries++, d = addDays(d, 7)) {
    const s = nyseSessions(d, 6);
    const want = [0, 1, 2, 3, 4, 7].map((n) => addDays(d, n));
    if (s.length === 6 && s.every((x, i) => nyDate(Number(x.openTs) * 1000) === want[i]))
      return { monday: d, sessions: s };
  }
  throw new Error("no holiday-free NYSE week in the calendar data");
}

/** The simulated-clock target of each demo step, from the demo week's sessions. */
export function demoTimeline(sessions: Session[]) {
  const [mon, , , , fri, nextMon] = sessions;
  const friDate = nyDate(Number(fri.openTs) * 1000);
  return {
    weekStart: mon.openTs,
    lastPrice: fri.closeTs - 60n, // Friday 15:59: the last official price of the week
    fridayClose: fri.closeTs,
    news: nyToUnix(addDays(friDate, 1), "10:00"), // Saturday 10:00
    halt: nyToUnix(addDays(friDate, 2), "14:20"), // Sunday 14:20
    haltEnds: nyToUnix(addDays(friDate, 2), "20:00"), // Sunday 20:00
    mondayOpen: nextMon.openTs,
    weekEnd: nextMon.closeTs,
  };
}
export type DemoTimeline = ReturnType<typeof demoTimeline>;

/** Is the on-chain calendar a demo week (Mon-Fri + next Monday)? */
export function isDemoWeek(sessions: Session[]): boolean {
  if (sessions.length !== 6) return false;
  const days = sessions.map((s) => nyDate(Number(s.openTs) * 1000));
  return weekday(days[0]) === 1 && [0, 1, 2, 3, 4, 7].every((n, i) => addDays(days[0], n) === days[i]);
}

/** Which step comes next (0 = start a week, 1-5 = the story, 6 = finished), from the pool's clock. */
export function demoStep(t: DemoTimeline | null, now: bigint, halted: boolean): number {
  if (!t || now < t.weekStart) return 0;
  if (now < t.fridayClose) return 1;
  if (now < t.news) return 2;
  if (now < t.halt) return 3;
  if (now < t.haltEnds || halted) return 4;
  if (now < t.mondayOpen) return 5;
  return 6;
}

/** Largest amount (atoms) that `ok` accepts, by binary search in [1, hi]. `ok` must be monotone. */
export function largestOk(hi: bigint, ok: (x: bigint) => boolean): bigint {
  let [lo, top] = [0n, hi];
  while (lo < top) {
    const mid = (lo + top + 1n) / 2n;
    if (ok(mid)) lo = mid;
    else top = mid - 1n;
  }
  return lo;
}
