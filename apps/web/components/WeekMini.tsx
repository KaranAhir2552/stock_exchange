"use client";
import { nyDate, nyToUnix } from "@afterbell/sdk";
import type { Market } from "@/lib/market";
import { poolNow } from "@/lib/market";
import { cx } from "./ui";

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Seven blocks for this week (Mon-Sun): green if the market has a session that day, amber for today while paused. */
export function WeekMini({ m }: { m: Market }) {
  const now = poolNow(m);
  const today = nyDate(Number(now) * 1000);
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const cal = m.ctx?.calendar;
  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(monday, i);
    const [s, e] = [nyToUnix(iso, "00:00"), nyToUnix(addDays(iso, 1), "00:00")];
    const open = m.meta.kind === "Crypto" || !!cal?.sessions.some((x) => x.closeTs > s && x.openTs < e);
    return { iso, open, today: iso === today };
  });
  return (
    <div className="inline-flex flex-col gap-1" role="img" aria-label="Market days this week">
      <div className="flex gap-0.5">
        {days.map((d) => (
          <span
            key={d.iso}
            className={cx(
              "h-3.5 w-6 first:rounded-l last:rounded-r",
              d.today && m.live.mode === "Paused" ? "bg-warning" : d.open ? "bg-positive" : "bg-closed",
            )}
          />
        ))}
      </div>
      <div className="flex gap-0.5 text-[10px] text-muted">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="w-6 text-center">
            {d[0]}
          </span>
        ))}
      </div>
    </div>
  );
}
