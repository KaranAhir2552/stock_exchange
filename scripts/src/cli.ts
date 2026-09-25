// Usage: node scripts/src/cli.ts <command> --network <localnet|devnet|mainnet> [options]
// Commands are idempotent: re-running skips anything that already exists.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { mintAddress, NETWORKS, type Network } from "@afterbell/config";
import {
  calendarPda,
  feedIdBytes,
  lpMintPda,
  mockOraclePda,
  poolPda,
  quoteSwap,
  toUiPrice,
  US_EQUITY_PROFILE_ID,
} from "@afterbell/sdk";
import {
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { nyDate, nyseSessions } from "./calendar.ts";
import { type Ctx, context, exists, keypairPath, log, ROOT, saveMintAddress, send } from "./lib.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    network: { type: "string" },
    mode: { type: "string", default: "nyse" },
    hours: { type: "string", default: "72" },
    "seed-usd": { type: "string", default: "40000" },
  },
});
const command = positionals[0];
const network = values.network as Network;
if (!NETWORKS.includes(network)) throw new Error(`--network must be one of ${NETWORKS.join(", ")}`);
const testNetwork = network !== "mainnet";

/** Starting mock prices (USD, 8-decimal fixed point). Demo values only, not market data. */
const DEMO_PRICE: Record<string, bigint> = { TSLAx: 250_00000000n, SOL: 150_00000000n };
const EXPO = -8;

// Anchor logs "Instruction: <Name>" for every handler (we never enable `no-log-ix-name`), so this
// string is in the binary exactly when mock_set_price is compiled in. (Discriminators are not stored
// as contiguous bytes, so they can't be used for this check.)
const hasMockCode = (so: Buffer) => so.includes("Instruction: MockSetPrice");

async function deploy(ctx: Ctx) {
  const so = join(ROOT, "target/deploy/afterbell.so");
  if (hasMockCode(readFileSync(so)) !== testNetwork) {
    throw new Error(
      testNetwork
        ? "target/deploy/afterbell.so has no mock oracle: run `anchor build -- --features devnet-mock`"
        : "target/deploy/afterbell.so contains mock code: run `anchor build` (no features) for mainnet",
    );
  }
  execFileSync(
    "solana",
    [
      "program",
      "deploy",
      so,
      "--program-id",
      join(ROOT, "target/deploy/afterbell-keypair.json"),
      "--url",
      ctx.cfg.rpcUrls[0],
      "--keypair",
      keypairPath(),
    ],
    { stdio: "inherit" },
  );
}

async function initConfig(ctx: Ctx) {
  if (await exists(ctx, ctx.client.config)) return log("config exists, skipping");
  const a = ctx.admin.publicKey;
  const guardian = new PublicKey(process.env.GUARDIAN_PUBKEY ?? a.toBase58());
  const treasury = new PublicKey(process.env.TREASURY_PUBKEY ?? a.toBase58());
  await send(ctx, [ctx.client.initializeConfig(a, a, guardian, treasury, 0)]);
  log("config initialized", { admin: a.toBase58(), guardian: guardian.toBase58(), treasury: treasury.toBase58() });
}

async function createCalendar(ctx: Ctx) {
  if (await exists(ctx, calendarPda(ctx.client.programId, US_EQUITY_PROFILE_ID)))
    return log("calendar exists, skipping");
  await send(ctx, [ctx.client.createCalendar(ctx.admin.publicKey)]);
  log("calendar created");
}

async function updateCalendar(ctx: Ctx) {
  let sessions: { openTs: bigint; closeTs: bigint }[];
  if (values.mode === "demo") {
    // One continuous session from now; lets devnet/localnet trade stock pools at any hour.
    if (!testNetwork) throw new Error("--mode demo is for localnet/devnet only");
    const now = await ctx.client.chainTime();
    sessions = [{ openTs: now - 60n, closeTs: now + BigInt(Number(values.hours) * 3_600) }];
  } else {
    // Keep a week of history so the last session close is known after weekends.
    sessions = nyseSessions(nyDate(Date.now() - 7 * 86_400_000), 48);
  }
  const validUntil = sessions[sessions.length - 1].closeTs;
  await send(ctx, [ctx.client.setSessions(ctx.admin.publicKey, sessions, validUntil)]);
  log("calendar updated", { mode: values.mode, sessions: sessions.length, first: sessions[0], validUntil });
}

async function createTestMints(ctx: Ctx) {
  if (!testNetwork) throw new Error("create-test-mints is for localnet/devnet only");
  for (const [symbol, m] of Object.entries(ctx.cfg.mints)) {
    if (m.address && (await exists(ctx, new PublicKey(m.address)))) {
      log("mint exists, skipping", { symbol });
      continue;
    }
    const mint = await createMint(ctx.connection, ctx.admin, ctx.admin.publicKey, null, m.decimals);
    saveMintAddress(network, symbol, mint.toBase58());
    ctx.cfg.mints[symbol].address = mint.toBase58();
    log("test mint created", { symbol, mint: mint.toBase58(), decimals: m.decimals });
  }
}

async function createPools(ctx: Ctx) {
  const pid = ctx.client.programId;
  for (const p of ctx.cfg.pools) {
    const base = new PublicKey(mintAddress(ctx.cfg, p.base));
    const quote = new PublicKey(mintAddress(ctx.cfg, p.quote));
    if (await exists(ctx, poolPda(pid, base, quote))) {
      log("pool exists, skipping", { pool: p.name });
      continue;
    }
    const feedId = feedIdBytes(p.feedId);
    if (p.oracleKind !== "Mock") throw new Error(`${p.name}: Pyth pools arrive in Phase 3 step E`);
    const price = DEMO_PRICE[p.base];
    if (!price) throw new Error(`no demo price for ${p.base}`);
    const { maxTvlQuote, ...rest } = p.params;
    await send(ctx, [
      ctx.client.mockSetPrice(ctx.admin.publicKey, feedId, price, 0n, EXPO),
      ctx.client.createPool(ctx.admin.publicKey, {
        baseMint: base,
        quoteMint: quote,
        profile: p.profile,
        oracleKind: p.oracleKind,
        feedId,
        oracle: mockOraclePda(pid, feedId),
        maxStalenessSecs: p.maxStalenessSecs,
        maxConfBps: p.maxConfBps,
        params: { ...rest, maxTvlQuote: BigInt(maxTvlQuote) },
      }),
    ]);
    log("pool created", { pool: p.name, address: poolPda(pid, base, quote).toBase58() });
  }
}

async function seedLiquidity(ctx: Ctx) {
  const usd = BigInt(values["seed-usd"] as string);
  const pid = ctx.client.programId;
  for (const p of ctx.cfg.pools) {
    const base = new PublicKey(mintAddress(ctx.cfg, p.base));
    const quote = new PublicKey(mintAddress(ctx.cfg, p.quote));
    const info = await ctx.client.fetchPool(poolPda(pid, base, quote));
    if (info.state.poolPrice === 0n) {
      log("pool has no price yet (created outside market hours?), skipping", { pool: p.name });
      continue;
    }
    const lp = await ctx.connection.getTokenSupply(lpMintPda(pid, info.accounts.address));
    if (lp.value.amount !== "0") {
      log("pool already has liquidity, skipping", { pool: p.name });
      continue;
    }
    const { baseDecimals: bd, quoteDecimals: qd } = info.state;
    const quoteAmount = usd * 10n ** BigInt(qd);
    // base atoms = quote atoms / (quote atoms per base atom)
    const baseAmount = (quoteAmount * 10n ** 18n) / info.state.poolPrice;
    if (testNetwork) {
      for (const [mint, amount] of [
        [base, baseAmount],
        [quote, quoteAmount],
      ] as const) {
        const ata = await createAssociatedTokenAccountIdempotent(ctx.connection, ctx.admin, mint, ctx.admin.publicKey);
        await mintTo(ctx.connection, ctx.admin, mint, ata, ctx.admin, amount);
      }
    }
    await createAssociatedTokenAccountIdempotent(ctx.connection, ctx.admin, info.accounts.lpMint, ctx.admin.publicKey);
    await send(ctx, [ctx.client.deposit(info.accounts, ctx.admin.publicKey, baseAmount, quoteAmount, 1n)]);
    const lpAta = getAssociatedTokenAddressSync(info.accounts.lpMint, ctx.admin.publicKey, false, TOKEN_PROGRAM_ID);
    log("liquidity seeded", {
      pool: p.name,
      base: baseAmount,
      quote: quoteAmount,
      bd,
      qd,
      lpAccount: lpAta.toBase58(),
    });
  }
}

/** Live parity check: quote a small swap per pool with the SDK, execute it, compare. */
async function smoke(ctx: Ctx) {
  const pid = ctx.client.programId;
  for (const p of ctx.cfg.pools) {
    const base = new PublicKey(mintAddress(ctx.cfg, p.base));
    const quote = new PublicKey(mintAddress(ctx.cfg, p.quote));
    const info = await ctx.client.fetchPool(poolPda(pid, base, quote));
    const amountIn = 10n ** BigInt(info.state.quoteDecimals) * 100n; // 100 quote units
    if (testNetwork) {
      const ata = await createAssociatedTokenAccountIdempotent(ctx.connection, ctx.admin, quote, ctx.admin.publicKey);
      await createAssociatedTokenAccountIdempotent(ctx.connection, ctx.admin, base, ctx.admin.publicKey);
      await mintTo(ctx.connection, ctx.admin, quote, ata, ctx.admin, amountIn);
    }
    const { userBase } = ctx.client.userAccounts(info.accounts, ctx.admin.publicKey);
    const [market, reserves, before] = await Promise.all([
      ctx.client.mockMarketContext(info),
      ctx.client.reserves(info.accounts),
      ctx.connection.getTokenAccountBalance(userBase),
    ]);
    const q = quoteSwap(info.state, reserves, amountIn, "QuoteToBase", market);
    await send(ctx, [ctx.client.swap(info.accounts, ctx.admin.publicKey, amountIn, q.amountOut, "QuoteToBase")]);
    const after = await ctx.connection.getTokenAccountBalance(userBase);
    const got = BigInt(after.value.amount) - BigInt(before.value.amount);
    const onchain = await ctx.client.fetchPool(info.accounts.address);
    const ok = got === q.amountOut && onchain.state.poolPrice === q.pool.poolPrice;
    log(ok ? "smoke ok: SDK quote == on-chain swap" : "SMOKE MISMATCH", {
      pool: p.name,
      mode: q.mode,
      feeBps: q.feeBps,
      quoted: q.amountOut,
      received: got,
      price: toUiPrice(onchain.state.poolPrice, info.state.baseDecimals, info.state.quoteDecimals),
    });
    // Chain time can tick between our read and the swap; a mismatch here means re-run, not a bug, unless it repeats.
    if (!ok) process.exitCode = 1;
  }
}

async function airdropIfLocal(ctx: Ctx) {
  if (network !== "localnet") return;
  const sig = await ctx.connection.requestAirdrop(ctx.admin.publicKey, 100 * LAMPORTS_PER_SOL);
  await ctx.connection.confirmTransaction(sig, "confirmed");
}

const commands: Record<string, (ctx: Ctx) => Promise<unknown>> = {
  deploy,
  "init-config": initConfig,
  "create-calendar": createCalendar,
  "update-calendar": updateCalendar,
  "create-test-mints": createTestMints,
  "create-pool": createPools,
  "seed-liquidity": seedLiquidity,
  smoke,
  async setup(ctx) {
    await airdropIfLocal(ctx);
    await deploy(ctx);
    await initConfig(ctx);
    await createCalendar(ctx);
    await updateCalendar(ctx);
    await createTestMints(ctx);
    await createPools(ctx);
    await seedLiquidity(ctx);
  },
};

const run = commands[command];
if (!run) throw new Error(`unknown command ${command}; one of: ${Object.keys(commands).join(", ")}`);
const ctx = context(network);
log(`${command} on ${network}`, { admin: ctx.admin.publicKey.toBase58(), rpc: ctx.cfg.rpcUrls[0] });
await run(ctx);
