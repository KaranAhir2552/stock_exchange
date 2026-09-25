// US equity sessions as explicit UTC timestamps. Daylight saving comes from the system's tz database
// (Intl, America/New_York), holidays and early closes from nyse-calendar.json (sourced from nyse.com).
import nyse from "./nyse-calendar.json" with { type: "json" };

export interface Session {
  openTs: bigint;
  closeTs: bigint;
}

const NY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** New York UTC offset in minutes at instant `ms` (e.g. -240 for EDT). */
function nyOffsetMinutes(ms: number): number {
  const p = Object.fromEntries(NY.formatToParts(ms).map((x) => [x.type, Number(x.value)]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60_000;
}

/** Unix seconds for a New York wall-clock time. */
export function nyToUnix(isoDate: string, hhmm: string): bigint {
  const [y, m, d] = isoDate.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - nyOffsetMinutes(guess) * 60_000;
  t = guess - nyOffsetMinutes(t) * 60_000; // settle if the guess crossed a DST switch
  return BigInt(t / 1000);
}

/** Today's date in New York as YYYY-MM-DD. */
export function nyDate(ms: number): string {
  const p = Object.fromEntries(NY.formatToParts(ms).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month.padStart(2, "0")}-${p.day.padStart(2, "0")}`;
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Up to `max` NYSE sessions starting on `fromDate` (inclusive). Never guesses past `coversThrough`. */
export function nyseSessions(fromDate: string, max: number): Session[] {
  const holidays = new Set(nyse.holidays);
  const early = new Set(nyse.earlyCloses);
  const out: Session[] = [];
  for (let d = fromDate; out.length < max && d <= nyse.coversThrough; d = addDays(d, 1)) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6 || holidays.has(d)) continue;
    out.push({ openTs: nyToUnix(d, nyse.open), closeTs: nyToUnix(d, early.has(d) ? nyse.earlyClose : nyse.close) });
  }
  return out;
}
