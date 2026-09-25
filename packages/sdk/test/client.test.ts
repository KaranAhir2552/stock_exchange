import assert from "node:assert/strict";
import { test } from "node:test";
import { Program } from "@anchor-lang/core";
import { Connection } from "@solana/web3.js";
import idl from "../src/idl/afterbell.json" with { type: "json" };
import { fromIdlParams, type PoolParams, toIdlParams } from "../src/index.ts";

// Every field distinct and non-zero, so a dropped or swapped field can't round-trip.
const params: PoolParams = {
  openBandBps: 101,
  closedBaseBandBps: 202,
  closedBandGrowthBpsPerHour: 11,
  closedMaxBandBps: 1_003,
  openFeeBps: 31,
  closedBaseFeeBps: 61,
  closedFeeGrowthBpsPerHour: 2,
  closedMaxFeeBps: 301,
  sizeFeeBpsPer1PctDepth: 5,
  depthBps: 9_999,
  maxTvlQuote: 100_000_000_001n,
};

test("PoolParams survive a round trip through Anchor's own IDL encoder", () => {
  const program = new Program(idl as never, { connection: new Connection("http://127.0.0.1:1") } as never);
  const bytes = program.coder.types.encode("poolParams", toIdlParams(params));
  assert.deepEqual(fromIdlParams(program.coder.types.decode("poolParams", bytes)), params);
});

test("a missing or malformed parameter throws instead of encoding as 0", () => {
  const { sizeFeeBpsPer1PctDepth: _, ...missing } = params;
  assert.throws(() => toIdlParams(missing as PoolParams), /sizeFeeBpsPer1pctDepth must be a u16/);
  assert.throws(() => toIdlParams({ ...params, depthBps: 1.5 }), /depthBps/);
  assert.throws(() => toIdlParams({ ...params, maxTvlQuote: 5 as never }), /maxTvlQuote/);
});
