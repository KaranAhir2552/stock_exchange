"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BandBar } from "@/components/BandBar";
import { Question } from "@/components/icons";
import { RecentPriceChart } from "@/components/RecentPrice";
import { closeLabel, SwapCard } from "@/components/SwapCard";
import { Callout, Card, Skeleton, TokenAvatar } from "@/components/ui";
import { WeekTimeline } from "@/components/WeekTimeline";
import { usePoolEvents } from "@/lib/events";
import { price } from "@/lib/format";
import { type Market, useMarkets, useTick, view } from "@/lib/market";

export default function SwapPage() {
  return (
    <Suspense>
      <Swap />
    </Suspense>
  );
}

function Swap() {
  const { markets, error } = useMarkets();
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get("pool");
  const m = markets?.find((x) => x.meta.address.toBase58() === selected) ?? markets?.[0] ?? null;
  const setPool = (address: string) => router.replace(`/swap?pool=${address}`, { scroll: false });

  return (
    <>
      <WeekTimeline market={m?.meta.kind === "Stock" ? m : undefined} />
      {error && !markets && <Card className="p-6 text-negative">Could not load pools: {error}</Card>}
      <div className="flex flex-col items-start justify-center gap-5 pt-2 lg:flex-row">
        <div className="w-full lg:w-[580px]">
          {m ? <SwapCard market={m} onPool={setPool} /> : <Skeleton className="h-[640px] w-full rounded-[18px]" />}
        </div>
        {m && <SidePanel m={m} />}
      </div>
    </>
  );
}

function SidePanel({ m }: { m: Market }) {
  const local = useTick();
  const v = view(m, local);
  const { client } = useMarkets();
  const events = usePoolEvents(client, m.meta.address);

  if (v.mode === "Closed" && v.band)
    return (
      <Card className="flex w-full flex-col gap-[18px] px-[26px] py-7 lg:w-[360px]">
        <h2 className="text-[22px] font-bold">Why is my price limited?</h2>
        <p className="text-[16px] leading-[25px] text-ink-2">
          The US stock market is closed, so there is no fresh official price for {m.meta.base.replace(/x$/, "")} until
          it opens again. The token still trades.
        </p>
        <p className="text-[16px] leading-[25px] text-ink-2">
          To keep trades fair, the price may only move within a protected range around the last official price.
        </p>
        <p className="text-[16px] leading-[25px] text-ink-2">
          The range widens slowly while the market stays closed. When it opens, the price jumps straight to the official
          price.
        </p>
        <div className="rounded-[14px] bg-page px-6 pt-4 pb-2">
          <BandBar low={v.band.low} high={v.band.high} reference={v.reference} referenceLabel={closeLabel(v.closeTs)} />
        </div>
        <Callout>Your trade will only go through within this price range.</Callout>
      </Card>
    );

  return (
    <div className="flex w-full flex-col gap-5 lg:w-[500px]">
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <TokenAvatar symbol={m.meta.base} size={48} />
          <div>
            <div className="text-[20px] font-bold">{m.meta.base}</div>
            <div className="text-[15px] text-ink-2">{m.meta.label}</div>
          </div>
        </div>
        <div className="mt-4 text-[34px] font-bold">{price(v.price)}</div>
        <div className="mt-1 mb-3 text-[13px] text-ink-2">Pool price after each recent on-chain update</div>
        <RecentPriceChart m={m} events={events} />
        <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-line p-4">
          <div>
            <div className="text-[18px] font-semibold">{v.oraclePrice !== null ? price(v.oraclePrice) : "—"}</div>
            <div className="text-[14px] text-ink-2">Oracle price</div>
          </div>
          <div>
            <div className="text-[18px] font-semibold">{price(v.price)}</div>
            <div className="text-[14px] text-ink-2">Pool price</div>
          </div>
          <div>
            <div className="text-[18px] font-semibold">{v.band ? `±${(v.band.bps / 100).toFixed(1)}%` : "—"}</div>
            <div className="text-[14px] text-ink-2">Allowed move</div>
          </div>
        </div>
      </Card>
      {v.mode === "Paused" && (
        <Card className="flex gap-4 p-6">
          <Question className="mt-0.5 shrink-0" />
          <div>
            <h2 className="text-[18px] font-semibold">What does this mean?</h2>
            <p className="mt-1.5 text-[16px] leading-6 text-ink-2">
              {m.info.state.halted
                ? `Trading in ${m.meta.base.replace(/x$/, "")} is halted, so there is no reliable price. `
                : "There is no fresh, trustworthy price right now. "}
              Swaps and deposits are switched off until trading resumes. Withdrawals always work.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
