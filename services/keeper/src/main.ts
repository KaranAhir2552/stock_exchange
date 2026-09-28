// Usage: NETWORK=devnet node services/keeper/src/main.ts
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { loadConfig } from "@afterbell/config";
import { Keypair } from "@solana/web3.js";
import { Keeper, log, metrics } from "./keeper.ts";

// @solana/web3.js can reject internal promises (e.g. its confirmation polling hitting a network timeout)
// that no caller can catch. One flaky RPC request must not kill the keeper: our own calls are retried and
// failed over per pool, and a pool with no successful update still raises the 5-minute alert.
process.on("unhandledRejection", (e) => log("error", "unhandled rejection (keeper keeps running)", { err: String(e) }));

const network = process.env.NETWORK;
const cfg = loadConfig(network); // also loads the git-ignored .env.<network>

const keyPath = (process.env.KEEPER_KEYPAIR_PATH ?? "~/.config/solana/id.json").replace(/^~/, homedir());
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));

const keeper = new Keeper(cfg, payer, {
  intervalMs: Number(process.env.KEEPER_INTERVAL_SECS ?? 60) * 1000,
  mockHeartbeat: process.env.KEEPER_MOCK_HEARTBEAT === "true",
  maxPriorityMicroLamports: Number(process.env.KEEPER_MAX_PRIORITY_MICROLAMPORTS ?? 100_000),
  alertAfterMs: Number(process.env.KEEPER_ALERT_AFTER_SECS ?? 300) * 1000,
  webhookUrl: process.env.KEEPER_ALERT_WEBHOOK || undefined,
  hermesApiKey: process.env.HERMES_API_KEY || undefined,
});
await keeper.init();

const port = Number(process.env.KEEPER_PORT ?? 9464);
createServer((req, res) => {
  if (req.url === "/health") {
    const pools = [...keeper.health.values()];
    const ok = pools.length > 0 && pools.every((p) => !p.alerting);
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok, network, pools }));
  } else if (req.url === "/metrics") {
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    res.end(metrics(keeper.health.values()));
  } else {
    res.writeHead(404).end();
  }
}).listen(port, () =>
  log("info", "keeper started", { network, port, payer: payer.publicKey.toBase58(), pools: keeper.health.size }),
);

const stop = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => stop.abort());
await keeper.run(stop.signal);
process.exit(0);
