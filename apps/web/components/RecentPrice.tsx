"use client";
import type { PoolEvent } from "@/lib/events";
import { price, uiPrice } from "@/lib/format";
import type { Market } from "@/lib/market";
import { Chart } from "./Chart";

/** Pool price after each recent on-chain update (keeper re-centres and swaps), oldest first. */
export function priceSeries(m: Market, events: PoolEvent[] | null) {
  const { baseDecimals: bd, quoteDecimals: qd } = m.info.state;
  return (events ?? [])
    .flatMap((e) => {
      if (e.blockTime === null) return [];
      if (e.name === "referenceUpdated")
        return [{ t: e.blockTime, v: uiPrice(BigInt(e.data.poolPrice.toString()), bd, qd) }];
      if (e.name === "swapped") return [{ t: e.blockTime, v: uiPrice(BigInt(e.data.priceAfter.toString()), bd, qd) }];
      return [];
    })
    .reverse();
}

const hhmm = (t: number) =>
  new Date(t * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function RecentPriceChart({
  m,
  events,
  height = 220,
}: {
  m: Market;
  events: PoolEvent[] | null;
  height?: number;
}) {
  const pts = priceSeries(m, events);
  return (
    <Chart
      height={height}
      series={[{ label: "Pool price", color: "#10a37f", points: pts, step: true, area: true }]}
      yFmt={(v) => price(v)}
      xFmt={hhmm}
      empty={
        <div className="flex h-[180px] items-center justify-center rounded-xl bg-subtle text-[14px] text-ink-2">
          {events === null ? "Loading recent updates…" : "No on-chain price updates yet."}
        </div>
      }
    />
  );
}
