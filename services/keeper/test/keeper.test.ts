import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "@afterbell/config";
import { Keypair } from "@solana/web3.js";
import { Keeper, metrics, type PoolHealth } from "../src/keeper.ts";

const pool = (lastSuccessMs: number | null): PoolHealth => ({
  name: "P",
  address: "x",
  lastSuccessMs,
  lastError: "boom",
  successes: 0,
  failures: 3,
  alerting: false,
});

test("alerts once when a pool has no successful update for too long, and posts the webhook", async () => {
  const posts: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    posts.push(init.body);
    return new Response("ok");
  }) as typeof fetch;
  try {
    const k = new Keeper(loadConfig("localnet"), Keypair.generate(), {
      intervalMs: 1_000,
      mockHeartbeat: false,
      maxPriorityMicroLamports: 0,
      alertAfterMs: 5 * 60_000,
      webhookUrl: "http://hook",
    });
    k.health.set("fresh", { ...pool(Date.now()), name: "fresh" });
    k.health.set("stale", { ...pool(Date.now() - 6 * 60_000), name: "stale" });
    await k.tick();
    await k.tick(); // second tick must not re-alert
    assert.equal(k.health.get("stale")?.alerting, true);
    assert.equal(k.health.get("fresh")?.alerting, false);
    assert.equal(posts.length, 1);
    assert.match(posts[0], /stale/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("mock heartbeat is refused when the network has no mock oracle", () => {
  const cfg = { ...loadConfig("localnet"), features: { demoControls: false, mockOracle: false } };
  assert.throws(
    () =>
      new Keeper(cfg, Keypair.generate(), {
        intervalMs: 1,
        mockHeartbeat: true,
        maxPriorityMicroLamports: 0,
        alertAfterMs: 1,
      }),
    /mock heartbeat requires/,
  );
});

test("Pyth pools need a Hermes API key", () => {
  const cfg = loadConfig("devnet");
  assert.ok(cfg.pools.some((p) => p.oracleKind === "Pyth"));
  const opts = { intervalMs: 1, mockHeartbeat: false, maxPriorityMicroLamports: 0, alertAfterMs: 1 };
  assert.throws(() => new Keeper(cfg, Keypair.generate(), opts), /HERMES_API_KEY/);
  assert.doesNotThrow(() => new Keeper(cfg, Keypair.generate(), { ...opts, hermesApiKey: "k" }));
});

test("metrics are Prometheus text", () => {
  const text = metrics([pool(1_000)]);
  assert.match(text, /afterbell_keeper_failures_total\{pool="P"\} 3/);
  assert.match(text, /afterbell_keeper_last_success_seconds\{pool="P"\} 1\n/);
});
