"use client";
import Link from "next/link";
import { use, useState } from "react";
import { Chart, Legend } from "@/components/Chart";
import { ArrowLeft, MoonSmall, Pause, Sun } from "@/components/icons";
import { priceSeries } from "@/components/RecentPrice";
import { closeLabel, TIPS } from "@/components/SwapCard";
import { Button, Card, ModeBadge, PairAvatar, Row, Skeleton, Tag } from "@/components/ui";
import { WeekTimeline } from "@/components/WeekTimeline";
import { type PoolEvent, usePoolEvents } from "@/lib/events";
import { bps, duration, nyTime, price, tokens, uiPrice, usd } from "@/lib/format";
import { type Market, nextSessionChange, useMarket, useMarkets, useTick, view } from "@/lib/market";

export default function PoolDetailPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const m = useMarket(address);
  const { markets } = useMarkets();
  if (!m)
    return markets ? (
      <Card className="p-8">
        Pool not found.{" "}
        <Link href="/pools" className="text-brand underline">
          Back to pools
        </Link>
      </Card>
    ) : (
      <Skeleton className="h-[600px] w-full rounded-[18px]" />
    );
  return <Detail m={m} />;
}

function Detail({ m }: { m: Market }) {
  const local = useTick();
  const v = view(m, local);
  const { client } = useMarkets();
  const events = usePoolEvents(client, m.meta.address);
  const next = nextSessionChange(v.calendar, v.now);
  const addr = m.meta.address.toBase58();
  const { baseDecimals: bd, quoteDecimals: qd } = m.info.state;
  const pts = priceSeries(m, events);
  const refPts = (events ?? [])
    .filter((e) => e.name === "referenceUpdated" && e.blockTime)
    .map((e) => ({ t: e.blockTime as number, v: uiPrice(BigInt(e.data.referencePrice.toString()), bd, qd) }))
    .reverse();
  const t0 = pts[0]?.t;
  const t1 = Math.floor(local / 1000);

  return (
    <>
      <WeekTimeline market={m.meta.kind === "Stock" ? m : undefined} />
      <Link href="/pools" className="flex items-center gap-2 text-[16px] text-ink-2 hover:text-ink">
        <ArrowLeft size={18} /> Back to pools
      </Link>
      <div className="flex flex-wrap items-center gap-5">
        <PairAvatar base={m.meta.base} quote={m.meta.quote} size={52} />
        <div className="mr-auto">
          <div className="flex items-center gap-3">
            <h1 className="text-[36px] font-bold">
              {m.meta.base} / {m.meta.quote}
            </h1>
            <Tag>{m.meta.kind === "Stock" ? "Tokenized stock" : "Crypto · 24/7"}</Tag>
          </div>
          <div className="text-[16px] text-ink-2">
            {m.meta.label} · fee now {v.feeBps !== null ? bps(v.feeBps) : "—"}
          </div>
        </div>
        <ModeBadge
          mode={v.mode}
          sub={
            next ? `${next.kind === "open" ? "Opens" : "Closes"} in ${duration(Number(next.at - v.now))}` : undefined
          }
        />
        <div className="flex gap-3 rounded-2xl border border-line bg-surface p-1.5 shadow-card">
          <Button variant="soft" href={`/liquidity?pool=${addr}`} className="px-11 py-3 text-[17px]">
            Add liquidity
          </Button>
          <Button href={`/swap?pool=${addr}`} className="px-11 py-3 text-[17px]">
            Trade
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card className="p-6">
          <h2 className="text-[20px] font-bold">Price (recent on-chain updates)</h2>
          <p className="mb-3 text-[14px] text-ink-2">
            Each point is a keeper update or a swap. Longer history arrives with the indexer.
          </p>
          <Chart
            height={430}
            series={[
              { label: "Pool price", color: "#4346e0", points: pts, step: true },
              { label: "Official price", color: "#10a37f", points: refPts, step: true, dashed: true },
            ]}
            band={
              v.band && t0
                ? [
                    { t: t0, low: v.band.low, high: v.band.high },
                    { t: t1, low: v.band.low, high: v.band.high },
                  ]
                : undefined
            }
            xDomain={t0 ? [t0, Math.max(t1, t0 + 60)] : undefined}
            yFmt={(x) => price(x)}
            xFmt={(t) =>
              new Date(t * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
            }
            empty={
              <div className="flex h-[300px] items-center justify-center rounded-xl bg-subtle text-ink-2">
                {events ? "No updates yet." : "Loading…"}
              </div>
            }
          />
          <div className="mt-3">
            <Legend
              items={[
                { label: `Pool price (${m.meta.base})`, color: "#4346e0" },
                { label: "Official price (oracle, at each update)", color: "#10a37f", kind: "dash" },
                ...(v.band ? [{ label: "Allowed range now", color: "#daddfb", kind: "area" as const }] : []),
              ]}
            />
          </div>
        </Card>
        <Card className="flex flex-col p-6">
          <h2 className="mb-2 text-[20px] font-bold">Pool details</h2>
          <Row label="Pool price" value={price(v.price)} tip="The price you trade at in this pool right now." />
          <Row
            label={v.mode === "Closed" ? closeLabel(v.closeTs) : "Official price"}
            value={price(v.reference)}
            tip={TIPS.oracle}
          />
          <Row
            label="Band now"
            tip={TIPS.band}
            value={<span className="text-brand">{v.band ? `±${(v.band.bps / 100).toFixed(1)}%` : "—"}</span>}
          />
          <Row
            label={v.mode === "Closed" ? "Weekend fee" : "Fee"}
            tip={v.mode === "Closed" ? TIPS.weekendFee : TIPS.fee}
            value={v.feeBps !== null ? bps(v.feeBps) : "—"}
          />
          <Row
            label="TVL"
            tip="Total value locked: everything in the pool, valued at the pool price."
            value={usd(v.tvl)}
          />
          <Row
            label="Reserves"
            value={`${tokens(m.reserves.base, bd, 2)} ${m.meta.base} + ${tokens(m.reserves.quote, qd, 0)} ${m.meta.quote}`}
          />
          <Row
            label="24h volume"
            value={<span className="text-[13px] font-semibold text-brand uppercase">Coming soon</span>}
          />
          <Row
            label="LP APR (7d)"
            value={<span className="text-[13px] font-semibold text-brand uppercase">Coming soon</span>}
          />
          <ModeNote m={m} v={v} />
        </Card>
      </div>

      <ModeHistory events={events} m={m} />
    </>
  );
}

function ModeNote({ m, v }: { m: Market; v: ReturnType<typeof view> }) {
  const u = m.meta.base.replace(/x$/, "");
  const [cls, icon, title, body] =
    v.mode === "Closed"
      ? [
          "bg-brand-subtle [&_svg]:text-brand",
          <MoonSmall key="i" />,
          "Market closed",
          `${u} is not trading on its exchange. The pool price is kept within a band around the last official price until the market opens.`,
        ]
      : v.mode === "Paused"
        ? [
            "bg-warning-subtle [&_svg]:text-warning",
            <Pause key="i" />,
            "Trading paused",
            "Swaps and deposits are off. Withdrawals always work.",
          ]
        : [
            "bg-positive-subtle [&_svg]:text-positive",
            <Sun key="i" />,
            m.meta.kind === "Crypto" ? "Trading 24/7" : "Market open",
            "The pool price follows the official price feed.",
          ];
  return (
    <div className={`mt-4 flex gap-3 rounded-2xl p-5 ${cls}`}>
      <span className="mt-0.5">{icon}</span>
      <div>
        <div className="text-[16px] font-semibold">{title}</div>
        <p className="mt-1 text-[14px] text-ink-2">{body}</p>
      </div>
    </div>
  );
}

/** Mode changes from the pool's own events (ModeChanged carries the pool-clock time). */
function describe(e: PoolEvent, all: PoolEvent[], m: Market) {
  const sameTx = all.filter((x) => x.sig === e.sig);
  const to = Object.keys(e.data.to)[0];
  const from = Object.keys(e.data.from)[0];
  const { baseDecimals: bd, quoteDecimals: qd } = m.info.state;
  const re = sameTx.find((x) => x.name === "referenceUpdated");
  const halt = all.find((x) => x.name === "haltSet" && x.sig === e.sig);
  if (to === "open")
    return {
      tone: "bg-positive",
      title: from === "paused" ? "Resumed" : "Market opened",
      text: re
        ? `Price re-centred to ${price(uiPrice(BigInt(re.data.poolPrice.toString()), bd, qd))} without any trade.`
        : "Price follows the oracle again.",
    };
  if (to === "closed")
    return {
      tone: "bg-brand",
      title: from === "paused" ? "Resumed (market closed)" : "Market closed",
      text: "Price band active around the last official price.",
    };
  return {
    tone: "bg-warning",
    title: halt ? "Paused (halt)" : "Paused",
    text: "Swaps and deposits disabled. Withdrawals still work.",
  };
}

function ModeHistory({ events, m }: { events: PoolEvent[] | null; m: Market }) {
  const [all, setAll] = useState(false);
  const changes = (events ?? []).filter((e) => e.name === "modeChanged");
  const shown = all ? changes : changes.slice(0, 4);
  return (
    <Card className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-[24px] font-bold">Mode history</h2>
        {changes.length > 4 && (
          <Button variant="soft" className="px-4 py-2 text-[15px]" onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : "View all events"} →
          </Button>
        )}
      </div>
      {events === null ? (
        <Skeleton className="h-24 w-full" />
      ) : !changes.length ? (
        <p className="text-ink-2">No mode changes in the recent history of this pool.</p>
      ) : (
        <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((e) => {
            const d = describe(e, events, m);
            return (
              <li key={`${e.sig}-${e.data.ts}`} className="border-t-2 border-band pt-4">
                <div className="-mt-[23px] mb-3 flex items-center gap-2">
                  <span className={`size-3 rounded-full ${d.tone}`} />
                </div>
                <div className="text-[14px] text-ink-2">{nyTime(BigInt(e.data.ts.toString()))}</div>
                <div className="mt-1 text-[18px] font-semibold">{d.title}</div>
                <p className="mt-1 text-[14px] text-ink-2">{d.text}</p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
