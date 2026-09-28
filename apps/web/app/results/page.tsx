import { BarsLarge, CheckCircle, Database, Document, Info, ShieldLarge } from "@/components/icons";
import { Card, Stat } from "@/components/ui";
import results from "../../../../backtest/output/results.json";
import { ExampleWeekend } from "./ExampleWeekend";

// Output of `pnpm backtest` (backtest/run.py), read at build time. Every number here comes from that file.
const r = results;
const s = r.summary;
const pct = (x: number, d = 2) => `${x.toFixed(d)}%`;
const monthYear = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export const metadata = { title: "Backtest results · Afterbell" };

export default function ResultsPage() {
  const events = r.events;
  const maxLoss = Math.max(...events.map((e) => -e.plain.lpVsHodlPct));
  const extraFees = s.afterbell.totalFeesUsd - s.plain.totalFeesUsd;
  const devnet = r.sensitivity[0];
  return (
    <>
      <div className="pt-4">
        <h1 className="text-[36px] leading-tight font-bold">
          What happened to liquidity providers on 20 real weekend gaps
        </h1>
        <p className="mt-2 text-[18px] text-ink-2">
          Simulated with real Friday-close and Monday-open prices for {r.tickers.length} large US stocks,{" "}
          {r.period.start.slice(0, 4)} to {r.period.end.slice(0, 4)}.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <Stat
          icon={<BarsLarge />}
          label="Average LP loss, normal pool"
          value={pct(-s.plain.meanLpVsHodlPct)}
          sub="per weekend, vs just holding"
        />
        <Stat
          icon={<ShieldLarge />}
          label="Average LP loss, Afterbell"
          value={pct(-s.afterbell.meanLpVsHodlPct)}
          sub={
            <span className="text-positive">
              ↓ {s.lossReductionPct.toFixed(0)}% less loss in total than a normal pool
            </span>
          }
        />
        <Stat
          icon={<Database />}
          label="Extra fees earned by LPs"
          value={`+$${extraFees.toFixed(0)}`}
          sub={`over the 20 weekends ($${(r.tvlUsd / 1000).toFixed(0)}K pool)`}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-[22px] font-bold">LP result on each weekend</h2>
              <p className="text-[15px] text-ink-2">
                Negative means the LP ended with less than if they had just held the tokens.
              </p>
            </div>
            <div className="flex gap-5 text-[14px] text-ink-2">
              <span className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-neutral" />
                Normal pool
              </span>
              <span className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-brand" />
                Afterbell
              </span>
            </div>
          </div>
          <ul className="mt-5 flex flex-col gap-2.5">
            {events.map((e) => (
              <li key={`${e.ticker}-${e.monday}`} className="grid grid-cols-[150px_1fr] items-center gap-3 text-[13px]">
                <span className="text-ink">
                  {e.ticker} · {monthYear(e.monday)}
                  <span className="block text-[12px] text-ink-2">
                    gap {e.gapPct >= 0 ? "+" : ""}
                    {e.gapPct.toFixed(1)}%
                  </span>
                </span>
                <span className="flex flex-col gap-0.5">
                  {[
                    ["bg-neutral", "text-ink-2", e.plain.lpVsHodlPct],
                    ["bg-brand", "text-brand", e.afterbell.lpVsHodlPct],
                  ].map(([bg, fg, v]) => (
                    <span key={bg as string} className="flex items-center gap-2">
                      <span
                        className={`h-2.5 rounded-r ${bg}`}
                        style={{ width: `${(-(v as number) / maxLoss) * 80}%` }}
                      />
                      <span className={`text-[12px] ${fg}`}>{pct(v as number)}</span>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-col gap-5">
          <Card className="p-6">
            <h2 className="flex items-center gap-2 text-[20px] font-bold">
              <Document className="text-brand" /> How we tested
            </h2>
            <ol className="mt-4 flex flex-col gap-4 text-[15px] text-ink-2">
              {[
                `Found the 20 biggest Friday-close to Monday-open price gaps for ${r.tickers.length} large US stocks (Yahoo Finance daily prices).`,
                `Started each weekend with a $${(r.tvlUsd / 1000).toFixed(0)}K pool, half stock and half USDC, at Friday's close.`,
                "Let a trader who already knows Monday's price trade against each pool all weekend, as long as it pays. A worst case for LPs.",
                "Ran Afterbell with the program's exact math (checked against 120 real program swaps) and the devnet settings, and compared both with just holding.",
              ].map((t, i) => (
                <li key={t} className="flex gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-[14px] font-semibold text-ink">
                    {i + 1}
                  </span>
                  {t}
                </li>
              ))}
            </ol>
            <div className="mt-5 flex gap-3 rounded-xl bg-brand-subtle p-4 text-[14px] text-ink-2">
              <Info className="shrink-0 text-brand" />
              Simulations, not guarantees. Real losses would be smaller for both pools, because real traders don&apos;t
              know Monday&apos;s price on Friday.
            </div>
          </Card>
          <Card className="p-6">
            <h2 className="flex items-center gap-2 text-[20px] font-bold">
              <BarsLarge size={22} className="text-brand" /> Key takeaways
            </h2>
            <ul className="mt-4 flex flex-col gap-4 text-[15px] text-ink-2">
              {[
                `Afterbell LPs lost ${s.lossReductionPct.toFixed(0)}% less in total, and the worst weekend went from ${pct(s.plain.worstLpVsHodlPct)} to ${pct(s.afterbell.worstLpVsHodlPct)}.`,
                `The price band did the work: by Monday it allows ±${(events[0].afterbell.bandAtOpenBps / 100).toFixed(2)}%, and every gap here was bigger, so the band stopped the trader each time.`,
                "Higher weekend fees helped only a little. A tighter band protects LPs more, but would also turn away more ordinary weekend traders.",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <CheckCircle className="mt-0.5 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="p-6">
        <h2 className="text-[22px] font-bold">One weekend, hour by hour</h2>
        <p className="mb-4 text-[15px] text-ink-2">
          LP value versus just holding, valued at Monday&apos;s opening price.
        </p>
        <ExampleWeekend
          events={events.map((e) => ({
            key: `${e.ticker}-${e.monday}`,
            label: `${e.ticker} · ${e.friday} to ${e.monday}`,
            gapPct: e.gapPct,
            plainPct: e.plain.lpVsHodlPct,
            afterbellPct: e.afterbell.lpVsHodlPct,
            path: e.afterbell.path as [number, number][],
            weekendHours: r.weekendHours,
          }))}
        />
      </Card>

      <Card className="p-6">
        <h2 className="text-[22px] font-bold">What if the settings were different?</h2>
        <p className="mb-4 text-[15px] text-ink-2">
          The same 20 weekends with other closed-market settings. The band width matters most.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[15px]">
            <thead>
              <tr className="bg-subtle text-ink-2 [&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
                <th className="rounded-l-xl">Closed-market setting</th>
                <th className="text-right">Total LP loss</th>
                <th className="rounded-r-xl text-right">Less loss than a normal pool</th>
              </tr>
            </thead>
            <tbody>
              {r.sensitivity.map((x) => (
                <tr key={x.variant} className="border-b border-line last:border-b-0 [&>td]:px-4 [&>td]:py-3">
                  <td>{x === devnet ? <strong>{x.variant} (current)</strong> : x.variant}</td>
                  <td className="text-right">
                    ${x.totalLossUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </td>
                  <td className="text-right font-semibold text-brand">{x.lossReductionVsPlainPct.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] text-ink-2">
          Normal pool total: ${(-s.plain.totalLpVsHodlUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })}. The
          backtest has no ordinary weekend traders, so it can&apos;t show what a tighter band costs in lost volume. Full
          method and assumptions: backtest/README.md. Generated {r.generatedAt.slice(0, 10)}.
        </p>
      </Card>
    </>
  );
}
