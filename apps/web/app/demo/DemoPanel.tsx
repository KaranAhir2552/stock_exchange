"use client";
import { nyDate, nyToUnix } from "@afterbell/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { Keypair } from "@solana/web3.js";
import { useEffect, useRef, useState } from "react";
import { Chart, Legend } from "@/components/Chart";
import { BandArrows, CheckCircle, MoonSmall, Pause, Percent, Refresh, Sun, TrendUp, Warning } from "@/components/icons";
import { Button, Card, cx, Tag } from "@/components/ui";
import { explorerTx } from "@/lib/config";
import { DemoAdmin, type SentTx } from "@/lib/demo";
import { addDays, type DemoTimeline, demoStep, demoTimeline, isDemoWeek } from "@/lib/demo-plan";
import { bps, nyTime, price } from "@/lib/format";
import { type Market, useMarkets, useTick, view } from "@/lib/market";
import { explainError } from "@/lib/tx";

interface LogRow {
  id: number;
  at: bigint; // pool clock (simulated)
  tone: "neutral" | "brand" | "negative" | "positive" | "warning";
  event: string;
  details: string;
  sig?: string;
}
interface Pt {
  t: number;
  oracle?: number;
  pool?: number;
  step?: number;
}

const STEPS = [
  { title: "Friday close", sub: "The last official price of the week, then the market closes" },
  { title: "Weekend news", sub: "The real price moves; a trader pushes the pool as far as the band allows" },
  { title: "Trading halt", sub: "The exchange halts the stock: swaps stop, withdrawals still work" },
  { title: "Halt ends", sub: "Back to the weekend band, with its clock unchanged" },
  { title: "Monday open", sub: "The pool jumps straight to the official price, no trade needed" },
];

export default function DemoPanel() {
  const { markets, client, reload } = useMarkets();
  const m = markets?.find((x) => x.meta.kind === "Stock" && x.meta.cfg.oracleKind === "Mock") ?? null;
  const local = useTick();
  const [admin, setAdmin] = useState<DemoAdmin | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newsPct, setNewsPct] = useState<-10 | 10>(-10);
  const [startPrice, setStartPrice] = useState("");
  const [log, setLog] = useState<LogRow[]>([]);
  const [pts, setPts] = useState<Pt[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);

  const v = m ? view(m, local) : null;
  const cal = m?.ctx?.calendar ?? null;
  const t: DemoTimeline | null = cal && isDemoWeek(cal.sessions) ? demoTimeline(cal.sessions) : null;
  const step = v && m ? demoStep(t, v.now, m.info.state.halted) : 0;

  useEffect(() => {
    if (v && !startPrice) setStartPrice(v.oraclePrice?.toFixed(2) ?? "");
  }, [v, startPrice]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a row is added
  useEffect(() => {
    if (autoScroll) logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log.length, autoScroll]);

  if (!m || !v) return <Card className="p-8 text-ink-2">Loading the demo pool…</Card>;
  const pool: Market = m;
  const { baseDecimals: bd, quoteDecimals: qd } = pool.info.state;

  const addLog = (rows: Omit<LogRow, "id">[]) =>
    setLog((l) => [...l, ...rows.map((r) => ({ ...r, id: nextId.current++ }))]);

  /** Rows for the program events a transaction emitted, in plain words. */
  function describe(tx: SentTx, at: bigint): Omit<LogRow, "id">[] {
    return tx.events.flatMap((e): Omit<LogRow, "id">[] => {
      const d = e.data as Record<string, { toString(): string } & Record<string, unknown>>;
      const ui = (x: unknown) => price((Number(BigInt(String(x))) / 1e18) * 10 ** (bd - qd));
      if (e.name === "modeChanged") {
        const to = Object.keys(d.to)[0];
        const from = Object.keys(d.from)[0];
        if (to === "closed")
          return [
            {
              at,
              tone: "neutral",
              event: from === "paused" ? "Halt over: market still closed" : "Market closed",
              details: "Price frozen at the last official price. The weekend band is now active.",
              sig: tx.sig,
            },
          ];
        if (to === "paused")
          return [
            {
              at,
              tone: "warning",
              event: "Trading paused",
              details: "Swaps and deposits are off. Withdrawals keep working.",
              sig: tx.sig,
            },
          ];
        return [
          {
            at,
            tone: "positive",
            event: "Market open",
            details: "The pool follows the official price again.",
            sig: tx.sig,
          },
        ];
      }
      if (e.name === "referenceUpdated")
        return [
          {
            at,
            tone: "positive",
            event: "Re-centred",
            details: `Pool price set to the official ${ui(d.poolPrice)} with no trade.`,
            sig: tx.sig,
          },
        ];
      if (e.name === "swapped") {
        const sold = Object.keys(d.direction)[0] === "baseToQuote";
        const amt = Number(BigInt(String(d.amountIn))) / 10 ** (sold ? bd : qd);
        return [
          {
            at,
            tone: "brand",
            event: "Swap executed",
            details: `A trader ${sold ? `sold ${amt.toFixed(2)} ${pool.meta.base}` : `paid ${amt.toFixed(0)} ${pool.meta.quote}`}, moving the price to ${ui(d.priceAfter)} (band ±${bps(Number(d.bandBps), 1)}). Fee ${bps(Number(d.feeBps))}.`,
            sig: tx.sig,
          },
        ];
      }
      if (e.name === "haltSet")
        return d.halted
          ? [
              {
                at,
                tone: "warning",
                event: "Trading halted",
                details: `Halt set by ${String(d.by).slice(0, 4)}….`,
                sig: tx.sig,
              },
            ]
          : [];
      if (e.name === "liquidityRemoved")
        return [
          {
            at,
            tone: "positive",
            event: "Withdrawal succeeded",
            details: "An LP withdrew while trading was halted. Withdrawals always work.",
            sig: tx.sig,
          },
        ];
      return [];
    });
  }

  /** Runs one step, then records the pool as it is afterwards. */
  async function run(label: string, fn: (a: DemoAdmin, tl: DemoTimeline) => Promise<void>, stepNo?: number) {
    if (!admin || (!t && stepNo !== 0)) return;
    setBusy(label);
    try {
      await fn(admin, t as DemoTimeline);
      await reload();
    } catch (e) {
      addLog([
        {
          at: v?.now ?? 0n,
          tone: "negative",
          event: `${label} failed`,
          details: explainError(e, client.program.idl.errors),
        },
      ]);
    } finally {
      setBusy(null);
    }
  }

  // After a reload the latest market is only in context on the next render; read it fresh instead.
  async function snapshot(stepNo: number) {
    const [s] = await client.fetchMarkets([pool.meta.address]);
    const fresh = { ...s, meta: pool.meta, readAt: Date.now() };
    const fv = view(fresh);
    setPts((p) => [...p, { t: Number(fv.now), oracle: fv.oraclePrice ?? undefined, pool: fv.price, step: stepNo }]);
    return fresh;
  }

  const oracleNow = v.oraclePrice ?? v.price;
  const actions = {
    reset: () =>
      run(
        "Start week",
        async (a) => {
          const p = Number(startPrice) || oracleNow;
          const tx = await a.startWeek(pool, p);
          setPts([]);
          setLog([]);
          const fresh = await snapshot(0);
          addLog([
            {
              at: view(fresh).now,
              tone: "positive",
              event: "New simulated week",
              details: `Market open Monday 09:30 at ${price(p)}.`,
              sig: tx.sig,
            },
          ]);
        },
        0,
      ),
    friday: () =>
      run("Friday close", async (a, tl) => {
        const tx = await a.fridayClose(pool, tl, oracleNow);
        const fresh = await snapshot(1);
        addLog(describe(tx, view(fresh).now));
      }),
    news: () =>
      run("Weekend news", async (a, tl) => {
        const target = oracleNow * (1 + newsPct / 100);
        const tx = await a.news(pool, tl, target);
        let fresh = await snapshot(2);
        addLog([
          {
            at: view(fresh).now,
            tone: "neutral",
            event: `News: price ${newsPct > 0 ? "+" : ""}${newsPct}%`,
            details: `The official price moves to ${price(target)}. The closed pool ignores it and keeps its band around ${price(view(fresh).reference)}.`,
            sig: tx.sig,
          },
        ]);
        const r = await a.informedTrade(fresh, newsPct < 0 ? "BaseToQuote" : "QuoteToBase");
        fresh = await snapshot(2);
        addLog(describe(r.swap, view(fresh).now));
        addLog([
          {
            at: view(fresh).now,
            tone: "negative",
            event: "Swap rejected",
            details: r.rejected
              ? `A further trade was refused: ${r.rejected}`
              : "A further trade would still fit (band not reached).",
          },
        ]);
      }),
    halt: () =>
      run("Trading halt", async (a, tl) => {
        const r = await a.halt(pool, tl);
        const fresh = await snapshot(3);
        const at = view(fresh).now;
        addLog(describe(r.halted, at));
        addLog([
          {
            at,
            tone: "negative",
            event: "Swap rejected",
            details: r.swapBlocked
              ? `A swap was refused: ${r.swapBlocked}`
              : "Unexpected: a swap would have gone through.",
          },
        ]);
        if (r.withdrawal) addLog(describe(r.withdrawal, at));
      }),
    haltEnds: () =>
      run("Halt ends", async (a, tl) => {
        const tx = await a.haltEnds(pool, tl);
        const fresh = await snapshot(4);
        addLog(describe(tx, view(fresh).now));
      }),
    monday: () =>
      run("Monday open", async (a, tl) => {
        const tx = await a.mondayOpen(pool, tl, oracleNow);
        const fresh = await snapshot(5);
        addLog(describe(tx, view(fresh).now));
      }),
  };
  const stepActions = [actions.friday, actions.news, actions.halt, actions.haltEnds, actions.monday];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning bg-warning-subtle px-6 py-3.5 text-warning">
        <Warning />
        <span className="text-[18px] font-semibold">Demo mode · devnet only · prices are simulated</span>
        <span className="ml-auto text-[15px]">This is a testing tool. Not financial advice.</span>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[380px_1fr]">
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between">
            <h1 className="text-[22px] font-bold">Demo control panel</h1>
            <span className="flex items-center gap-2 rounded-lg bg-subtle px-3 py-1.5 text-[14px] font-medium">
              <span className="size-2 rounded-full bg-positive" /> Devnet
            </span>
          </div>
          <p className="text-[15px] text-ink-2">
            Run a whole market week on {pool.meta.base} in about a minute. Every step is a real devnet transaction on a
            simulated clock.
          </p>
          <AdminKey admin={admin} setAdmin={setAdmin} error={keyError} setError={setKeyError} client={client} />
          {STEPS.map((s, i) => {
            const n = i + 1;
            const current = step === n;
            const done = step > n;
            return (
              <button
                key={s.title}
                type="button"
                disabled={!admin || !current || !!busy}
                onClick={stepActions[i]}
                className={cx(
                  "flex items-center gap-4 rounded-2xl border p-4 text-left transition-colors",
                  current ? "border-brand bg-brand-subtle" : "border-line",
                  current && admin && !busy && "hover:bg-brand/10",
                  !current && "opacity-80",
                )}
              >
                <span
                  className={cx(
                    "flex size-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold",
                    current ? "bg-brand text-white" : done ? "bg-positive-subtle" : "bg-subtle",
                  )}
                >
                  {done ? <CheckCircle size={22} /> : n}
                </span>
                <span className="min-w-0">
                  <span className={cx("block text-[17px] font-semibold", current && "text-brand")}>
                    {s.title}
                    {n === 2 && `: price ${newsPct > 0 ? "+" : ""}${newsPct}%`}
                    {busy === s.title || (n === 2 && busy === "Weekend news") ? "…" : ""}
                  </span>
                  <span className="block text-[13px] text-ink-2">{s.sub}</span>
                </span>
              </button>
            );
          })}
          <div className="flex items-center gap-2 text-[14px] text-ink-2">
            News direction:
            {([-10, 10] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setNewsPct(p)}
                className={cx("rounded-lg px-3 py-1", newsPct === p ? "bg-brand text-white" : "bg-subtle")}
              >
                {p > 0 ? "+" : ""}
                {p}%
              </button>
            ))}
          </div>
          <Button variant="soft" onClick={actions.reset} disabled={!admin || !!busy} className="w-full py-3.5">
            <Refresh /> {step === 0 ? "Start a simulated week" : "Reset (new week)"}
            {busy === "Start week" && "…"}
          </Button>
          {!t && admin && (
            <p className="text-[13px] text-ink-2">
              Start a simulated week first. It sets up Monday to Friday sessions and opens the market.
            </p>
          )}
          <FundWallet admin={admin} markets={markets ?? []} />
        </Card>

        <div className="flex flex-col gap-5">
          <Card className="p-6">
            <div className="flex flex-wrap items-start gap-4">
              <div className="mr-auto">
                <div className="flex items-center gap-3">
                  <h2 className="text-[28px] font-bold">
                    {pool.meta.base} / {pool.meta.quote}
                  </h2>
                  <Tag>Tokenized stock</Tag>
                </div>
                <p className="text-[15px] text-ink-2">
                  {t
                    ? `Simulated week: ${nyTime(t.weekStart).split(" · ")[0]} – ${nyTime(t.mondayOpen).split(" · ")[0]} · now ${nyTime(v.now)} (ET)`
                    : "No simulated week yet"}
                </p>
              </div>
              <label className="text-[14px] text-ink-2">
                Start price (Monday open)
                <span className="mt-1 flex gap-2">
                  <input
                    className="w-40 rounded-xl border border-line px-3 py-2.5 text-[17px] text-ink"
                    inputMode="decimal"
                    value={startPrice}
                    onChange={(e) => setStartPrice(e.target.value)}
                  />
                  <Button variant="soft" onClick={actions.reset} disabled={!admin || !!busy} className="px-5">
                    Apply
                  </Button>
                </span>
              </label>
            </div>
            <WeekChart m={pool} t={t} pts={pts} v={v} />
          </Card>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatBox
              icon={v.mode === "Closed" ? <MoonSmall size={22} /> : v.mode === "Paused" ? <Pause /> : <Sun />}
              label="Mode"
              value={v.mode}
              sub={
                v.mode === "Closed"
                  ? "Weekend · price protected"
                  : v.mode === "Paused"
                    ? "Swaps and deposits off"
                    : "Following the oracle"
              }
            />
            <StatBox
              icon={<BandArrows />}
              label="Band"
              value={v.band ? `±${(v.band.bps / 100).toFixed(1)}%` : "—"}
              sub={`Around ${price(v.reference)}`}
            />
            <StatBox
              icon={<Percent />}
              label="Fee"
              value={v.feeBps !== null ? bps(v.feeBps) : "—"}
              sub={v.mode === "Closed" ? "Weekend fee on swaps" : "Fee on swaps"}
            />
            <StatBox
              icon={<TrendUp />}
              label="Pool price"
              value={price(v.price)}
              sub={
                v.band && Math.min(Math.abs(v.price - v.band.low), Math.abs(v.price - v.band.high)) / v.price < 0.003
                  ? "At the band edge"
                  : `Oracle ${v.oraclePrice !== null ? price(v.oraclePrice) : "—"}`
              }
            />
          </div>
          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[22px] font-bold">Event log</h2>
              <label className="flex items-center gap-2 text-[14px] text-ink-2">
                Auto scroll
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="accent-[#4346e0]"
                />
              </label>
            </div>
            <div ref={logRef} className="max-h-[360px] overflow-y-auto rounded-xl border border-line">
              <table className="w-full text-left text-[14px]">
                <thead className="sticky top-0 bg-subtle text-ink-2">
                  <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
                    <th className="w-44">Time (simulated, ET)</th>
                    <th className="w-60">Event</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {!log.length && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-ink-2">
                        Events from each step appear here, straight from the program&apos;s transaction logs.
                      </td>
                    </tr>
                  )}
                  {log.map((r) => (
                    <tr key={r.id} className="border-t border-line align-top [&>td]:px-4 [&>td]:py-3">
                      <td className="whitespace-nowrap">{nyTime(r.at)}</td>
                      <td>
                        <span className="flex items-center gap-2 font-medium">
                          <span
                            className={cx(
                              "size-2.5 shrink-0 rounded-full",
                              {
                                neutral: "bg-neutral",
                                brand: "bg-brand",
                                negative: "bg-negative",
                                positive: "bg-positive",
                                warning: "bg-warning",
                              }[r.tone],
                            )}
                          />
                          {r.event}
                        </span>
                      </td>
                      <td className="text-ink-2">
                        {r.details}{" "}
                        {r.sig && (
                          <a href={explorerTx(r.sig)} target="_blank" rel="noreferrer" className="text-brand underline">
                            tx
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function StatBox({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[14px] text-ink-2">{label}</div>
        <div className="text-[26px] leading-tight font-bold">{value}</div>
        <div className="text-[13px] text-ink-2">{sub}</div>
      </div>
    </Card>
  );
}

/** Simulated week: oracle and pool price at each step, the weekend band, open/closed shading, step markers. */
function WeekChart({ m, t, pts, v }: { m: Market; t: DemoTimeline | null; pts: Pt[]; v: ReturnType<typeof view> }) {
  if (!t)
    return (
      <div className="mt-4 flex h-[300px] items-center justify-center rounded-xl bg-subtle text-ink-2">
        Load the admin key and start a simulated week.
      </div>
    );
  const now = Number(v.now);
  const live = { t: Math.min(now, Number(t.weekEnd)), oracle: v.oraclePrice ?? undefined, pool: v.price };
  const all = [...pts, live].filter((p) => p.t >= Number(t.weekStart));
  const p = m.info.state.params;
  // The weekend band around Friday's frozen price (recorded at step 1; the live reference moves again at the open).
  const ref = pts.find((x) => x.step === 1)?.pool ?? v.reference;
  const closedFrom = Number(t.fridayClose);
  const closedTo = Math.min(now, Number(t.mondayOpen));
  const band =
    now > closedFrom && (v.mode !== "Open" || now >= Number(t.mondayOpen))
      ? Array.from({ length: Math.max(2, Math.ceil((closedTo - closedFrom) / 3600) + 1) }, (_, i) => {
          const at = Math.min(closedFrom + i * 3600, closedTo);
          const b =
            Math.min(
              p.closedBaseBandBps + (p.closedBandGrowthBpsPerHour * (at - closedFrom)) / 3600,
              p.closedMaxBandBps,
            ) / 10_000;
          return { t: at, low: ref * (1 - b), high: ref * (1 + b) };
        })
      : undefined;
  // New York midnights (not +24h steps, which drift when the week crosses a daylight-saving change).
  const monday = nyDate(Number(t.weekStart) * 1000);
  const dayTicks = Array.from({ length: 8 }, (_, i) => Number(nyToUnix(addDays(monday, i), "00:00")));
  return (
    <div className="mt-4 rounded-2xl border border-line p-4">
      <Legend
        items={[
          { label: `Oracle price (${m.meta.base.replace(/x$/, "")})`, color: "#10a37f" },
          { label: "Pool price (Afterbell)", color: "#4346e0" },
          { label: "Allowed band (weekend)", color: "#daddfb", kind: "area" },
        ]}
      />
      <Chart
        height={330}
        xDomain={[dayTicks[0], Number(t.weekEnd)]}
        xTicks={dayTicks}
        xFmt={(x) => new Date(x * 1000).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" })}
        yFmt={(x) => `$${x.toFixed(0)}`}
        ranges={[{ from: closedFrom, to: Number(t.mondayOpen), label: "Market closed (weekend)" }]}
        band={band}
        refLine={
          pts.some((x) => x.step === 1) || v.mode !== "Open"
            ? { v: ref, label: `Friday close ${price(ref)}` }
            : undefined
        }
        markers={pts
          .filter((x, i, a) => x.step && a.findIndex((y) => y.step === x.step) === i)
          .map((x) => ({ t: x.t, label: String(x.step) }))}
        series={[
          {
            label: "Oracle",
            color: "#10a37f",
            points: all.filter((x) => x.oracle !== undefined).map((x) => ({ t: x.t, v: x.oracle as number })),
            step: true,
          },
          { label: "Pool", color: "#4346e0", points: all.map((x) => ({ t: x.t, v: x.pool as number })), step: true },
        ]}
      />
    </div>
  );
}

function AdminKey({
  admin,
  setAdmin,
  error,
  setError,
  client,
}: {
  admin: DemoAdmin | null;
  setAdmin: (a: DemoAdmin | null) => void;
  error: string | null;
  setError: (e: string | null) => void;
  client: ReturnType<typeof useMarkets>["client"];
}) {
  if (admin)
    return (
      <div className="flex items-center justify-between rounded-xl bg-positive-subtle px-4 py-3 text-[14px]">
        <span>
          Admin key loaded: <span className="font-mono">{admin.kp.publicKey.toBase58().slice(0, 4)}…</span>
        </span>
        <button type="button" className="text-ink-2 underline" onClick={() => setAdmin(null)}>
          Forget
        </button>
      </div>
    );
  return (
    <label className="block cursor-pointer rounded-xl border border-dashed border-brand bg-brand-subtle px-4 py-4 text-[14px]">
      <span className="font-semibold text-brand">Load the devnet admin key</span>
      <span className="mt-1 block text-ink-2">
        The keypair JSON file (e.g. ~/.config/solana/id.json). It stays in this tab&apos;s memory only and signs the
        demo steps. Devnet only.
      </span>
      <input
        type="file"
        accept=".json,application/json"
        className="sr-only"
        onChange={async (e) => {
          setError(null);
          try {
            const file = e.target.files?.[0];
            if (!file) return;
            const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await file.text())));
            const cfg = await client.program.account.globalConfig.fetch(client.config);
            if (!cfg.admin.equals(kp.publicKey)) throw new Error("This key is not the pool admin on this network.");
            setAdmin(new DemoAdmin(client, kp));
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            e.target.value = "";
          }
        }}
      />
      {error && <span className="mt-2 block text-negative">{error}</span>}
    </label>
  );
}

function FundWallet({ admin, markets }: { admin: DemoAdmin | null; markets: Market[] }) {
  const { publicKey } = useWallet();
  const [state, setState] = useState<string | null>(null);
  if (!admin || !publicKey) return null;
  return (
    <div className="rounded-xl bg-subtle p-4 text-[14px]">
      <div className="font-medium">Test tokens for your wallet</div>
      <p className="mt-1 text-ink-2">Mints 1,000 USDC and 5 of each other test token to the connected wallet.</p>
      <Button
        variant="soft"
        className="mt-2 w-full py-2"
        onClick={async () => {
          setState("Sending…");
          try {
            const tx = await admin.fundWallet(markets, publicKey);
            setState(`Sent. ${tx.sig.slice(0, 8)}…`);
          } catch (e) {
            setState(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Send test tokens
      </Button>
      {state && <p className="mt-2 text-ink-2">{state}</p>}
    </div>
  );
}
