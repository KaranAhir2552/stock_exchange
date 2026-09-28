"use client";
import { AfterbellError, MIN_LIQUIDITY, proportionalDeposit, withdrawAmounts } from "@afterbell/sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowUpRight, Database, Info, MoonLarge, Plus, TrendUp } from "@/components/icons";
import { Button, Callout, Card, ComingSoon, PairAvatar, Segmented, Skeleton, TokenAvatar } from "@/components/ui";
import { WeekTimeline } from "@/components/WeekTimeline";
import { useBalances } from "@/lib/balances";
import { explorerTx, pools } from "@/lib/config";
import { toAtoms, tokens, usd } from "@/lib/format";
import { type Market, useMarkets, useTick, view } from "@/lib/market";
import { ensureAta, useSendTx } from "@/lib/tx";

export default function LiquidityPage() {
  return (
    <Suspense>
      <Liquidity />
    </Suspense>
  );
}

function Liquidity() {
  const { markets } = useMarkets();
  const params = useSearchParams();
  const router = useRouter();
  const m = markets?.find((x) => x.meta.address.toBase58() === params.get("pool")) ?? markets?.[0] ?? null;
  const setPool = (a: string) => router.replace(`/liquidity?pool=${a}`, { scroll: false });
  return (
    <>
      <WeekTimeline market={m?.meta.kind === "Stock" ? m : undefined} />
      {m ? (
        <div className="grid items-start gap-5 lg:grid-cols-[1fr_460px]">
          <Position m={m} setPool={setPool} />
          <Manage m={m} />
        </div>
      ) : (
        <Skeleton className="h-[700px] w-full rounded-[18px]" />
      )}
      <HowItWorks />
    </>
  );
}

/** LP share maths in the program counts the permanently locked minimum as supply (DECISIONS.md #16). */
const effSupply = (m: Market) => m.lpSupply + MIN_LIQUIDITY;

function Position({ m, setPool }: { m: Market; setPool: (a: string) => void }) {
  const { publicKey } = useWallet();
  const balances = useBalances();
  const v = view(m, useTick(5_000));
  const lp = balances?.[m.info.accounts.lpMint.toBase58()] ?? 0n;
  const supply = effSupply(m);
  const myBase = (m.reserves.base * lp) / supply;
  const myQuote = (m.reserves.quote * lp) / supply;
  const { baseDecimals: bd, quoteDecimals: qd } = m.info.state;
  const value = (Number(myBase) / 10 ** bd) * v.price + Number(myQuote) / 10 ** qd;
  const share = Number(lp) / Number(supply);

  return (
    <Card className="flex flex-col gap-6 p-7">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[28px] font-bold">Your position</h1>
        <Button variant="soft" href={`/pools/${m.meta.address.toBase58()}`} className="px-4 py-2 text-[15px]">
          View pool details <ArrowUpRight size={16} />
        </Button>
      </div>
      <div className="flex items-center gap-4">
        <PairAvatar base={m.meta.base} quote={m.meta.quote} size={52} />
        <div>
          <select
            className="bg-transparent text-[24px] font-semibold outline-none"
            value={m.meta.address.toBase58()}
            onChange={(e) => setPool(e.target.value)}
            aria-label="Pool"
          >
            {pools.map((p) => (
              <option key={p.address.toBase58()} value={p.address.toBase58()}>
                {p.base} / {p.quote}
              </option>
            ))}
          </select>
          <div className="text-[16px] text-ink-2">{m.meta.label}</div>
        </div>
      </div>
      {!publicKey ? (
        <p className="rounded-xl bg-subtle p-5 text-[15px] text-ink-2">Connect your wallet to see your position.</p>
      ) : (
        <>
          <div>
            <div className="text-[16px] text-ink-2">Total value</div>
            <div className="text-[52px] leading-tight font-bold">
              {balances ? usd(value) : <Skeleton className="h-12 w-60" />}
            </div>
            <div className="text-[15px] text-ink-2">
              {tokens(myBase, bd, 4)} {m.meta.base} + {tokens(myQuote, qd, 2)} {m.meta.quote} · {tokens(lp, 9, 4)} LP
              tokens
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-line p-5">
              <div className="text-[15px] text-ink-2">Pool share</div>
              <div className="mt-1 text-[28px] font-bold">
                {(share * 100).toFixed(share > 0 && share < 0.001 ? 4 : 2)}%
              </div>
            </div>
            <div className="rounded-2xl border border-line p-5">
              <div className="text-[15px] text-ink-2">Fees earned</div>
              <div className="mt-2 inline-block rounded-full bg-brand-subtle px-3 py-1 text-[12px] font-semibold text-brand uppercase">
                Coming soon
              </div>
            </div>
            <div className="rounded-2xl bg-brand-subtle p-5">
              <div className="text-[15px] text-brand">Weekend fees earned</div>
              <div className="mt-2 inline-block rounded-full bg-surface px-3 py-1 text-[12px] font-semibold text-brand uppercase">
                Coming soon
              </div>
            </div>
          </div>
        </>
      )}
      <div>
        <h2 className="mb-3 text-[18px] font-semibold">Fees earned per day</h2>
        <ComingSoon what="Daily fees (market open vs market closed) will appear here once the event indexer is running." />
      </div>
    </Card>
  );
}

function Manage({ m }: { m: Market }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { client, reload } = useMarkets();
  const balances = useBalances();
  const v = view(m, useTick(5_000));
  const [tab, setTab] = useState<"Add" | "Remove">("Add");
  const [baseStr, setBaseStr] = useState("");
  const [quoteStr, setQuoteStr] = useState("");
  const [pct, setPct] = useState(0);
  const tx = useSendTx(() => {
    setBaseStr("");
    setQuoteStr("");
    setPct(0);
    reload();
  });
  const a = m.info.accounts;
  const { baseDecimals: bd, quoteDecimals: qd } = m.info.state;
  const { base: rb, quote: rq } = m.reserves;
  const supply = effSupply(m);
  const lpBal = balances?.[a.lpMint.toBase58()] ?? 0n;
  const bal = (mint: typeof a.baseMint) => balances?.[mint.toBase58()];

  // Keep the two amounts at the pool's ratio: whichever the user types drives the other.
  const onBase = (s: string) => {
    setBaseStr(s);
    const b = toAtoms(s, bd);
    setQuoteStr(rb > 0n && b > 0n ? (Number((b * rq) / rb) / 10 ** qd).toFixed(2) : "");
  };
  const onQuote = (s: string) => {
    setQuoteStr(s);
    const q = toAtoms(s, qd);
    setBaseStr(rq > 0n && q > 0n ? (Number((q * rb) / rq) / 10 ** bd).toFixed(6) : "");
  };

  const maxBase = toAtoms(baseStr, bd);
  const maxQuote = toAtoms(quoteStr, qd);
  let dep: ReturnType<typeof proportionalDeposit> | null = null;
  let depErr: string | null = null;
  if (maxBase > 0n && maxQuote > 0n) {
    try {
      dep = proportionalDeposit(maxBase, maxQuote, rb, rq, supply);
    } catch (e) {
      depErr = e instanceof AfterbellError ? e.name : String(e);
    }
  }
  const lpOut = (lpBal * BigInt(pct)) / 100n;
  let wd: [bigint, bigint] | null = null;
  try {
    wd = lpOut > 0n ? withdrawAmounts(lpOut, rb, rq, supply) : null;
  } catch {
    wd = null;
  }
  const slip = (x: bigint) => (x * 995n) / 1000n; // 0.5%

  async function deposit() {
    if (!publicKey || !dep) return;
    await tx.send([
      ensureAta(publicKey, publicKey, a.lpMint, TOKEN_PROGRAM_ID),
      await client.deposit(a, publicKey, maxBase, maxQuote, slip(dep.lp)),
    ]);
  }
  async function withdraw() {
    if (!publicKey || !wd) return;
    await tx.send([
      ensureAta(publicKey, publicKey, a.baseMint, a.baseTokenProgram),
      ensureAta(publicKey, publicKey, a.quoteMint, a.quoteTokenProgram),
      await client.withdraw(a, publicKey, lpOut, slip(wd[0]), slip(wd[1])),
    ]);
  }

  const insufficient =
    (bal(a.baseMint) !== undefined && maxBase > (bal(a.baseMint) ?? 0n)) ||
    (bal(a.quoteMint) !== undefined && maxQuote > (bal(a.quoteMint) ?? 0n));

  const tokenBox = (
    sym: string,
    value: string,
    onChange: (s: string) => void,
    balAtoms: bigint | undefined,
    dec: number,
  ) => (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2.5 rounded-xl border border-line py-2 pr-4 pl-2">
          <TokenAvatar symbol={sym} />
          <span className="text-[18px] font-semibold">{sym}</span>
        </span>
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(",", "."))}
          className="w-full bg-transparent text-right text-[26px] font-bold outline-none placeholder:text-muted"
          aria-label={`${sym} amount`}
        />
      </div>
      <div className="mt-2 text-[14px] text-ink-2">
        Balance: {balAtoms === undefined ? "—" : tokens(balAtoms, dec, 4)}
      </div>
    </div>
  );

  return (
    <Card className="flex flex-col gap-5 p-6">
      <Segmented options={["Add", "Remove"] as const} value={tab} onChange={setTab} className="w-full" />
      {tab === "Add" ? (
        <>
          <div>
            <h2 className="text-[20px] font-semibold">Add liquidity</h2>
            <p className="text-[15px] text-ink-2">Deposit both tokens to earn trading fees.</p>
          </div>
          <div className="relative flex flex-col gap-3">
            {tokenBox(m.meta.base, baseStr, onBase, bal(a.baseMint), bd)}
            <span className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line bg-surface p-1.5">
              <Plus />
            </span>
            {tokenBox(m.meta.quote, quoteStr, onQuote, bal(a.quoteMint), qd)}
          </div>
          <Callout tone="brand" icon={<Info />}>
            Deposits are added at the current pool ratio.
          </Callout>
          <div className="flex items-center justify-between rounded-2xl border border-line p-4">
            <div>
              <div className="text-[14px] text-ink-2">You will receive</div>
              <div className="text-[22px] font-bold">{dep ? `${tokens(dep.lp, 9, 4)} LP tokens` : "—"}</div>
            </div>
            <div className="text-right">
              <div className="text-[14px] text-ink-2">Pool share (est.)</div>
              <div className="text-[16px] font-semibold text-positive">
                {dep ? `${((Number(lpBal + dep.lp) / Number(supply + dep.lp)) * 100).toFixed(2)}%` : "—"}
              </div>
            </div>
          </div>
          {!publicKey ? (
            <Button className="w-full py-4 text-[17px]" onClick={() => setVisible(true)}>
              Connect wallet
            </Button>
          ) : (
            <Button
              className="w-full py-4 text-[17px]"
              variant={
                v.mode === "Paused" || !dep || insufficient || tx.state.status === "pending" ? "disabled" : "primary"
              }
              onClick={deposit}
            >
              {v.mode === "Paused"
                ? "Deposits paused"
                : insufficient
                  ? "Not enough balance"
                  : depErr
                    ? "Amount too small"
                    : tx.state.status === "pending"
                      ? "Confirm in your wallet…"
                      : "Add liquidity"}
            </Button>
          )}
        </>
      ) : (
        <>
          <div>
            <h2 className="text-[20px] font-semibold">Remove liquidity</h2>
            <p className="text-[15px] text-ink-2">Get your share of both tokens back, in any market state.</p>
          </div>
          <div className="rounded-2xl border border-line p-5">
            <div className="text-[14px] text-ink-2">Amount to withdraw</div>
            <div className="text-[40px] font-bold">{pct}%</div>
            <input
              type="range"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="w-full accent-[#4346e0]"
              aria-label="Percent of your LP tokens"
            />
            <div className="mt-2 flex gap-2">
              {[25, 50, 75, 100].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPct(p)}
                  className="flex-1 rounded-lg bg-subtle py-2 text-[14px] font-medium hover:text-brand"
                >
                  {p === 100 ? "Max" : `${p}%`}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-line p-4 text-[15px]">
            <div className="text-[14px] text-ink-2">You will receive</div>
            <div className="mt-1 font-semibold">
              {wd ? `${tokens(wd[0], bd, 4)} ${m.meta.base} + ${tokens(wd[1], qd, 2)} ${m.meta.quote}` : "—"}
            </div>
          </div>
          {!publicKey ? (
            <Button className="w-full py-4 text-[17px]" onClick={() => setVisible(true)}>
              Connect wallet
            </Button>
          ) : (
            <Button
              className="w-full py-4 text-[17px]"
              variant={!wd || tx.state.status === "pending" ? "disabled" : "primary"}
              onClick={withdraw}
            >
              {lpBal === 0n
                ? "No liquidity to withdraw"
                : tx.state.status === "pending"
                  ? "Confirm in your wallet…"
                  : "Withdraw"}
            </Button>
          )}
        </>
      )}
      {tx.state.status === "done" && (
        <p className="text-center text-[14px] text-positive">
          Confirmed.{" "}
          <a className="underline" href={explorerTx(tx.state.sig)} target="_blank" rel="noreferrer">
            View on explorer
          </a>
        </p>
      )}
      {tx.state.status === "error" && (
        <p className="text-center text-[14px] text-negative" role="alert">
          {tx.state.message}
        </p>
      )}
      <Callout>Withdrawals always work, even when trading is paused.</Callout>
    </Card>
  );
}

function HowItWorks() {
  const items = [
    {
      icon: <Database />,
      title: "Earn fees from every trade",
      text: "Liquidity providers (LPs) earn a share of every swap fee in the pool, on weekdays and on weekends.",
    },
    {
      icon: <MoonLarge />,
      title: "A weekend band protects you",
      text: "While the stock market is closed, the pool price can only move within a band around the last official price, so nobody can drain the pool at stale prices.",
    },
    {
      icon: <TrendUp />,
      title: "The price re-centres at the open",
      text: "When the market opens, the pool price jumps straight to the official price with no trade, so nobody profits from the gap at LPs' expense.",
    },
  ];
  return (
    <Card className="p-7">
      <h2 className="mb-5 text-[22px] font-bold">How it works</h2>
      <div className="grid gap-8 md:grid-cols-3">
        {items.map((i) => (
          <div key={i.title} className="flex gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand">
              {i.icon}
            </span>
            <div>
              <div className="text-[17px] font-semibold">{i.title}</div>
              <p className="mt-1 text-[15px] text-ink-2">{i.text}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-[14px] text-ink-2">
        See the numbers on the{" "}
        <Link href="/results" className="text-brand underline">
          backtest results
        </Link>{" "}
        page.
      </p>
    </Card>
  );
}
