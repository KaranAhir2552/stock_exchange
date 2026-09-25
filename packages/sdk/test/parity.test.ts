// Replays swaps the real program executed (test/vectors.json, written by
// programs/afterbell/tests/vectors.rs) through the SDK. Every amount, price, mode and error must match.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import idl from "../src/idl/afterbell.json" with { type: "json" };
import {
  AfterbellError,
  type Direction,
  flatFee,
  growBps,
  mockOraclePrice,
  type PoolState,
  PRICE_SCALE,
  quoteSwap,
  quoteSwapRaw,
} from "../src/index.ts";

type Json = Record<string, never>;
const vectors = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8")) as Json[];
const errorName = (code: number) => idl.errors.find((e) => e.code === code)?.name;

const big = (x: string) => BigInt(x);

function poolFrom(p: Json): PoolState {
  const { maxTvlQuote, ...rest } = p.params as Record<string, number | string>;
  return {
    profile: p.profile,
    mode: p.mode,
    halted: p.halted,
    poolPrice: big(p.poolPrice),
    referencePrice: big(p.referencePrice),
    closeTs: big(p.closeTs),
    lastOraclePublishTs: big(p.lastOraclePublishTs),
    maxStalenessSecs: p.maxStalenessSecs,
    maxConfBps: p.maxConfBps,
    baseDecimals: p.baseDecimals,
    quoteDecimals: p.quoteDecimals,
    params: { ...(rest as unknown as PoolState["params"]), maxTvlQuote: big(maxTvlQuote as string) },
  };
}

test(`SDK matches the on-chain program on ${vectors.length} recorded swaps`, () => {
  assert.ok(vectors.length >= 100);
  let ok = 0;
  for (const [i, v] of vectors.entries()) {
    const pool = poolFrom(v.pool);
    const o = v.oracle as Json;
    const cal = v.calendar as Json | null;
    const ctx = {
      globalPause: v.globalPause,
      calendar: cal && {
        sessions: (cal.sessions as [string, string][]).map(([a, b]) => ({ openTs: big(a), closeTs: big(b) })),
        validUntil: big(cal.validUntil),
      },
      oracle: mockOraclePrice(pool, {
        price: big(o.price),
        conf: big(o.conf),
        expo: o.expo,
        publishTs: big(o.publishTs),
        status: o.status,
      }),
      now: big(v.now),
    };
    const run = () =>
      quoteSwap(
        pool,
        { base: big(v.baseReserve), quote: big(v.quoteReserve) },
        big(v.amountIn),
        v.direction as Direction,
        ctx,
      );
    const r = v.result as Json;
    if (r.ok) {
      const q = run();
      const want = r.ok as Json;
      assert.equal(q.amountOut, big(want.amountOut), `vector ${i}: amountOut`);
      assert.equal(q.pool.poolPrice, big(want.newPrice), `vector ${i}: newPrice`);
      assert.equal(q.mode, want.mode, `vector ${i}: mode`);
      ok++;
    } else {
      assert.throws(run, (e: unknown) => e instanceof AfterbellError && e.name === errorName(r.err), `vector ${i}`);
    }
  }
  assert.ok(ok >= 30, "enough successful swaps to be meaningful");
});

test("same fixed examples as the Rust unit tests", () => {
  const q = quoteSwapRaw(1_000_000n, 1_000_000n, PRICE_SCALE, 10_000, flatFee(30), 1_000n, "BaseToQuote");
  assert.deepEqual([q.fee, q.amountOut], [3n, 996n]);
  const closed = { baseBps: 60, sizeBpsPerPct: 5, capBps: 300 };
  assert.equal(quoteSwapRaw(1_000_000n, 1_000_000n, PRICE_SCALE, 10_000, closed, 10_000n, "BaseToQuote").feeBps, 65);
  assert.equal(growBps(200, 10, 1_000, 65n * 3_600n, false), 850);
  assert.equal(growBps(60, 1, 300, 1n, true), 61);
});
