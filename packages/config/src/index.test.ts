import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig, mainnetSafetyErrors, parseConfig, readRawConfig } from "./index.ts";

test("localnet and devnet configs load", () => {
  assert.equal(loadConfig("localnet").network, "localnet");
  assert.equal(loadConfig("devnet").network, "devnet");
});

test("checked-in mainnet config passes the safety check", () => {
  assert.deepEqual(mainnetSafetyErrors(readRawConfig("mainnet") as never), []);
});

test("unknown network fails fast", () => {
  assert.throws(() => loadConfig("testnet"));
  assert.throws(() => loadConfig(undefined));
});

test("missing field fails fast", () => {
  const raw = readRawConfig("devnet") as Record<string, unknown>;
  delete raw.programId;
  assert.throws(() => parseConfig(raw));
});

test("mainnet rejects mock oracle, demo controls and Mock pools", () => {
  const devnet = readRawConfig("devnet") as Record<string, unknown>;
  const pool = {
    name: "TSLAx/USDC",
    baseMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    profile: "UsEquity",
    oracleKind: "Mock",
    feedId: "11".repeat(32),
    maxStalenessSecs: 60,
    maxConfBps: 100,
    params: {
      openBandBps: 100,
      closedBaseBandBps: 200,
      closedBandGrowthBpsPerHour: 10,
      closedMaxBandBps: 1000,
      openFeeBps: 30,
      closedBaseFeeBps: 60,
      closedFeeGrowthBpsPerHour: 1,
      closedMaxFeeBps: 300,
      sizeFeeBpsPer1PctDepth: 5,
      depthBps: 10_000,
      maxTvlQuote: "0",
    },
  };
  const bad = {
    ...devnet,
    network: "mainnet",
    usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    features: { demoControls: true, mockOracle: true },
    pools: [pool],
  };
  assert.equal(mainnetSafetyErrors(bad).length, 3);
  assert.throws(() => parseConfig(bad), /Unsafe mainnet config/);
  const good = {
    ...bad,
    features: { demoControls: false, mockOracle: false },
    pools: [{ ...pool, oracleKind: "Pyth" }],
  };
  assert.equal(parseConfig(good).network, "mainnet");
});
