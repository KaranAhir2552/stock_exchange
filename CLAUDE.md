# CLAUDE.md: Afterbell

This file is the complete project brief. Read it fully before writing any code, and re-read the relevant section before starting each phase.

---

## 1. What we are building

**One line:** An oracle-anchored swap pool on Solana that keeps trading of tokenized stocks fair for traders and safe for liquidity providers (LPs) when the real stock market is closed. The same engine also supports regular 24/7 crypto pairs.

### The problem
- Tokenized stocks (for example xStocks such as TSLAx) trade on Solana 24/7, but US stock exchanges are open only about 32.5 of the 168 hours in a week (weekdays 9:30 to 16:00 America/New_York, minus holidays).
- When the real market is closed, oracles stop publishing fresh equity prices. The on-chain price has no anchor, drifts on thin liquidity, and snaps when the market reopens.
- In a normal pool, informed traders trade against LPs at stale prices over the weekend and arbitrageurs capture the Monday gap. LPs absorb that loss (stale-price loss / adverse selection).
- Trading halts (the exchange stops a stock for news) create the same problem in a more extreme form.

### The solution
1. **Market-hours awareness:** Every pool knows whether its underlying market is Open, Closed, or Halted/Paused.
2. **Oracle-anchored pricing:** The pool's price is anchored to an oracle reference price, not only to its reserves. When the market reopens, the pool price re-centers directly to the oracle price, so arbitrageurs cannot capture the gap from LPs.
3. **Time-widening band:** While closed, the pool price may move only within a band around the last official price. The band widens with time since the close, up to a cap. Trades that would push the price outside the band are rejected.
4. **Dynamic off-hours fees:** Fees rise while the market is closed (with time and trade size). Extra fees go to LPs as compensation for off-hours risk.
5. **Halt handling:** During a halt, swaps and deposits are blocked. Withdrawals are always allowed, so no user's funds are ever locked.
6. **Multi-asset via market profiles:** Each pool has a market profile. `AlwaysOpen` for crypto pairs (SOL/USDC), `UsEquity` for tokenized stocks. New profiles (forex, commodities) can be added later without changing swap logic.

### What we are NOT building
- Our own tokenized stocks, an oracle network, a lending protocol, multi-chain support, a governance token, or a mobile app.

---

## 2. Glossary (domain terms used in this codebase)

- **Base token / quote token:** In TSLAx/USDC, TSLAx is base and USDC is quote. Prices are quote per base.
- **Reference price (`reference_price`):** The last trusted oracle price. While Open, it tracks the oracle. At the close, it freezes at the last fresh oracle price.
- **Pool price (`pool_price`):** The pool's current marginal price. Trades move it. `update_reference` re-centers it to the oracle while Open.
- **Band:** Allowed range for `pool_price` around `reference_price`.
- **Mode:** `Open`, `Closed`, or `Paused` (halt, stale oracle during scheduled hours, or global pause).
- **Market profile:** Rules for when a pool's market is open (`AlwaysOpen`, `UsEquity`).
- **Market calendar:** On-chain list of explicit trading sessions (UTC open/close timestamps) for a profile. Handles weekends, holidays, early closes, and daylight saving time without timezone logic on-chain.
- **Keeper:** Off-chain bot that periodically posts oracle updates and calls `update_reference`. Permissionless and idempotent, so multiple keepers can run safely.

---

## 3. Non-negotiable rules

1. **Fail safe.** Any doubt about market state (stale oracle, missing or expired calendar, invalid confidence, wrong feed) must result in the more protective mode, never in normal trading.
2. **No floating point on-chain.** Use `u64` amounts, `u128` intermediates, checked math everywhere, and a fixed-point price scale. Every rounding decision rounds in the pool's favor.
3. **Withdrawals always work,** in every mode, as a proportional share of reserves.
4. **The backend never holds user funds or user keys.** Users sign every transaction in their own wallet.
5. **Nothing network-specific is hard-coded.** Program IDs, RPC URLs, mint addresses, oracle feed IDs, and oracle mode come from per-network config (section 7).
6. **The mock oracle and demo controls must not exist in mainnet builds.** They are behind the Cargo feature `devnet-mock` and a frontend flag that is only true for localnet/devnet.
7. **Do not invent external facts.** Never guess Pyth feed IDs, program addresses, mint addresses, or library APIs. Look them up in official docs or the installed library source, and if you cannot verify something, stop and ask me.
8. **Use current library versions.** Check the latest stable versions of Anchor, the Solana SDK, Pyth libraries, and the SPL token crates before adding dependencies, and note the versions chosen in `docs/DECISIONS.md`.
9. **Work in phases** (section 10). Do not start a new phase until the current phase's acceptance criteria pass and I have approved moving on.

---

## 4. Tech stack

| Layer | Choice |
|---|---|
| On-chain program | Rust + Anchor |
| Tokens | Solana token interface, supporting both SPL Token and Token-2022 |
| Oracle | Pyth (pull oracle, `PriceUpdateV2` accounts via the Pyth Solana receiver) + a feature-gated mock oracle for localnet/devnet |
| Program tests | Rust tests with LiteSVM (or solana-bankrun if LiteSVM is not viable), including clock warping to simulate weekends |
| Monorepo | pnpm workspaces + a Cargo workspace |
| Shared TS packages | `config` (network config with zod validation), `sdk` (typed client + off-chain quote math) |
| Backend services | TypeScript on Node.js: keeper, indexer, API (Fastify), price relay |
| Database / cache | PostgreSQL + Redis |
| Frontend | Next.js (App Router) + TypeScript + Tailwind + Solana wallet adapter |
| Backtest | Python (pandas, numpy, matplotlib, yfinance for historical prices) |
| Deployment | Docker + docker-compose on our own server, Caddy as reverse proxy with automatic TLS |
| Monitoring | Structured JSON logs, a `/health` endpoint on every service, Prometheus metrics endpoint |

If any choice turns out to be a poor fit once you inspect current library versions, explain why and propose an alternative before switching.

---

## 5. Repository structure

```
afterbell/
├── CLAUDE.md
├── README.md
├── docs/
│   ├── DECISIONS.md          # decisions log: versions, trade-offs, open questions
│   ├── ARCHITECTURE.md
│   └── MAINNET_CHECKLIST.md
├── config/
│   ├── localnet.json
│   ├── devnet.json
│   └── mainnet.json
├── programs/
│   └── weekend_pool/         # Anchor program
├── packages/
│   ├── config/               # loads + validates config/<network>.json
│   └── sdk/                  # instruction builders, account decoders, quote math
├── services/
│   ├── keeper/
│   ├── indexer/
│   ├── api/
│   └── price-relay/
├── apps/
│   └── web/                  # Next.js frontend
├── backtest/                 # Python simulator
├── scripts/                  # deploy, create pools, seed liquidity, update calendar
└── docker/
    ├── docker-compose.yml
    ├── docker-compose.devnet.yml
    ├── docker-compose.mainnet.yml
    └── Caddyfile
```

---

## 6. On-chain program specification (`programs/weekend_pool`)

### 6.1 Fixed-point conventions
- `PRICE_SCALE = 10^18`. A price is stored as `u128` = (quote atoms per 1 base atom) × `PRICE_SCALE`. Always account for both mints' decimals when converting oracle prices.
- Basis points (`bps`): 10,000 = 100%.
- All math uses checked operations. Division rounds in the pool's favor (down for amounts paid out, up for amounts owed to the pool).

### 6.2 Accounts
**`GlobalConfig`** (PDA `["config"]`)
- `admin: Pubkey` (changes parameters, calendars; a Squads multisig on mainnet)
- `guardian: Pubkey` (can pause globally or set a halt; can only make things safer, never move funds)
- `protocol_fee_bps: u16` (share of fees to the protocol treasury; default 0)
- `treasury: Pubkey`
- `global_pause: bool`
- `bump: u8`

**`MarketCalendar`** (PDA `["calendar", profile_id]`)
- `profile_id: u8`
- `sessions: [Session; MAX_SESSIONS]` with `Session { open_ts: i64, close_ts: i64 }` in UTC seconds, sorted ascending; `session_count: u16`
- `valid_until: i64` (after this time, treat the calendar as expired, which means Closed)
- Maintained by the admin via `set_sessions`. A script generates sessions from the official exchange calendar a few weeks ahead, which handles holidays, early closes, and daylight saving time.

**`Pool`** (PDA `["pool", base_mint, quote_mint]`)
- Mints, vault addresses, LP mint, token program IDs for each side
- `profile: MarketProfile` (`AlwaysOpen` | `UsEquity`)
- `calendar: Pubkey` (unused for `AlwaysOpen`)
- Oracle config: `oracle_kind: OracleKind` (`Pyth` | `Mock`), `feed_id: [u8; 32]`, `max_staleness_secs: u32`, `max_conf_bps: u16`
- Parameters (`PoolParams`):
  - `open_band_bps` (max deviation of `pool_price` from the oracle while Open, e.g. 100)
  - `closed_base_band_bps` (e.g. 200), `closed_band_growth_bps_per_hour` (e.g. 10), `closed_max_band_bps` (e.g. 1000)
  - `open_fee_bps` (e.g. 30)
  - `closed_base_fee_bps` (e.g. 60), `closed_fee_growth_bps_per_hour` (e.g. 1), `closed_max_fee_bps` (e.g. 300)
  - `size_fee_bps_per_1pct_depth` (extra fee per 1% of depth consumed, closed mode only)
  - `depth_bps` (virtual liquidity depth as a fraction of reserves, controls price impact)
  - `max_tvl_quote: u64` (TVL cap; 0 = no cap)
- State: `mode: Mode` (`Open` | `Closed` | `Paused`), `halted: bool`, `pool_price: u128`, `reference_price: u128`, `close_ts: i64`, `last_update_ts: i64`, `last_oracle_publish_ts: i64`
- `bump`, `vault bumps`, `lp_mint bump`

**Vaults:** token accounts owned by the pool PDA, one per side.
**LP mint** (PDA `["lp", pool]`): LP tokens represent a proportional share of reserves.

**`MockOracle`** (PDA `["mock_oracle", feed_id]`, only compiled with feature `devnet-mock`)
- `price: i64`, `conf: u64`, `expo: i32`, `publish_ts: i64`, `status: MockStatus` (`Trading` | `Halted` | `Closed`)
- The admin sets it via `mock_set_price` and `mock_set_status`, and the frontend demo control panel uses these.

### 6.3 Oracle abstraction
Implement an internal `OraclePrice { price: u128 (scaled), conf_bps: u16, publish_ts: i64, status_hint: Option<Status> }` returned by a single function, `read_oracle(pool, account) -> Result<OraclePrice>`.
- `Pyth`: read `PriceUpdateV2` (Anchor's typed account verifies ownership by the Pyth receiver program). Verify the feed ID matches `pool.feed_id`. Convert using the exponent and mint decimals. Compute `conf_bps = conf / price`.
- `Mock` (feature `devnet-mock` only): read `MockOracle`. `status_hint` comes from `MockStatus`.
- Oracle is **valid** only if `now - publish_ts <= max_staleness_secs` and `conf_bps <= max_conf_bps`.

### 6.4 Mode determination (inside `update_reference`)
```
if global_pause or pool.halted or oracle.status_hint == Halted:
    mode = Paused
elif profile == AlwaysOpen:
    mode = Open if oracle valid else Paused
elif profile == UsEquity:
    in_session = calendar not expired AND now within some [open_ts, close_ts)
    if in_session and oracle valid:        mode = Open
    elif in_session and not oracle valid:  mode = Paused   # unexpected: treat as halt
    else:                                  mode = Closed
```
Transitions:
- **Open → Open:** set `reference_price = oracle.price` and `pool_price = oracle.price` (re-center). Update timestamps.
- **Open → Closed:** freeze `reference_price` at the last valid oracle price, set `close_ts` to that price's publish time (or the session close, whichever is earlier), and leave `pool_price` unchanged.
- **Closed → Open:** set `reference_price = pool_price = oracle.price` directly (the Monday jump happens without any trade, so arbitrageurs cannot capture the gap).
- **Any → Paused:** keep prices frozen. **Paused → Open** re-centers like Closed → Open.
- Emit `ModeChanged` and `ReferenceUpdated` events.

`update_reference` is **permissionless** and **idempotent**, so calling it twice in a row must be harmless. Swaps must also refuse to run if `now - last_update_ts` exceeds `max_staleness_secs` while the pool thinks it is Open (a stale Open state is treated as Closed for band and fee purposes, which is the safe side).

### 6.5 Swap pricing (`swap(amount_in, min_amount_out, direction)`)
1. Reject if mode is `Paused` or `global_pause`.
2. Build virtual reserves around `pool_price`: `virtual_base = real_base_reserve * depth_bps / 10000` (at least 1 atom), `virtual_quote = virtual_base * pool_price / PRICE_SCALE`.
3. Compute the fee (6.6) and apply it to `amount_in`.
4. Compute output using constant product on the virtual reserves. Output must also fit within real reserves.
5. Compute `new_pool_price` from the updated virtual reserves.
6. Band check:
   - Open: `|new_pool_price - reference_price| / reference_price <= open_band_bps`.
   - Closed: band = `min(closed_base_band_bps + closed_band_growth_bps_per_hour * hours_since_close, closed_max_band_bps)`. Reject with `OutsideBand` if violated.
7. Check `amount_out >= min_amount_out` (slippage protection).
8. Transfer tokens (using token interface `transfer_checked`), update reserves and `pool_price`, and keep LP fees in reserves. The protocol fee share, if any, goes to the treasury.
9. Emit `Swapped` with amounts, fee, mode, prices, and band.

Note: Reserve accounting must use actual vault balances after transfers, which protects against Token-2022 transfer fees if a mint has them. Pools whose mints have transfer fees or transfer hooks should be rejected at creation for the MVP.

### 6.6 Fees
- Open: `fee_bps = open_fee_bps`.
- Closed: `fee_bps = min(closed_base_fee_bps + closed_fee_growth_bps_per_hour * hours_since_close, closed_max_fee_bps) + size_fee_bps_per_1pct_depth * (trade_size / virtual_depth in %)`, capped at `closed_max_fee_bps`.

### 6.7 Liquidity
- `deposit(max_base, max_quote, min_lp_out)`: allowed in `Open` and `Closed`, blocked in `Paused`. The first deposit sets reserves and mints `sqrt(base * quote)` LP minus a small permanently locked minimum. Later deposits are proportional to current reserves. Enforce `max_tvl_quote`.
- `withdraw(lp_amount, min_base_out, min_quote_out)`: allowed in **every** mode, including `Paused` and `global_pause`. Proportional to reserves.

### 6.8 Tokenized stock multiplier (Token-2022 ScaledUiAmount)
Real xStocks use Token-2022 with the ScaledUiAmount extension: the value of one raw token unit equals the share price times a multiplier that changes with dividends and splits. When a base mint has this extension, the price conversion in 6.3 must apply the current multiplier. Research the extension's exact fields in the installed `spl-token-2022` crate before implementing. Devnet test mints do not use it, so the default multiplier is 1. Record findings in `docs/DECISIONS.md`.

### 6.9 Other instructions
- `initialize_config(admin, guardian, treasury, protocol_fee_bps)`
- `create_calendar(profile_id)`, `set_sessions(sessions, valid_until)` (admin)
- `create_pool(params, profile, oracle config)` (admin for the MVP)
- `set_params` (admin, with validation of every bound)
- `set_halt(pool, bool)` (guardian or admin), `set_global_pause(bool)` (guardian or admin)
- `mock_set_price`, `mock_set_status` (admin, feature `devnet-mock` only)

### 6.10 Errors and events
Define clear error codes: `OutsideBand`, `PoolPaused`, `StaleOracle`, `OracleConfidenceTooWide`, `WrongFeed`, `SlippageExceeded`, `TvlCapExceeded`, `InsufficientLiquidity`, `InvalidParams`, `CalendarExpired`, `MathOverflow`, `UnsupportedMintExtension`, `Unauthorized`.
Events: `PoolCreated`, `Swapped`, `LiquidityAdded`, `LiquidityRemoved`, `ReferenceUpdated`, `ModeChanged`, `ParamsUpdated`, `HaltSet`.

### 6.11 Program tests (must pass before moving past Phase 2)
- Swap math: correct outputs, fees retained, rounding favors the pool, no overflow at extreme values (property tests).
- Mode transitions for every case in 6.4, using clock warping to simulate Friday close, the weekend, a holiday, and Monday open.
- Band grows with time and caps. Trades outside the band fail. Monday re-center happens with no trade.
- Paused blocks swaps and deposits, and withdrawals still succeed.
- Stale oracle during a session results in Paused. Expired calendar results in Closed.
- Wrong feed ID and wrong oracle account owner are rejected.
- `update_reference` called twice is harmless.
- `AlwaysOpen` pool behaves like a normal oracle-anchored pool 24/7.

---

## 7. Networks: localnet → devnet → mainnet with one switch

- Every service, script, and the web app reads `NETWORK` (`localnet` | `devnet` | `mainnet`) and loads `config/<NETWORK>.json` through `packages/config`, which validates it with zod and fails fast on missing values.
- Each config file contains: `rpcUrls` (list, for failover), `wsUrls`, `programId`, `usdcMint`, `pools` (base mint, quote mint, profile, oracle kind, feed ID, parameters), `pythReceiverProgramId`, `hermesUrl`, `calendarProfileIds`, `explorerCluster`, `features` (`demoControls: boolean`, `mockOracle: boolean`).
- Secrets (Hermes API key, keeper keypair path, database URLs) live only in `.env.<network>` files that are git-ignored. Provide `.env.example`.
- Builds:
  - localnet/devnet: `anchor build -- --features devnet-mock`
  - mainnet: `anchor build` (no mock feature), plus a verifiable build.
  - A CI check fails if the mainnet config has `mockOracle` or `demoControls` set to true, or if any pool on mainnet uses `oracle_kind = Mock`.
- Scripts in `scripts/`, each taking `--network`: `deploy`, `init-config`, `create-calendar`, `update-calendar` (generate US market sessions from the official exchange holiday and early-close schedule), `create-pool`, `seed-liquidity`, `create-test-mints` (localnet/devnet only).
- `docs/MAINNET_CHECKLIST.md` must include: upgrade authority transferred to a Squads multisig with a timelock, admin and guardian set to multisigs, verified build published, conservative TVL caps, emergency pause tested, keepers running in at least two locations, monitoring alerts active, calendar populated several weeks ahead, and an external security audit before significant TVL.

---

## 8. Off-chain components

### 8.1 `packages/sdk`
- Typed instruction builders and account decoders generated from the Anchor IDL.
- `quoteSwap(poolState, amountIn, direction, now)` implementing exactly the same math as the program (same rounding, same band and fee rules). Include parity tests comparing SDK quotes with on-chain results on localnet.
- Helpers: `getPoolMode`, `getBand`, `getCurrentFee`, `hoursSinceClose`.

### 8.2 `services/keeper`
- Every 60 seconds (configurable), for each configured pool:
  - `Pyth`: fetch the latest update from Hermes, post it with the Pyth Solana receiver, and call `update_reference` in the same transaction.
  - `Mock`: call `update_reference` only.
- Use priority fees and retries with backoff. Multiple keeper instances must be safe to run at the same time.
- Expose `/health` (last successful update per pool) and metrics. Alert (log at error level, optional webhook) if no successful update for 5 minutes.

### 8.3 `services/indexer`
- Subscribe to program logs over websocket, parse Anchor events, and write them to Postgres. Backfill missed transactions on startup using signature history. Idempotent by transaction signature.
- Tables: `pools`, `swaps`, `liquidity_events`, `mode_changes`, `reference_updates`, `candles_1m` (derived).
- Keep the event source behind an interface so a provider webhook or Geyser stream can replace websockets later.

### 8.4 `services/api` (Fastify, read-only)
- `GET /pools`, `GET /pools/:id`, `GET /pools/:id/swaps`, `GET /pools/:id/candles?interval=`, `GET /pools/:id/mode-history`, `GET /status`, `GET /health`.
- Redis cache with short TTLs, rate limiting per IP, CORS restricted to the web app's origin. Stateless so it can run as multiple replicas.

### 8.5 `services/price-relay`
- Holds one streaming connection to Hermes (server-sent events) for all configured feeds and rebroadcasts prices to browsers over websockets. Reconnect automatically, since Hermes streams close periodically.
- Keeps the Hermes API key on the server only. In mock mode, relays mock oracle account changes instead.

### 8.6 `apps/web` (Next.js)
- Wallet connect (wallet adapter), network badge (Localnet/Devnet/Mainnet).
- **Swap page:** token selector, amount, live quote from the SDK, fee, price impact, slippage setting, and a clear status banner:
  - Open: "Market open."
  - Closed: "Market closed. Price protected. Allowed range $X to $Y. Fee Z%."
  - Paused: "Trading paused. You can still withdraw liquidity."
- **Liquidity page:** deposit and withdraw, the user's LP share, and the fees earned.
- **Pools page:** all pools with profile (Stock / Crypto), mode, TVL, and 24h volume from the API.
- **Results page:** backtest charts and a summary (normal pool vs weekend-safe pool).
- **Demo control panel** (`/demo`, only rendered when `features.demoControls` is true): buttons for Friday close, weekend news (price −10% / +10%), trading halt, halt ends, and Monday open, plus a live timeline showing mode, band, fee, and pool price. It uses `mock_set_price`, `mock_set_status`, and `update_reference`. On devnet, allow a simulated time offset where needed, so the full week can be demonstrated in about 60 seconds without waiting for real time. Explain in `docs/DECISIONS.md` how simulated time works and ensure it cannot exist on mainnet.
- Plain, beginner-friendly language in the UI, with short tooltips explaining terms like band, LP, and oracle.

### 8.7 `backtest/` (Python)
- Download daily and, where available, intraday prices for 10 to 20 liquid US stocks. Find the 20 largest Friday-close-to-Monday-open gaps in the last few years.
- Simulate the same weekend for (a) a plain constant-product pool and (b) the weekend-safe pool, with an informed trader who knows the Monday open price and trades optimally against each pool during the weekend, subject to the rules.
- Output: LP value versus holding, fees earned, and stale-price loss per event, as JSON (consumed by the web results page) and PNG charts.
- Use the same parameter values as `config/devnet.json`, and document every modeling assumption in `backtest/README.md`. Report honest numbers even if the improvement is small.

### 8.8 Docker deployment (own server)
- One Dockerfile per service (multi-stage builds, non-root user).
- `docker-compose.yml` with `postgres`, `redis`, `indexer`, `api`, `price-relay`, `keeper` (support scaling to 2+ replicas), and `web`, plus `caddy` for TLS and reverse proxy. Overrides for devnet and mainnet select the right `.env` and config.
- Health checks, restart policies, named volumes for Postgres, and log rotation.
- The web app can alternatively be deployed to a CDN host. Keep that option documented.

---

## 9. Scalability principles (apply everywhere)
- One pool account per pair, so unrelated pairs never contend for the same writable account. No global account is written on every swap.
- Browsers read from the cached API and price relay, not directly from RPC, except for sending transactions and fetching the minimum state needed to build them.
- All services are stateless and horizontally scalable. State lives in Postgres, Redis, and on-chain.
- Multiple RPC endpoints with automatic failover in every service.
- Idempotent keepers and indexer so duplicates and restarts are harmless.

---

## 10. Build phases

Phases 0 to 6 are the hackathon MVP. Phase 7 and later are for scaling after the hackathon, but the MVP code must already follow the structure above so scaling is additive, not a rewrite.

**Phase 0: Setup**
- Monorepo, Cargo and pnpm workspaces, `packages/config` with the three network files, `.env.example`, lint and format, CI running tests.
- `docs/DECISIONS.md` with verified library versions and anything that could not be verified.
- Done when: `anchor build` and `anchor test` run on a hello-world program, and `pnpm build` succeeds.

**Phase 1: Core pool (Open mode only, mock oracle)**
- Config, pool creation, deposit, withdraw, swap with oracle-anchored pricing, fees, band in Open mode, slippage protection, events.
- Done when: all math and liquidity tests pass on localnet.

**Phase 2: Market modes**
- Calendar account, `update_reference`, Closed and Paused modes, time-widening band and fees, halt, global pause, Monday re-center, `AlwaysOpen` profile.
- Done when: every test in 6.11 passes, including clock-warped weekend and holiday scenarios.

**Phase 3: SDK + keeper + scripts**
- SDK with quote parity tests, keeper (mock mode first, then Pyth), deploy and setup scripts for localnet and devnet.
- Done when: a script creates test mints, a TSLAx-test/USDC pool (`UsEquity`) and a SOL/USDC-style pool (`AlwaysOpen`) on devnet, seeds liquidity, and the keeper updates both.

**Phase 4: Web app + demo control panel**
- Swap, liquidity, pools, and demo pages as in 8.6, reading on-chain state directly for now.
- Done when: I can run the whole Friday close → weekend news → halt → Monday open story on devnet from the demo panel in about 60 seconds.

**Phase 5: Backtest + results page**
- As in 8.7, with the charts shown on the results page.
- Done when: the backtest runs from one command and the web results page shows its output.

**Phase 6: Pyth integration on devnet + polish**
- Read a real Pyth feed for at least one pool or a live "real data" status page, confirm access requirements (Hermes API key, which feeds are available), finish README, and prepare a short architecture diagram for the pitch.
- Done when: README lets a new developer run everything locally in under 15 minutes.

**Phase 7 (post-hackathon): Scale layer**
- Indexer, API, price relay, Postgres, Redis, Docker deployment, monitoring, multiple keepers, frontend switched to read from the API.

**Phase 8 (post-hackathon): Mainnet readiness**
- Everything in `docs/MAINNET_CHECKLIST.md`, Token-2022 ScaledUiAmount support verified with real xStocks mints, audit preparation.

---

## 11. How to work with me

- At the start of each phase, show a short plan (files to create, key decisions, risks) and wait for my approval.
- Make small, focused commits with clear messages.
- Run tests after every meaningful change. Never mark a phase done with failing or skipped tests.
- When something in this brief is ambiguous or seems wrong (for example, a parameter that produces bad behavior in tests), explain the problem and propose a fix instead of silently changing the design.
- Log every significant decision, assumption, and verified external fact (with its source) in `docs/DECISIONS.md`.
- Explain things simply when I ask questions. I am comfortable with Rust and frontend, but new to some market-structure concepts.
- Security first: when in doubt, choose the behavior that protects user and LP funds.
