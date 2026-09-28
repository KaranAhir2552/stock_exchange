"use client";
import { AfterbellError, type Direction, quoteSwap } from "@afterbell/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { useBalances } from "@/lib/balances";
import { explorerTx, pools } from "@/lib/config";
import { bps, nyWeekday, price, toAtoms, tokens, usd } from "@/lib/format";
import { type Market, poolNow, useMarkets, useTick, view } from "@/lib/market";
import { ensureAta, useSendTx } from "@/lib/tx";
import { BandBar } from "./BandBar";
import { ChevronDown, MoonSmall, Pause, Settings, Sun, SwapVert } from "./icons";
import { Button, cx, Row, Segmented, Tag, TokenAvatar } from "./ui";

const SLIPPAGES = ["0.1", "0.5", "1.0"] as const;

export const TIPS = {
  band: "While the stock market is closed, the pool price may only move within this range around the last official price. The range widens slowly the longer the market stays closed.",
  weekendFee:
    "Fees are higher while the market is closed, because liquidity providers take more risk when there is no official price. The extra goes to them.",
  impact: "How much your trade moves the pool price. Bigger trades move it more.",
  oracle: "The official price from the price feed (the oracle). While the market is open, the pool follows it.",
  fee: "Paid by the trader and kept in the pool for liquidity providers.",
};

/** "Friday close" when the last official price was on a Friday, else "Last close". */
export const closeLabel = (closeTs: bigint) => (nyWeekday(closeTs) === "Friday" ? "Friday close" : "Last close");

export function SwapCard({
  market,
  onPool,
  compact,
}: {
  market: Market;
  onPool: (address: string) => void;
  compact?: boolean;
}) {
  const { reload, client } = useMarkets();
  const local = useTick();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const balances = useBalances();
  const [dir, setDir] = useState<Direction>("QuoteToBase");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<(typeof SLIPPAGES)[number]>("0.5");
  const [showSettings, setShowSettings] = useState(false);
  const tx = useSendTx(() => {
    setAmount("");
    reload();
  });

  const v = view(market, local);
  const a = market.info.accounts;
  const s = market.info.state;
  const { base, quote } = market.meta;
  const [inSym, outSym] = dir === "QuoteToBase" ? [quote, base] : [base, quote];
  const [inDec, outDec] = dir === "QuoteToBase" ? [s.quoteDecimals, s.baseDecimals] : [s.baseDecimals, s.quoteDecimals];
  const [inMint, outMint] = dir === "QuoteToBase" ? [a.quoteMint, a.baseMint] : [a.baseMint, a.quoteMint];
  const outProgram = dir === "QuoteToBase" ? a.baseTokenProgram : a.quoteTokenProgram;
  const amountIn = toAtoms(amount, inDec);
  const inBalance = balances?.[inMint.toBase58()];
  const toUsd = (atoms: bigint, sym: string, dec: number) =>
    (Number(atoms) / 10 ** dec) * (sym === quote ? 1 : v.price);

  const quoted = useMemo(() => {
    if (!market.ctx || amountIn === 0n) return null;
    try {
      const q = quoteSwap(market.info.state, market.reserves, amountIn, dir, {
        ...market.ctx,
        now: poolNow(market, local),
      });
      return { ok: true as const, q };
    } catch (e) {
      return { ok: false as const, error: e instanceof AfterbellError ? e.name : String(e) };
    }
  }, [market, amountIn, dir, local]);
  const q = quoted?.ok ? quoted.q : null;
  const impact = q ? (Math.abs(Number(q.newPrice - s.poolPrice)) / Number(s.poolPrice)) * 100 : null;
  const rate = q && q.amountOut > 0n ? toUsd(amountIn, inSym, inDec) / (Number(q.amountOut) / 10 ** outDec) : null;
  const effPrice = q
    ? dir === "QuoteToBase"
      ? rate
      : Number(q.amountOut) / 10 ** outDec / (Number(amountIn) / 10 ** inDec)
    : null;
  const refLabel = closeLabel(v.closeTs);

  const errorText: Record<string, string> = {
    OutsideBand: "This trade would push the price outside the allowed range. Try a smaller amount.",
    PoolPaused: "Trading is paused.",
    InsufficientLiquidity: "Not enough liquidity in the pool for this trade.",
    ZeroAmount: "Amount too small.",
  };

  async function submit() {
    if (!publicKey || !q) return;
    const minOut = (q.amountOut * (10_000n - BigInt(Math.round(Number(slippage) * 100)))) / 10_000n;
    await tx.send([
      ensureAta(publicKey, publicKey, outMint, outProgram),
      await client.swap(a, publicKey, amountIn, minOut, dir),
    ]);
  }

  let cta: { label: string; variant: "primary" | "positive" | "disabled"; action?: () => void };
  if (!publicKey) cta = { label: "Connect wallet to swap", variant: "primary", action: () => setVisible(true) };
  else if (v.mode === "Paused") cta = { label: "Swaps paused", variant: "disabled" };
  else if (amountIn === 0n) cta = { label: "Enter an amount", variant: "disabled" };
  else if (quoted && !quoted.ok) cta = { label: "Can't swap this amount", variant: "disabled" };
  else if (inBalance !== undefined && amountIn > inBalance) cta = { label: `Not enough ${inSym}`, variant: "disabled" };
  else if (tx.state.status === "pending") cta = { label: "Confirm in your wallet…", variant: "disabled" };
  else
    cta = { label: `Swap ${inSym} for ${outSym}`, variant: v.mode === "Open" ? "positive" : "primary", action: submit };

  const paused = v.mode === "Paused";
  const baseSelector = (
    <label className="relative flex items-center gap-2.5 rounded-xl border border-line bg-surface py-2 pr-3.5 pl-2">
      <TokenAvatar symbol={base} />
      <select
        className="appearance-none bg-transparent pr-6 text-[18px] font-semibold outline-none"
        value={a.address.toBase58()}
        onChange={(e) => onPool(e.target.value)}
        aria-label="Token"
      >
        {pools.map((p) => (
          <option key={p.address.toBase58()} value={p.address.toBase58()}>
            {p.base}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3" />
    </label>
  );
  const quoteToken = (
    <span className="flex items-center gap-2.5 rounded-xl border border-line bg-surface py-2 pr-4 pl-2">
      <TokenAvatar symbol={quote} />
      <span className="text-[18px] font-semibold">{quote}</span>
    </span>
  );
  const box = (label: string, sym: string, dec: number, value: ReactNode, isInput: boolean) => (
    <div className="flex gap-4 rounded-[14px] border border-line bg-surface py-4 pr-4 pl-[18px]">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[14px] text-ink-2">{label}</span>
        {value}
        <span className="text-[13px] text-ink-2">
          ≈ {usd(isInput ? toUsd(amountIn, sym, dec) : q ? toUsd(q.amountOut, sym, dec) : 0)}
        </span>
      </div>
      <div className="flex flex-col items-end gap-2.5">
        {sym === quote ? quoteToken : baseSelector}
        {isInput ? (
          <button
            type="button"
            className="text-[14px] text-ink-2 hover:text-brand"
            onClick={() => inBalance !== undefined && setAmount(String(Number(inBalance) / 10 ** dec))}
          >
            Balance: {inBalance === undefined ? "—" : tokens(inBalance, dec, 2)}
          </button>
        ) : sym === base ? (
          <Tag>{market.meta.label}</Tag>
        ) : (
          <span className="text-[14px] text-ink-2">
            Balance: {balances ? tokens(balances[outMint.toBase58()] ?? 0n, dec, 2) : "—"}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div
      className={cx(
        "flex flex-col gap-4",
        compact ? "" : "rounded-[18px] border border-line bg-surface p-6 shadow-card",
      )}
    >
      {!compact && (
        <div className="flex items-center justify-between">
          <h1 className="text-[28px] font-bold">Swap</h1>
          <SettingsButton open={showSettings} setOpen={setShowSettings} slippage={slippage} setSlippage={setSlippage} />
        </div>
      )}
      <div className={cx("relative flex flex-col gap-3", paused && "opacity-60")}>
        {box(
          "You pay",
          inSym,
          inDec,
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(",", "."))}
            className="w-full bg-transparent text-[30px] font-bold outline-none placeholder:text-muted"
            aria-label={`Amount of ${inSym} to pay`}
          />,
          true,
        )}
        <button
          type="button"
          onClick={() => {
            setDir((d) => (d === "QuoteToBase" ? "BaseToQuote" : "QuoteToBase"));
            setAmount("");
          }}
          className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line bg-surface p-2.5 shadow-card hover:text-brand"
          aria-label="Switch direction"
        >
          <SwapVert />
        </button>
        {box(
          "You receive",
          outSym,
          outDec,
          <span className="text-[30px] font-bold">{q ? tokens(q.amountOut, outDec, 4) : "0.00"}</span>,
          false,
        )}
      </div>

      <StatusBanner market={market} v={v} refLabel={refLabel} />

      {quoted && !quoted.ok && (
        <p className="rounded-xl bg-warning-subtle px-4 py-3 text-[14px] text-warning" role="alert">
          {errorText[quoted.error] ?? quoted.error}
        </p>
      )}

      <div className="rounded-xl border border-line px-4 py-1">
        <Row
          muted={paused}
          label="Rate"
          value={
            effPrice ? `1 ${base} = ${effPrice.toFixed(2)} ${quote}` : `1 ${base} = ${v.price.toFixed(2)} ${quote}`
          }
        />
        <Row
          muted={paused}
          label={v.mode === "Closed" ? "Weekend fee" : "Fee"}
          tip={v.mode === "Closed" ? TIPS.weekendFee : TIPS.fee}
          value={q ? bps(q.feeBps) : v.feeBps !== null ? bps(v.feeBps) : "—"}
        />
        <Row
          muted={paused}
          label="Price impact"
          tip={TIPS.impact}
          value={impact !== null ? `${impact.toFixed(2)}%` : "—"}
        />
        {v.mode === "Closed" ? (
          <>
            <Row label={refLabel} value={price(v.reference)} />
            <Row
              label="Range widens"
              tip={TIPS.band}
              value={`+${bps(v.params.closedBandGrowthBpsPerHour)}/hour, up to ±${bps(v.params.closedMaxBandBps, 1)}`}
            />
          </>
        ) : (
          <Row
            muted={paused}
            label="Oracle price"
            tip={TIPS.oracle}
            value={v.oraclePrice !== null ? price(v.oraclePrice) : "—"}
          />
        )}
        <Row muted={paused} label="Max slippage" value={`${slippage}%`} />
      </div>

      <Button
        variant={cta.variant}
        onClick={cta.action}
        className="w-full py-[18px] text-[17px]"
        disabled={cta.variant === "disabled"}
      >
        {cta.label}
      </Button>
      {tx.state.status === "done" && (
        <p className="text-center text-[14px] text-positive">
          Swap confirmed.{" "}
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
    </div>
  );
}

function SettingsButton({
  open,
  setOpen,
  slippage,
  setSlippage,
}: {
  open: boolean;
  setOpen: (f: (o: boolean) => boolean) => void;
  slippage: (typeof SLIPPAGES)[number];
  setSlippage: (s: (typeof SLIPPAGES)[number]) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-[10px] border border-line bg-surface p-2.5 hover:text-brand"
        aria-label="Swap settings"
      >
        <Settings />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="mb-2 text-[14px] font-medium">Max slippage</div>
          <Segmented
            options={SLIPPAGES.map((x) => ({ value: x, label: `${x}%` }))}
            value={slippage}
            onChange={setSlippage}
          />
          <p className="mt-2 text-[12px] text-ink-2">Your swap fails instead of filling at a worse price than this.</p>
        </div>
      )}
    </div>
  );
}

function StatusBanner({ market, v, refLabel }: { market: Market; v: ReturnType<typeof view>; refLabel: string }) {
  if (v.mode === "Closed" && v.band)
    return (
      <div className="flex flex-col gap-3.5 rounded-[14px] bg-brand-subtle p-[18px]">
        <div className="flex items-start gap-3.5">
          <MoonSmall size={26} className="mt-0.5 text-brand" />
          <div>
            <div className="text-[20px] font-semibold text-brand">Market closed · price protected</div>
            <div className="text-[14px] text-ink-2">
              Price can move between {price(v.band.low)} and {price(v.band.high)} until the market opens.
            </div>
          </div>
        </div>
        <BandBar
          low={v.band.low}
          high={v.band.high}
          reference={v.reference}
          current={v.price}
          referenceLabel={refLabel}
        />
      </div>
    );
  if (v.mode === "Paused")
    return (
      <div className="flex gap-4 rounded-[14px] bg-warning-subtle p-[18px]">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning text-white">
          <Pause />
        </span>
        <div className="flex flex-col gap-1.5">
          <div className="text-[22px] font-semibold text-warning">Trading paused</div>
          <p className="text-[15px] text-ink-2">
            {market.info.state.halted
              ? `Trading in ${market.meta.base} is halted. `
              : "The price feed is not confirming a fresh price right now, so the pool is paused to be safe. "}
            Swaps and deposits are off until it resumes. You can still withdraw liquidity anytime.
          </p>
          <Link href="/liquidity" className="text-[15px] font-medium text-warning underline">
            Go to Liquidity to withdraw →
          </Link>
        </div>
      </div>
    );
  return (
    <div className="flex items-center gap-3 rounded-[14px] bg-positive-subtle px-4 py-3.5 text-[15px]">
      <Sun className="text-positive" />
      <span>
        <span className="font-semibold text-positive">
          {market.meta.kind === "Crypto" ? "Trading 24/7" : "Market open"}
        </span>
        <span className="text-ink-2"> · price follows the oracle</span>
      </span>
      {v.oracleAgeSecs !== null && (
        <span className="ml-auto flex items-center gap-2 text-[14px] text-ink-2">
          <span className="size-2 rounded-full bg-positive" /> Updated {Math.max(0, v.oracleAgeSecs)}s ago
        </span>
      )}
    </div>
  );
}
