"""Backtest entry point: `pnpm backtest` (or `uv run python run.py` in backtest/).
Downloads daily prices (cached in data/), finds the 20 largest Friday-close -> Monday-open gaps,
simulates both pools, and writes output/results.json and output/*.png."""

import datetime as dt
import json
from pathlib import Path

import pandas as pd
import yfinance as yf

import dataclasses

import afterbell_math as m
import charts
from simulate import WEEKEND_SECS, afterbell, plain_cpmm

ROOT = Path(__file__).parent
DATA = ROOT / "data"
OUT = ROOT / "output"

TICKERS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD",
           "NFLX", "AVGO", "JPM", "COIN", "PLTR", "MSTR", "INTC", "BA"]
START = "2021-01-01"
N_EVENTS = 20
QUOTE_USD = 40_000  # per side, same as the devnet seed (scripts --seed-usd default)

CAMEL_TO_SNAKE = {
    "openBandBps": "open_band_bps", "closedBaseBandBps": "closed_base_band_bps",
    "closedBandGrowthBpsPerHour": "closed_band_growth_bps_per_hour", "closedMaxBandBps": "closed_max_band_bps",
    "openFeeBps": "open_fee_bps", "closedBaseFeeBps": "closed_base_fee_bps",
    "closedFeeGrowthBpsPerHour": "closed_fee_growth_bps_per_hour", "closedMaxFeeBps": "closed_max_fee_bps",
    "sizeFeeBpsPer1PctDepth": "size_fee_bps_per_1pct_depth", "depthBps": "depth_bps", "maxTvlQuote": "max_tvl_quote",
}


def devnet_params() -> tuple[m.Params, dict]:
    cfg = json.loads((ROOT.parent / "config/devnet.json").read_text())
    stock = next(p for p in cfg["pools"] if p["profile"] == "UsEquity")
    raw = stock["params"]
    return m.Params(**{CAMEL_TO_SNAKE[k]: int(v) for k, v in raw.items()}), raw


def prices(end: str) -> pd.DataFrame:
    """Daily split/dividend-adjusted Open/Close per ticker, cached so reruns don't hit Yahoo."""
    DATA.mkdir(exist_ok=True)
    cache = DATA / f"prices_{START}_{end}.csv"
    if cache.exists():
        return pd.read_csv(cache, parse_dates=["Date"])
    raw = yf.download(TICKERS, start=START, end=end, interval="1d", auto_adjust=True, progress=False, group_by="ticker")
    frames = []
    for t in TICKERS:
        d = raw[t][["Open", "Close"]].dropna().reset_index()
        d["Ticker"] = t
        frames.append(d)
    df = pd.concat(frames, ignore_index=True)
    df.to_csv(cache, index=False)
    return df


def weekend_gaps(df: pd.DataFrame) -> pd.DataFrame:
    """Consecutive trading days Friday -> the following Monday (3 calendar days apart)."""
    rows = []
    for t, d in df.sort_values("Date").groupby("Ticker"):
        d = d.reset_index(drop=True)
        fri, mon = d.iloc[:-1], d.iloc[1:].reset_index(drop=True)
        ok = (fri["Date"].dt.weekday == 4) & (mon["Date"].dt.weekday == 0) & ((mon["Date"] - fri["Date"]).dt.days == 3)
        for f, n in zip(fri[ok].itertuples(), mon[ok].itertuples()):
            rows.append({"ticker": t, "friday": f.Date.date(), "monday": n.Date.date(),
                         "fridayClose": float(f.Close), "mondayOpen": float(n.Open)})
    g = pd.DataFrame(rows)
    g["gapPct"] = (g["mondayOpen"] / g["fridayClose"] - 1) * 100
    return g.reindex(g["gapPct"].abs().sort_values(ascending=False).index).head(N_EVENTS).reset_index(drop=True)


def main():
    end = dt.date.today().isoformat()
    params, raw_params = devnet_params()
    df = prices(end)
    events = weekend_gaps(df)
    OUT.mkdir(exist_ok=True)

    results = []
    for e in events.itertuples():
        a = plain_cpmm(e.fridayClose, e.mondayOpen, params.open_fee_bps, QUOTE_USD)
        b = afterbell(e.fridayClose, e.mondayOpen, params, QUOTE_USD)
        pct = lambda o: 100 * o.lp_vs_hodl_usd / o.hodl_usd  # noqa: E731
        results.append({
            "ticker": e.ticker, "friday": str(e.friday), "monday": str(e.monday),
            "fridayClose": round(e.fridayClose, 4), "mondayOpen": round(e.mondayOpen, 4), "gapPct": round(e.gapPct, 3),
            **{name: {
                "lpUsd": round(o.lp_usd, 2), "hodlUsd": round(o.hodl_usd, 2),
                "lpVsHodlUsd": round(o.lp_vs_hodl_usd, 2), "lpVsHodlPct": round(pct(o), 4),
                "feesUsd": round(o.fees_usd, 2), "staleLossUsd": round(o.stale_loss_usd, 2),
                "traderProfitUsd": round(o.trader_profit_usd, 2), "trades": o.trades,
                **{k: (round(v, 4) if isinstance(v, float) else v) for k, v in o.detail.items()},
            } for name, o in (("plain", a), ("afterbell", b))},
        })

    def total(name, key):
        return round(sum(r[name][key] for r in results), 2)

    plain_loss, ab_loss = -total("plain", "lpVsHodlUsd"), -total("afterbell", "lpVsHodlUsd")
    summary = {
        name: {
            "totalLpVsHodlUsd": total(name, "lpVsHodlUsd"),
            "meanLpVsHodlPct": round(sum(r[name]["lpVsHodlPct"] for r in results) / len(results), 4),
            "worstLpVsHodlPct": round(min(r[name]["lpVsHodlPct"] for r in results), 4),
            "totalFeesUsd": total(name, "feesUsd"),
            "totalStaleLossUsd": total(name, "staleLossUsd"),
        }
        for name in ("plain", "afterbell")
    }
    summary["lossReductionPct"] = round(100 * (1 - ab_loss / plain_loss), 2) if plain_loss > 0 else None

    # Sensitivity: same events, alternative closed-market settings (devnet params unchanged).
    plain_total = -summary["plain"]["totalLpVsHodlUsd"]
    variants = {
        "devnet (2% +0.10%/h, cap 10%)": {},
        "slower band (2% +0.05%/h)": {"closed_band_growth_bps_per_hour": 5},
        "flat 5% band": {"closed_base_band_bps": 500, "closed_band_growth_bps_per_hour": 0, "closed_max_band_bps": 500},
        "flat 2% band": {"closed_band_growth_bps_per_hour": 0, "closed_max_band_bps": 200},
        "devnet band, 1.5% base fee": {"closed_base_fee_bps": 150},
        "wider band (2% +0.30%/h, cap 20%)": {"closed_band_growth_bps_per_hour": 30, "closed_max_band_bps": 2000},
    }
    sensitivity = []
    for label, change in variants.items():
        v = dataclasses.replace(params, **change)
        loss = -sum(afterbell(e.fridayClose, e.mondayOpen, v, QUOTE_USD).lp_vs_hodl_usd for e in events.itertuples())
        sensitivity.append({"variant": label, "changes": change, "totalLossUsd": round(loss, 2),
                            "lossReductionVsPlainPct": round(100 * (1 - loss / plain_total), 2)})

    out = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "Yahoo Finance daily bars via yfinance (split/dividend adjusted)",
        "period": {"start": START, "end": end},
        "tickers": TICKERS,
        "tvlUsd": 2 * QUOTE_USD,
        "weekendHours": WEEKEND_SECS / 3600,
        "params": {"source": "config/devnet.json (TSLAx-test/USDC)", **raw_params},
        "plainPool": {"feeBps": params.open_fee_bps, "model": "x*y=k, fee kept in reserves"},
        "summary": summary,
        "sensitivity": sensitivity,
        "events": results,
    }
    (OUT / "results.json").write_text(json.dumps(out, indent=2) + "\n")
    charts.lp_vs_hodl(out, OUT / "lp_vs_hodl.png")
    charts.loss_vs_gap(out, OUT / "loss_vs_gap.png")
    print(json.dumps({"summary": summary, "sensitivity": sensitivity}, indent=2))
    return out


if __name__ == "__main__":
    main()
