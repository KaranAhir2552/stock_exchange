"use client";
import { nyDate, nyseSessions } from "@afterbell/sdk";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Chart } from "@/components/Chart";
import { MoonSmall, Sun } from "@/components/icons";
import { Callout, Card, cx, Skeleton, TokenAvatar } from "@/components/ui";
import { price } from "@/lib/format";
import { useMarkets, useTick, view } from "@/lib/market";
import type { LivePrice } from "../api/pyth/route";

const POLL_MS = 3_000;
const MAX_SAMPLES = 400;

/** Is the US stock market in a regular session now (our NYSE calendar, the same data the pools use)? */
function usMarketOpen(nowSec: number): boolean {
  const [s] = nyseSessions(nyDate(nowSec * 1000), 1);
  return !!s && BigInt(nowSec) >= s.openTs && BigInt(nowSec) < s.closeTs;
}

export default function LivePage() {
  const [data, setData] = useState<LivePrice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<Record<string, { t: number; v: number }[]>>({});
  const local = useTick();

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch("/api/pyth", { cache: "no-store" });
        const body = await res.json();
        if (!live) return;
        if (!res.ok) return setError(body.error ?? `HTTP ${res.status}`);
        setError(null);
        setData(body);
        setSamples((prev) => {
          const next = { ...prev };
          for (const p of body as LivePrice[]) {
            const arr = next[p.feedId] ?? [];
            if (arr.at(-1)?.t !== p.publishTime)
              next[p.feedId] = [...arr, { t: p.publishTime, v: p.price }].slice(-MAX_SAMPLES);
          }
          return next;
        });
      } catch (e) {
        if (live) setError(String(e));
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  const nowSec = Math.floor(local / 1000);
  const usOpen = usMarketOpen(nowSec);

  return (
    <>
      <div className="pt-4">
        <h1 className="text-[36px] font-bold">Live market data</h1>
        <p className="mt-1 text-[17px] text-ink-2">
          Real prices from Pyth (Hermes), refreshed every few seconds. Our server holds the API key; your browser only
          sees prices.
        </p>
      </div>
      {error && <Card className="p-5 text-negative">Could not load live prices: {error}</Card>}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {!data && !error && [0, 1].map((i) => <Skeleton key={i} className="h-[380px] w-full rounded-[18px]" />)}
        {data?.map((p) => {
          const s = samples[p.feedId] ?? [];
          const stock = p.profile === "UsEquity";
          const open = stock ? usOpen : true;
          const moved = s.length > 1 ? s[s.length - 1].v - s[0].v : 0;
          const symbol = p.label.split(" ")[0];
          return (
            <Card key={p.feedId} className="flex flex-col gap-4 p-6">
              <div className="flex items-start gap-3">
                <TokenAvatar symbol={symbol === "SOL" ? "SOL" : "TSLAx"} size={44} />
                <div className="mr-auto">
                  <div className="text-[19px] font-semibold">{p.label}</div>
                  <div className="text-[13px] text-ink-2">
                    Published {Math.max(0, nowSec - p.publishTime)}s ago · confidence ±{price(p.conf)}
                  </div>
                </div>
                <span
                  className={cx(
                    "flex items-center gap-2 rounded-lg px-3 py-1.5 text-[14px] font-medium",
                    open ? "bg-positive-subtle text-positive" : "bg-brand-subtle text-brand",
                  )}
                >
                  {open ? <Sun /> : <MoonSmall />}
                  {stock ? (open ? "US market open" : "US market closed") : "24/7"}
                </span>
              </div>
              <div className="text-[40px] leading-none font-bold">{price(p.price)}</div>
              <Chart
                height={200}
                series={[{ label: p.label, color: open ? "#10a37f" : "#4346e0", points: s, step: true, area: true }]}
                yFmt={(v) => price(v)}
                xFmt={(t) =>
                  new Date(t * 1000).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hourCycle: "h23",
                  })
                }
                empty={
                  <div className="flex h-[200px] items-center justify-center rounded-xl bg-subtle text-ink-2">
                    Collecting prices…
                  </div>
                }
              />
              <p className="text-[13px] text-ink-2">
                {s.length} updates since you opened this page · moved {moved >= 0 ? "+" : "−"}
                {price(Math.abs(moved))}
              </p>
              {stock && !open && (
                <Callout tone="brand">
                  The US market is closed, but Pyth keeps publishing {symbol} prices from pre-market and overnight
                  trading. Afterbell&apos;s stock pools ignore these until the official open, and stay inside their band
                  around the last close.
                </Callout>
              )}
            </Card>
          );
        })}
      </div>
      <OnChain live={data} />
    </>
  );
}

/** Pyth-priced pools on-chain next to the live feed: the keeper pushes Hermes prices, the pool follows. */
function OnChain({ live }: { live: LivePrice[] | null }) {
  const { markets } = useMarkets();
  const local = useTick();
  const pyth = (markets ?? []).filter((m) => m.info.accounts.oracleKind === "Pyth");
  if (!pyth.length) return null;
  return (
    <Card className="p-6">
      <h2 className="text-[22px] font-bold">On-chain pools priced by Pyth</h2>
      <p className="mb-4 text-[15px] text-ink-2">
        The keeper pushes the latest Hermes price into Pyth&apos;s on-chain price account and refreshes the pool; swaps
        read that same account.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[15px]">
          <thead>
            <tr className="bg-subtle text-ink-2 [&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
              <th className="rounded-l-xl">Pool</th>
              <th className="text-right">Pool price</th>
              <th className="text-right">Live Pyth price</th>
              <th className="text-right">On-chain price age</th>
              <th className="rounded-r-xl text-right">Mode</th>
            </tr>
          </thead>
          <tbody>
            {pyth.map((m) => {
              const v = view(m, local);
              const feed = live?.find((l) => l.feedId.replace(/^0x/, "") === m.meta.cfg.feedId.replace(/^0x/, ""));
              return (
                <tr
                  key={m.meta.address.toBase58()}
                  className="border-b border-line last:border-b-0 [&>td]:px-4 [&>td]:py-3"
                >
                  <td>
                    <Link href={`/pools/${m.meta.address.toBase58()}`} className="font-semibold text-brand">
                      {m.meta.base} / {m.meta.quote}
                    </Link>
                  </td>
                  <td className="text-right">{price(v.price)}</td>
                  <td className="text-right">{feed ? price(feed.price) : "—"}</td>
                  <td className="text-right">{v.oracleAgeSecs !== null ? `${v.oracleAgeSecs}s` : "—"}</td>
                  <td className="text-right">{v.mode}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
