"use client";
import Link from "next/link";
import { useState } from "react";
import { MoonSmall, Sun } from "@/components/icons";
import { priceSeries, RecentPriceChart } from "@/components/RecentPrice";
import { SwapCard } from "@/components/SwapCard";
import { Card, cx, ModeBadge, Segmented, Skeleton, StatusPill, Tag, TokenAvatar } from "@/components/ui";
import { WeekTimeline } from "@/components/WeekTimeline";
import { type PoolEvent, usePoolEvents } from "@/lib/events";
import { duration, nyTime, price, uiPrice } from "@/lib/format";
import { type Market, nextSessionChange, simulated, useMarkets, useTick, view } from "@/lib/market";

const FILTERS = ["All", "Stocks", "Crypto"] as const;

export default function Dashboard() {
  const { markets } = useMarkets();
  const [selected, setSelected] = useState<string | null>(null);
  const m = markets?.find((x) => x.meta.address.toBase58() === selected) ?? markets?.[0] ?? null;
  if (!markets || !m) return <Skeleton className="h-[900px] w-full rounded-[18px]" />;
  return (
    <>
      <WeekTimeline />
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[400px_minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-5">
          <Watchlist markets={markets} selected={m} onSelect={setSelected} />
          <MarketStatus markets={markets} />
        </div>
        <div className="flex flex-col gap-5">
          <Asset m={m} />
          <Activity markets={markets} />
        </div>
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="rounded-lg bg-brand-subtle px-4 py-1.5 text-[15px] font-semibold text-brand">Swap</span>
            <Link href={`/swap?pool=${m.meta.address.toBase58()}`} className="text-[14px] text-brand">
              Full swap page →
            </Link>
          </div>
          <SwapCard market={m} onPool={setSelected} compact />
        </Card>
      </div>
    </>
  );
}

function Sparkline({ m }: { m: Market }) {
  const { client } = useMarkets();
  const pts = priceSeries(m, usePoolEvents(client, m.meta.address, 60_000));
  if (pts.length < 2) return <span className="h-8 w-20" />;
  const vs = pts.map((p) => p.v);
  const [lo, hi] = [Math.min(...vs), Math.max(...vs)];
  const d = pts
    .map(
      (p, i) => `${i ? "L" : "M"}${(i / (pts.length - 1)) * 80},${hi === lo ? 16 : 30 - ((p.v - lo) / (hi - lo)) * 28}`,
    )
    .join("");
  const up = vs[vs.length - 1] >= vs[0];
  return (
    <svg width={80} height={32} aria-hidden className="shrink-0">
      <path d={d} fill="none" stroke={up ? "#10a37f" : "#e5484d"} strokeWidth={1.5} />
    </svg>
  );
}

function Watchlist({
  markets,
  selected,
  onSelect,
}: {
  markets: Market[];
  selected: Market;
  onSelect: (a: string) => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const local = useTick(5_000);
  const rows = markets.filter((m) => filter === "All" || (filter === "Stocks") === (m.meta.kind === "Stock"));
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-[20px] font-bold">Markets</h2>
      <Segmented options={FILTERS} value={filter} onChange={setFilter} className="mb-3" />
      <ul className="flex flex-col gap-1">
        {rows.map((m) => {
          const v = view(m, local);
          const active = m === selected;
          return (
            <li key={m.meta.address.toBase58()}>
              <button
                type="button"
                onClick={() => onSelect(m.meta.address.toBase58())}
                className={cx(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left",
                  active ? "bg-subtle" : "hover:bg-subtle/60",
                )}
              >
                <TokenAvatar symbol={m.meta.base} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{m.meta.label.replace(/^Tokenized /, "")}</span>
                  <span className="block text-[14px] text-ink-2">
                    {m.meta.kind === "Stock" ? "Tokenized stock" : "Crypto"}
                  </span>
                </span>
                <Sparkline m={m} />
                <span className="text-right">
                  <span className="block font-semibold">{price(v.price)}</span>
                  <span className="mt-1 block">
                    <StatusPill mode={v.mode} kind={m.meta.kind} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function MarketStatus({ markets }: { markets: Market[] }) {
  const local = useTick();
  const stock = markets.find((m) => m.meta.kind === "Stock");
  if (!stock) return null;
  const v = view(stock, local);
  const next = nextSessionChange(v.calendar, v.now);
  const left = next ? Number(next.at - v.now) : 0;
  const open = v.mode === "Open";
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-[20px] font-bold">Market status</h2>
      <span
        className={cx(
          "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[16px] font-medium",
          open ? "bg-positive-subtle text-positive" : "bg-brand-subtle text-brand",
        )}
      >
        {open ? <Sun /> : <MoonSmall />}{" "}
        {open ? "Market open" : v.mode === "Paused" ? "Trading paused" : "Market closed"}
      </span>
      <p className="mt-3 text-[15px]">
        U.S. stock market is {open ? "open" : "closed"}
        {simulated(stock) && <span className="text-[13px] text-warning"> (simulated devnet clock)</span>}
      </p>
      {next ? (
        <>
          <p className="text-[13px] text-ink-2">
            {next.kind === "open" ? "Reopens" : "Closes"} {nyTime(next.at)} ET
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              [Math.floor(left / 3600), "hrs"],
              [Math.floor((left % 3600) / 60), "min"],
              [left % 60, "sec"],
            ].map(([n, l]) => (
              <div key={l}>
                <div className="rounded-xl border border-line py-2 text-[24px] font-semibold tabular-nums">
                  {String(n).padStart(2, "0")}
                </div>
                <div className="mt-1 text-[12px] text-ink-2">{l}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-[13px] text-ink-2">No upcoming session in the on-chain calendar.</p>
      )}
    </Card>
  );
}

function Asset({ m }: { m: Market }) {
  const { client } = useMarkets();
  const local = useTick();
  const v = view(m, local);
  const events = usePoolEvents(client, m.meta.address);
  const next = nextSessionChange(v.calendar, v.now);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-3">
        <TokenAvatar symbol={m.meta.base} size={48} />
        <div className="mr-auto">
          <div className="flex items-center gap-2">
            <span className="text-[22px] font-semibold">{m.meta.label}</span>
            <Tag>{m.meta.base}</Tag>
          </div>
          <div className="text-[15px] text-ink-2">
            {m.meta.kind === "Stock" ? "Tokenized stock on Solana" : "Crypto on Solana"}
          </div>
        </div>
        <ModeBadge
          mode={v.mode}
          sub={
            next ? `${next.kind === "open" ? "Reopens" : "Closes"} in ${duration(Number(next.at - v.now))}` : undefined
          }
        />
      </div>
      <div className="mt-3 text-[36px] font-bold">{price(v.price)}</div>
      <div className="mb-3 text-[13px] text-ink-2">Pool price after each recent on-chain update</div>
      <RecentPriceChart m={m} events={events} height={260} />
    </Card>
  );
}

/** Latest swaps and mode changes across all pools, straight from the program's events. */
function Activity({ markets }: { markets: Market[] }) {
  const { client } = useMarkets();
  const a = usePoolEvents(client, markets[0]?.meta.address ?? null);
  const b = usePoolEvents(client, markets[1]?.meta.address ?? null);
  const rows = [...(a ?? []).map((e) => ({ e, m: markets[0] })), ...(b ?? []).map((e) => ({ e, m: markets[1] }))]
    .filter(({ e }) => e.name === "swapped" || e.name === "modeChanged")
    .sort((x, y) => (y.e.blockTime ?? 0) - (x.e.blockTime ?? 0))
    .slice(0, 6);
  const text = (e: PoolEvent, m: Market) => {
    const { baseDecimals: bd, quoteDecimals: qd } = m.info.state;
    if (e.name === "modeChanged")
      return `Market ${Object.keys(e.data.to)[0] === "open" ? "opened" : Object.keys(e.data.to)[0] === "closed" ? "closed" : "paused"}`;
    const sold = Object.keys(e.data.direction)[0] === "baseToQuote";
    return `${sold ? "Sold" : "Bought"} ${m.meta.base} at ${price(uiPrice(BigInt(e.data.priceAfter.toString()), bd, qd))}`;
  };
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-[20px] font-bold">Recent activity</h2>
      {a === null && b === null ? (
        <Skeleton className="h-24 w-full" />
      ) : !rows.length ? (
        <p className="text-[15px] text-ink-2">No swaps or market changes recently.</p>
      ) : (
        <ul>
          {rows.map(({ e, m }) => (
            <li
              key={`${e.sig}-${e.name}`}
              className="flex items-center gap-3 border-b border-line py-3 text-[15px] last:border-b-0"
            >
              <TokenAvatar symbol={m.meta.base} size={28} />
              <span className="flex-1">{text(e, m)}</span>
              <span className="text-[13px] text-ink-2">
                {e.blockTime ? `${duration(Date.now() / 1000 - e.blockTime)} ago` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
