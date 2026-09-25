"""Replays the swaps the real program executed (packages/sdk/test/vectors.json, written by
programs/afterbell/tests/vectors.rs) through afterbell_math. Run: uv run python test_parity.py"""

import json
from pathlib import Path

import afterbell_math as m

VECTORS = Path(__file__).parent.parent / "packages/sdk/test/vectors.json"
IDL = Path(__file__).parent.parent / "packages/sdk/src/idl/afterbell.json"
ERRORS = {e["code"]: e["name"] for e in json.loads(IDL.read_text())["errors"]}

SNAKE = {
    "openBandBps": "open_band_bps",
    "closedBaseBandBps": "closed_base_band_bps",
    "closedBandGrowthBpsPerHour": "closed_band_growth_bps_per_hour",
    "closedMaxBandBps": "closed_max_band_bps",
    "openFeeBps": "open_fee_bps",
    "closedBaseFeeBps": "closed_base_fee_bps",
    "closedFeeGrowthBpsPerHour": "closed_fee_growth_bps_per_hour",
    "closedMaxFeeBps": "closed_max_fee_bps",
    "sizeFeeBpsPer1PctDepth": "size_fee_bps_per_1pct_depth",
    "depthBps": "depth_bps",
    "maxTvlQuote": "max_tvl_quote",
}


def run(v):
    p = v["pool"]
    pool = m.Pool(
        profile=p["profile"], mode=p["mode"], halted=p["halted"],
        pool_price=int(p["poolPrice"]), reference_price=int(p["referencePrice"]),
        close_ts=int(p["closeTs"]), last_oracle_publish_ts=int(p["lastOraclePublishTs"]),
        max_staleness_secs=p["maxStalenessSecs"], max_conf_bps=p["maxConfBps"],
        base_decimals=p["baseDecimals"], quote_decimals=p["quoteDecimals"],
        params=m.Params(**{SNAKE[k]: int(x) for k, x in p["params"].items()}),
    )
    o = v["oracle"]
    oracle = m.Oracle(
        price=m.oracle_to_pool_price(int(o["price"]), o["expo"], pool.base_decimals, pool.quote_decimals),
        conf_bps=m.conf_bps(int(o["conf"]), int(o["price"])),
        publish_ts=int(o["publishTs"]),
        status=o["status"],
    )
    cal = v["calendar"]
    sessions = [(int(a), int(b)) for a, b in cal["sessions"]] if cal else None
    now = int(v["now"])
    pool = m.refresh(pool, v["globalPause"], sessions, int(cal["validUntil"]) if cal else 0, oracle, now)
    return m.swap(pool, int(v["baseReserve"]), int(v["quoteReserve"]), int(v["amountIn"]), v["direction"] == "BaseToQuote", now)


def main():
    vectors = json.loads(VECTORS.read_text())
    ok = 0
    for i, v in enumerate(vectors):
        r = v["result"]
        if "ok" in r:
            q, pool = run(v)
            want = r["ok"]
            assert q.amount_out == int(want["amountOut"]), f"vector {i}: amountOut {q.amount_out} != {want['amountOut']}"
            assert pool.pool_price == int(want["newPrice"]), f"vector {i}: newPrice"
            assert pool.mode == want["mode"], f"vector {i}: mode"
            ok += 1
        else:
            try:
                run(v)
            except m.AfterbellError as e:
                assert str(e) == ERRORS[r["err"]], f"vector {i}: {e} != {ERRORS[r['err']]}"
            else:
                raise AssertionError(f"vector {i}: expected {ERRORS[r['err']]}")
    assert ok >= 30
    print(f"parity ok: {len(vectors)} program swaps reproduced ({ok} fills, {len(vectors) - ok} rejections)")


if __name__ == "__main__":
    main()
