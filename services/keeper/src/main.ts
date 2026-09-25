// Usage: NETWORK=devnet node services/keeper/src/main.ts
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR, loadConfig } from "@afterbell/config";
import { Keypair } from "@solana/web3.js";
import { Keeper, log, metrics } from "./keeper.ts";

const network = process.env.NETWORK;
const envFile = join(CONFIG_DIR, "..", `.env.${network}`);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const cfg = loadConfig(network);

const keyPath = (process.env.KEEPER_KEYPAIR_PATH ?? "~/.config/solana/id.json").replace(/^~/, homedir());
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));

const keeper = new Keeper(cfg, payer, {
  intervalMs: Number(process.env.KEEPER_INTERVAL_SECS ?? 60) * 1000,
  mockHeartbeat: process.env.KEEPER_MOCK_HEARTBEAT === "true",
  maxPriorityMicroLamports: Number(process.env.KEEPER_MAX_PRIORITY_MICROLAMPORTS ?? 100_000),
  alertAfterMs: Number(process.env.KEEPER_ALERT_AFTER_SECS ?? 300) * 1000,
  webhookUrl: process.env.KEEPER_ALERT_WEBHOOK || undefined,
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
