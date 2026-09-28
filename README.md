# Afterbell

An oracle-anchored swap pool on Solana that keeps tokenized-stock trading fair for traders and safe for LPs when the real market is closed: the price is anchored to an oracle, a widening band and rising fees apply while the market is closed, halts pause trading (withdrawals always work), and the pool jumps straight to the new price at the open. See [CLAUDE.md](CLAUDE.md) for the full brief and [docs/DECISIONS.md](docs/DECISIONS.md) for versions, verified facts and design decisions.

## Prerequisites

- Node 24+, pnpm 11
- Rust stable (`rustup`)
- Agave 4.3.0: `sh -c "$(curl -sSfL https://release.anza.xyz/v4.3.0/install)"`
- Anchor 1.2.0 via avm:
  ```sh
  cargo install --git https://github.com/otter-sec/anchor --tag v1.2.0 avm --locked
  avm install 1.2.0 --from-source   # the prebuilt binary needs glibc 2.39
  avm use 1.2.0
  ```
- A local keypair: `solana-keygen new -o ~/.config/solana/id.json` (skip if you have one)

## Build and test

```sh
pnpm install
anchor build -- --features devnet-mock   # localnet/devnet build (mock oracle + demo controls)
anchor test --skip-build                 # Rust + LiteSVM program tests (incl. clock-warped weekends)
pnpm build && pnpm test                  # config, SDK (incl. program parity vectors), keeper, web
pnpm lint
```

`anchor build` without features is the mainnet build (no mock code; the deploy script refuses the wrong build for a network).

## Run everything locally

Three terminals:

```sh
# 1. local validator
scripts/localnet.sh

# 2. deploy + config + calendar + test mints + both pools + $40k liquidity per side
node scripts/src/cli.ts setup --network localnet --mode demo --hours 72
#    then keep both pools fresh (marks the mock price fresh, calls update_reference every 5s)
NETWORK=localnet KEEPER_INTERVAL_SECS=5 KEEPER_MOCK_HEARTBEAT=true node services/keeper/src/main.ts

# 3. look and play
node scripts/src/cli.ts status --network localnet            # mode, prices, band, fee per pool
node scripts/src/cli.ts smoke --network localnet             # SDK quote vs a real swap
curl localhost:9464/health
```

The weekend story, by hand (use `--open-in=-60` with `=` for negative values):

```sh
cli() { node scripts/src/cli.ts "$@" --network localnet; }
cli calendar-demo --open-in=-60 --length 70     # Friday close in ~10s
cli mock-price --pool TSLAx --price 225         # weekend news: ignored while Closed
cli mock-status --pool TSLAx --status Halted    # trading halt -> Paused (withdrawals still work)
cli mock-status --pool TSLAx --status Trading   # halt ends -> Closed again
cli calendar-demo --open-in 0 --length 3600     # Monday open: pool jumps to the oracle, no trade
cli status
```

`setup` writes the new test-mint addresses into `config/localnet.json`; they change on every validator reset, so don't commit them (`git checkout config/localnet.json`).

## Web app

```sh
NETWORK=devnet pnpm --filter @afterbell/web dev      # http://localhost:3000 (or build + start)
```

Pages: Dashboard, Swap, Liquidity, Pools (+ pool detail), Results (the backtest, from `backtest/output/results.json`), and Demo (devnet/localnet only). Everything shown is read from the chain; anything that needs history we don't index yet (24h volume, APR, fee history) says "Coming soon" (Phase 7). Set Phantom/Solflare to **Devnet** before signing. A private RPC goes in `.env.devnet` as `RPC_URL=...` (it is visible to site visitors, so use a free devnet key only).

### The 60-second demo (devnet)

1. Keep the keeper running: `NETWORK=devnet KEEPER_MOCK_HEARTBEAT=true node services/keeper/src/main.ts`.
2. Open `/demo`, click **Load the devnet admin key** and pick `~/.config/solana/id.json` (the admin key; it stays in that browser tab's memory and signs the demo steps).
3. **Start a simulated week**, then click the steps in order: Friday close, Weekend news (−10% or +10%), Trading halt, Halt ends, Monday open. Each step is a real devnet transaction on the TSLAx pool's simulated clock ([DECISIONS #59](docs/DECISIONS.md)); the whole story takes about 30 seconds.
4. **Send test tokens** (with your own wallet connected) mints test USDC/TSLAx/SOL so you can swap and add liquidity yourself.

## Networks

Every tool reads `NETWORK` / `--network` (`localnet` | `devnet` | `mainnet`) and loads `config/<network>.json` through `@afterbell/config` (zod-validated, fails fast). Secrets and per-machine settings go in `.env.<network>`; see [.env.example](.env.example). `pnpm check:mainnet` fails if the mainnet config enables any mock or demo path.

| Command | What it does |
|---|---|
| `setup` | `deploy`, `init-config`, `create-calendar`, `update-calendar`, `create-test-mints`, `create-pool`, `seed-liquidity` (each idempotent) |
| `update-calendar` | Real NYSE sessions (default; data from nyse.com in `packages/sdk/src/nyse-calendar.json`) or `--mode demo --hours N` |
| `set-params` | Pushes `config/<network>.json` pool params to the chain |
| `status`, `smoke` | Read pool state through the SDK; live SDK-vs-chain swap check |
| `mock-price`, `mock-status`, `halt`, `global-pause`, `calendar-demo` | Operator/demo controls (mock ones are localnet/devnet only) |

## Layout

`programs/afterbell` (Anchor program) · `packages/config` · `packages/sdk` (client + exact TS mirror of the on-chain math) · `apps/web` (Next.js) · `scripts` · `services/keeper` · `backtest` (Python) · `docs` (incl. `docs/design`, the Figma reference)
