"use client";
import { nyDate, nyToUnix } from "@afterbell/sdk";
import { duration, nyTime } from "@/lib/format";
import { type Market, poolNow, useMarkets, useTick } from "@/lib/market";
import { Card, cx } from "./ui";

const DAY = 86_400;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY * 1000).toISOString().slice(0, 10);

/** Mon-Sun of the stock pool's current week: when the market is open (from the on-chain calendar) and "now". */
export function WeekTimeline({ market }: { market?: Market | null }) {
  const { markets } = useMarkets();
  const local = useTick();
  const m = market ?? markets?.find((x) => x.meta.kind === "Stock") ?? null;
  if (!m?.ctx?.calendar) return null;
  const cal = m.ctx.calendar;
  const now = poolNow(m, local);
  const today = nyDate(Number(now) * 1000);
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
  const monday = addDays(today, -dow);
  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(monday, i);
    const start = nyToUnix(iso, "00:00");
    const end = nyToUnix(addDays(iso, 1), "00:00");
    return { iso, start, end };
  });
  const mode = m.live.mode;
  const tone = mode === "Paused" ? "bg-warning" : mode === "Open" ? "bg-positive" : "bg-brand";
  const since = mode === "Closed" ? Number(now - m.live.closeTs) : 0;
  const label =
    mode === "Paused"
      ? `${nyTime(now, false)} · Trading halted`
      : mode === "Open"
        ? `${nyTime(now, false)} · Market open`
        : `Now ${nyTime(now, false)} · Closed ${duration(since)}`;

  // Hours come from the on-chain calendar (the devnet demo calendar has one long session instead).
  const first = cal.sessions.find((x) => x.closeTs > days[0].start);
  const openLabel =
    first && first.closeTs - first.openTs < 86_400n
      ? `Market open ${nyTime(first.openTs, false)} – ${nyTime(first.closeTs, false)} (ET)`
      : "Market open";

  return (
    <Card className="px-6 pt-5 pb-[18px]" aria-label="This week's market hours">
      <div className="flex gap-2 overflow-x-auto pt-9">
        {days.map((d, i) => {
          const span = Number(d.end - d.start);
          const segs = cal.sessions
            .filter((s) => s.closeTs > d.start && s.openTs < d.end)
            .map((s) => ({
              left: (Number((s.openTs > d.start ? s.openTs : d.start) - d.start) / span) * 100,
              width:
                (Number((s.closeTs < d.end ? s.closeTs : d.end) - (s.openTs > d.start ? s.openTs : d.start)) / span) *
                100,
            }));
          const isNow = now >= d.start && now < d.end;
          const at = isNow ? (Number(now - d.start) / span) * 100 : 0;
          const date = new Date(`${d.iso}T12:00:00Z`);
          return (
            <div key={d.iso} className="relative flex min-w-[88px] flex-1 flex-col gap-2.5">
              <div className="leading-tight">
                <div className="text-[14px] font-semibold">
                  {date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
                </div>
                <div className="text-[13px] text-ink-2">
                  {date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                </div>
              </div>
              <div className="relative h-3.5 overflow-hidden rounded bg-closed">
                {segs.map((s) => (
                  <span
                    key={s.left}
                    className="absolute inset-y-0 bg-positive"
                    style={{ left: `${s.left}%`, width: `${s.width}%` }}
                  />
                ))}
              </div>
              {isNow && (
                // Label sits above the row; it hangs right of the line on Monday and left of it on Sunday.
                <div
                  className={cx(
                    "absolute -top-8 z-10 flex flex-col",
                    i === 0 ? "items-start" : i === 6 ? "-translate-x-full items-end" : "-translate-x-1/2 items-center",
                  )}
                  style={{ left: `${at}%` }}
                >
                  <span
                    className={cx("rounded-md px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white", tone)}
                  >
                    {label}
                  </span>
                  <span className={cx("h-[66px] w-0.5", tone)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-[18px] flex flex-wrap gap-x-10 gap-y-2 text-[13px] text-ink-2">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-positive" /> {openLabel}
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-closed" /> Market closed
        </span>
        <span className="flex items-center gap-2">
          <span className={cx("size-2.5 rounded-full", tone)} /> {mode === "Paused" ? "Trading halt" : "Now"}
        </span>
      </div>
    </Card>
  );
}
