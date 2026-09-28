"use client";
import Link from "next/link";
import { useState } from "react";
import { Clock, Database, Search } from "@/components/icons";
import { Button, Card, PairAvatar, Segmented, Skeleton, Stat, StatusPill } from "@/components/ui";
import { WeekMini } from "@/components/WeekMini";
import { WeekTimeline } from "@/components/WeekTimeline";
import { bps, duration, price, usd } from "@/lib/format";
import { nextSessionChange, useMarkets, useTick, view } from "@/lib/market";

const FILTERS = ["All", "Stocks", "Crypto"] as const;

export default function PoolsPage() {
  const { markets } = useMarkets();
  const local = useTick();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [q, setQ] = useState("");

  const rows = (markets ?? [])
    .filter((m) => filter === "All" || (filter === "Stocks") === (m.meta.kind === "Stock"))
    .filter((m) => `${m.meta.base} ${m.meta.quote} ${m.meta.label}`.toLowerCase().includes(q.toLowerCase()));
  const tvl = (markets ?? []).reduce((s, m) => s + view(m, local).tvl, 0);
  const stock = markets?.find((m) => m.meta.kind === "Stock");
  const next = stock ? nextSessionChange(stock.ctx?.calendar ?? null, view(stock, local).now) : null;

  return (
    <>
      <WeekTimeline />
      <div className="flex flex-col gap-5 pt-2 xl:flex-row xl:items-center">
        <div className="flex-1">
          <h1 className="text-[56px] leading-none font-bold tracking-tight">Pools</h1>
          <p className="mt-4 text-[18px] text-ink-2">
            Trade tokenized stocks and crypto. Stock pools follow market hours.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 xl:w-[816px]">
          <Stat
            icon={<Database />}
            label="Total liquidity"
            value={markets ? usd(tvl) : <Skeleton className="h-8 w-28" />}
          />
          <Card className="flex items-center gap-4 p-5">
            <div>
              <div className="text-[14px] text-ink-2">24h volume</div>
              <div className="mt-1 inline-block rounded-full bg-brand-subtle px-3 py-1 text-[12px] font-semibold text-brand uppercase">
                Coming soon
              </div>
            </div>
          </Card>
          <Stat
            icon={<Clock />}
            label={next?.kind === "open" ? "Stock market opens in" : "Next market close in"}
            value={next && stock ? duration(Number(next.at - view(stock, local).now)) : "—"}
          />
        </div>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3 pb-4">
          <Segmented options={FILTERS} value={filter} onChange={setFilter} />
          <label className="ml-auto flex w-full items-center gap-2 rounded-xl border border-line px-4 py-3 sm:w-[380px]">
            <Search className="text-ink-2" />
            <input
              className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted"
              placeholder="Search pools (e.g. TSLA, SOL, USDC)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead>
              <tr className="bg-subtle text-[15px] text-ink-2 [&>th]:px-4 [&>th]:py-4 [&>th]:font-medium">
                <th className="rounded-l-xl">Pool</th>
                <th>Type</th>
                <th>Status</th>
                <th>Market days (ET)</th>
                <th className="text-right">Price (USDC)</th>
                <th className="text-right">TVL</th>
                <th className="text-right">Fee now</th>
                <th className="rounded-r-xl" />
              </tr>
            </thead>
            <tbody>
              {!markets &&
                [0, 1].map((i) => (
                  <tr key={i}>
                    <td colSpan={8} className="px-4 py-5">
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ))}
              {rows.map((m) => {
                const v = view(m, local);
                const href = `/pools/${m.meta.address.toBase58()}`;
                return (
                  <tr key={href} className="border-b border-line text-[16px] last:border-b-0 [&>td]:px-4 [&>td]:py-4">
                    <td>
                      <Link href={href} className="flex items-center gap-3">
                        <PairAvatar base={m.meta.base} quote={m.meta.quote} size={36} />
                        <span>
                          <span className="block font-semibold">
                            {m.meta.base} / {m.meta.quote}
                          </span>
                          <span className="block text-[14px] text-ink-2">{m.meta.label}</span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span className="rounded-md bg-subtle px-2.5 py-1 text-[13px] text-ink-2">{m.meta.kind}</span>
                    </td>
                    <td>
                      <StatusPill mode={v.mode} kind={m.meta.kind} />
                    </td>
                    <td>
                      <WeekMini m={m} />
                    </td>
                    <td className="text-right">{price(v.price)}</td>
                    <td className="text-right">{usd(v.tvl)}</td>
                    <td className="text-right">{v.feeBps !== null ? bps(v.feeBps) : "—"}</td>
                    <td className="text-right">
                      <Button variant="soft" href={`/swap?pool=${m.meta.address.toBase58()}`} className="px-6 py-2.5">
                        Trade
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {markets && !rows.length && <p className="py-10 text-center text-ink-2">No pools match your search.</p>}
        </div>
      </Card>
    </>
  );
}
