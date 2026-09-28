# Decisions log

Newest entries at the bottom of each section. Every external fact lists its source.

## Project

- **Name: Afterbell** (chosen 2026-09-24). Used for the repo, the Anchor program (`afterbell`), and the npm scope (`@afterbell/*`).

## Toolchain and library versions (verified 2026-09-24)

| Component | Version | Source / notes |
|---|---|---|
| Rust | 1.98.1 stable | rustup. No `rust-toolchain.toml` pin: stable meets `anchor-lang`'s `rust-version = 1.89`, and CI uses stable. |
| Agave (Solana CLI) | 4.3.0 | GitHub `anza-xyz/agave` latest release; installed via `release.anza.xyz` |
| Anchor CLI / `anchor-lang` / `anchor-spl` | 1.2.0 | crates.io. The Anchor repo moved to `github.com/otter-sec/anchor` (crates.io `repository` field and GitHub redirect from `solana-foundation/anchor`); install docs at tag v1.2.0 use it. |
| `pyth-solana-receiver-sdk` | 2.0.0 | crates.io; depends on `anchor-lang ^1.0.2`, so it is compatible with Anchor 1.2 |
| SPL token crates | the versions `anchor-spl` 1.2.0 re-exports (`spl-token-interface` 2.x, `spl-token-2022-interface` 2.x) | `spl-token-2022` 11.1.0 exists but adding it directly would pull a second, conflicting copy. Use `anchor_spl::token_2022` / `token_interface` re-exports. |
| `litesvm` (Rust, dev-only) | 0.16.0 | See "SBPF v3 and LiteSVM" below. Uses Solana v4 message/transaction crates in tests only; instruction and address types are shared with Anchor, so no conversion is needed. |
| TypeScript | 7.0.2 | npm; the native compiler. `tsc` builds `packages/config` cleanly. |
| zod | 4.6.5 | npm |
| Biome | 2.5.14 | npm; one tool for TS lint + format instead of ESLint + Prettier |
| `@anchor-lang/core` (TS client) | 1.2.0 | npm; replaces `@coral-xyz/anchor`. Uses `@solana/web3.js` v1. |
| `@solana/web3.js` | 1.99.0 (v1) | Both Anchor's TS client and Pyth's receiver JS depend on v1, so we stay on v1 for now rather than `@solana/kit` 8.x. |
| `@pythnetwork/hermes-client` | 3.1.0 | npm |
| `@pythnetwork/pyth-solana-receiver` | 0.16.0 | npm. Depends on the old `@coral-xyz/anchor ^0.29`; confine it to the keeper (Phase 3). |
| Node / pnpm | 24.19.0 / 11.22.0 | installed on the dev machine |

## Toolchain findings (2026-09-24)

- **Anchor pins its default Solana version to a tested floor.** Without `[toolchain] solana_version`, avm's embedded map (`avm/anchor-solana-map.toml` in Anchor v1.2.0, last entry Anchor 1.0.2 -> Solana 3.1.10) made `anchor` silently install and activate Agave 3.1.10. `Anchor.toml` now pins `solana_version = "4.3.0"`. The Anchor 1.2 docs' own `[toolchain]` example uses a 4.x version (4.1.2).
- **The prebuilt Anchor 1.2.0 binary needs glibc 2.39.** Ubuntu 22.04 has 2.35, so install with `avm install 1.2.0 --from-source`. CI already builds from source (`cargo install --git https://github.com/otter-sec/anchor --tag v1.2.0 anchor-cli`).
- **SBPF v3 and LiteSVM.** Anchor 1.2 builds for SBPF v3 by default (`DEFAULT_BUILD_ARCH = "v3"` in `cli/src/lib.rs`, overridable with `ANCHOR_BUILD_SBF_ARCH`). Our `.so` has ELF flags `0x3`. SBPF v3 is **active on mainnet since epoch 993 and devnet since epoch 1069** (feature `5cC3foj77CWun58pC51ebHFUWavHWKarWyR5UUik7dnC`, source: `solana feature status -um/-ud --display-all` with Agave 4.3.0 on 2026-09-24). The feature ID changed from the one in `agave-feature-set` 3.x (`BUwGLeF3...`), so litesvm <= 0.13 (Agave 3.x runtime) fails to load the program with `InvalidAccountData`. litesvm 0.16.0 (Agave 4.x runtime) loads it. We keep v3 so tests run the exact binary we deploy.
- litesvm 0.13.x pins `solana-instruction = "=3.2.0"` and can't resolve with anchor-lang 1.2 (needs `^3.3`). Moot now that we use 0.16.
- SIMD-0500 ("Disable deployment of SBPF v0, v1 and v2 programs") is inactive on both clusters as of 2026-09-24. Another reason to stay on v3.

## Verified external facts

- **USDC mints**: mainnet `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, devnet `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Source: Circle, https://developers.circle.com/stablecoins/usdc-contract-addresses (fetched 2026-09-24).
- **Pyth Solana receiver program ID**: `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` (default build). Source: `pyth-solana-receiver-sdk` 2.0.0 `src/lib.rs` `declare_id!`. The same constant is used for every cluster. A `pro-compatible` crate feature switches it to `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp` (open question below).
- **Hermes**: default endpoint `https://hermes.pyth.network` (hermes-client 3.1.0 source). An unauthenticated request to `/v2/updates/price/latest` returned **HTTP 401** on 2026-09-24, so **an API key is required**. The client sends it as a header, or as an `ACCESS_TOKEN` query parameter for SSE/WebSocket. The key lives in `.env.<network>` as `HERMES_API_KEY`.

## Design decisions approved 2026-09-24 (changes to the brief)

1. **Swaps refresh the oracle inline.** `swap` takes the oracle account and runs the same reference-update logic as `update_reference` before pricing. This closes the window where traders could trade against a pool price up to one keeper interval stale. The keeper then only keeps idle pools current.
2. **A stale Open state refuses swaps.** Section 6.4 of the brief was contradictory ("refuse" vs "treat as Closed"). We refuse, which is the protective choice. With decision 1 this only happens when the oracle itself is stale, which already means Paused.
3. **Two-sided virtual depth**: `virtual_base = min(base_reserve, quote_reserve / pool_price) * depth_bps / 10000` (at least 1 atom). Basing depth on the base side alone lets depth collapse toward zero when the pool is mostly quote.
4. **Mint extensions use an allowlist, not a blocklist.** Only known-safe Token-2022 extensions (including ScaledUiAmount) are accepted at pool creation. Anything else fails with `UnsupportedMintExtension`. The exact list gets fixed in Phase 1 from the `spl-token-2022-interface` source.
5. **Continuous time since close**: band and fee growth use seconds-precision fixed point, not whole hours, so they don't jump once an hour.
6. **The size fee shares the closed fee cap** (as the brief says). Once the time fee alone hits `closed_max_fee_bps`, trade size adds nothing. Accepted.
7. **`usdcMint: null`** in config means "created by `scripts/create-test-mints`" and is only allowed off mainnet.
8. **The mainnet safety check runs on raw JSON** (`pnpm check:mainnet`), so CI can enforce "no mock, no demo, no Mock pools" even while `mainnet.json` is incomplete. `loadConfig("mainnet")` also runs the full schema and fails until every field is filled.

## Phase 1 decisions (2026-09-24)

9. **Re-centre only on a newer oracle price.** `refresh` (shared by `update_reference`, `swap`, `deposit`, `create_pool`) sets `reference_price = pool_price = oracle` only when `publish_ts > last_oracle_publish_ts` (or when coming back to Open). Re-centring on the *same* price would let a trader move the price, call `update_reference` to snap it back, and trade again, splitting a big trade to dodge price impact. Test: `recentre_only_on_newer_oracle_price_so_repeat_calls_are_harmless`.
10. **Older oracle data is rejected** (`StaleOracle`) when `publish_ts < last_oracle_publish_ts`. Otherwise anyone holding an old (but still owner-valid) price account could flip the pool to Paused. Test: `older_oracle_data_cannot_change_the_pool`.
11. **`initialize_config` requires the program's upgrade authority to sign** (checked via `ProgramData`), so nobody can front-run the deploy and become admin.
12. **Phase 1 scope guards** (fail safe, not half-built): `create_pool` rejects `UsEquity` (calendar is Phase 2) and `Pyth` (reader lands with the keeper, Phase 3). `read_oracle` errors on Pyth.
13. **`update_reference` exists already.** It is the `refresh` step as a permissionless instruction; Phase 2 adds the calendar logic inside `refresh`.
14. **Deposits refresh the oracle too** (they take the oracle account). The TVL cap and the Paused check then use a current price and mode. **Withdraw takes no config and no oracle account**, so nothing about market state can block it.
15. **Protocol fee** = `floor(fee * protocol_fee_bps / 10000)`, sent straight from the trader to a treasury token account (owner = `config.treasury`, mint = input mint). That account is optional and required only when the protocol fee is > 0. `protocol_fee_bps <= 5000`.
16. **Locked minimum liquidity** (1000 LP units) is never minted. Share maths uses `lp_mint.supply + MIN_LIQUIDITY`. If every LP withdraws (supply 0), the next deposit takes the first-deposit path and inherits the dust-sized locked remainder.
17. **Price bounds:** pool prices <= 2^96 and oracle prices <= 2^95 (so a 50% band still fits). Together with two-sided depth, this keeps every intermediate in u128 (bounds documented at the top of `math.rs`). Anything larger fails with `MathOverflow` or `InvalidOraclePrice`, so the pool can't trade (fail safe).
18. **Rounding:** fee rounds up; output rounds down; the derived virtual quote side rounds toward the pool for the trade direction; deposits take tokens rounded up and mint LP rounded down; withdrawals round down. Oracle-to-pool price conversion rounds down (neutral: it sets both sides of the band). The property test `swap_rounds_in_pool_favour` checks output against the exact rational constant-product result.
19. **Parameter bounds** (`PoolParams::validate`): bands 1..=5000 bps with base <= max, fees <= 1000 bps with base <= max, depth 1..=10000 bps.
20. **Errors added beyond the brief's list:** `ZeroAmount` and `InvalidOraclePrice`.
21. **`MockStatus` is compiled in every build** because Anchor 1.2's IDL generator ignores `#[cfg]` on instruction argument types. It's a plain three-value enum. The `MockOracle` account and the `mock_*` instructions stay behind `devnet-mock`. Verified: the mainnet IDL has no `mock_*` instructions and no `MockOracle` account, and the mainnet `.so` doesn't contain Anchor's `Instruction: MockSetPrice` log string, which the devnet `.so` does. CI checks both. *Correction (Phase 3):* an earlier version of this entry cited missing discriminator bytes as evidence. That check was invalid: discriminators aren't stored contiguously, so the devnet build lacks them too.
22. **Integration tests require `devnet-mock`** (`[[test]] required-features`); `anchor test` runs `cargo test --features devnet-mock` against the `.so` from `anchor build -- --features devnet-mock`.

### Token-2022 ScaledUiAmount (brief 6.8), researched in `spl-token-2022-interface` 2.1.0

- `ScaledUiAmountConfig { authority, multiplier: PodF64, new_multiplier_effective_timestamp: PodI64, new_multiplier: PodF64 }` (`src/extension/scaled_ui_amount/mod.rs`).
- Current multiplier: `new_multiplier` once `now >= new_multiplier_effective_timestamp`, otherwise `multiplier` (`current_multiplier`). UI amount = raw amount / 10^decimals * multiplier.
- The multipliers are raw IEEE-754 f64 bytes. We decode the bits with integer ops only (`math::f64_bytes_to_fixed`: sign/exponent/mantissa into PRICE_SCALE fixed point, rounded down) and reject zero, negative, subnormal, NaN, and infinity. No floating point runs on-chain.
- Pool price = oracle price per share * multiplier * 10^(expo + quote_decimals - base_decimals). Test: a 2.0 multiplier doubles the reference price.
- **Allowlisted mint extensions:** MintCloseAuthority, MetadataPointer, TokenMetadata, GroupPointer, TokenGroup, GroupMemberPointer, TokenGroupMember, ScaledUiAmount. Everything else fails with `UnsupportedMintExtension`. **Unverified:** which extensions real xStocks mints carry (compliance mints may use PermanentDelegate or Pausable, which this allowlist refuses). Check against real mints in Phase 8 before any mainnet xStocks pool.

### Test harness notes

- litesvm-token 0.16 `MintTo` builds classic SPL Token instructions only; the harness uses `spl_token_2022::instruction::mint_to`, which accepts either program.
- LiteSVM deploys programs with no upgrade authority; the harness patches `ProgramData` bytes 12..45 to make the test admin the authority.

## Phase 2 decisions (2026-09-25)

23. **The guardian can only make things safer.** It can halt a pool or turn on global pause. Lifting either needs the admin (`Unauthorized` otherwise). This follows the brief's "can only make things safer, never move funds."
24. **A halt takes effect immediately** (`set_halt(true)` sets the pool to Paused and emits `ModeChanged`). Lifting it leaves the pool Paused until the next refresh confirms a trusted price.
25. **`close_ts` = min(last trusted oracle publish time, most recent session close)** whenever a pool enters Closed from any other mode. One rule covers Friday close (last price before 16:00), a halt that runs over the close (band clock starts at the last trusted price), and a pause lifted over the weekend (same close_ts as before, test `halt_over_the_close_keeps_the_weekend_clock`). An earlier close_ts means a wider band: the band models how far the price may have drifted since the last trusted price.
26. **Oracle prices published while Closed are ignored.** The calendar is the only authority on market hours, so extended-hours or overnight prices can't move the reference. The mock's `Closed` status is likewise ignored; only `Halted` matters.
27. **A never-priced pool can't be Closed** (it becomes Paused). A `UsEquity` pool created on a weekend has no reference price to anchor a band to, so swaps and deposits wait for the first trusted in-session price.
28. **Closed band and fee grow continuously** (seconds, not whole hours; decision #5). The band rounds down (tighter) and the fee rounds up. Size fee = `size_fee_bps_per_1pct_depth * ceil(amount_in / virtual input reserve * 100)` in bps; base + size is capped at `closed_max_fee_bps`.
29. **A missing or wrong calendar on a `UsEquity` pool is an error** (`MissingCalendar`, a new error code), never a fallback. Pool instructions take the calendar as an optional account constrained to `pool.calendar`; `AlwaysOpen` pools pass none.
30. **`MarketCalendar` holds up to 48 sessions** (~9.5 weeks of US sessions). A `set_sessions` call with all 48 fits in one transaction (tested). `set_sessions` replaces the whole list; sessions must satisfy `open < close`, be sorted and non-overlapping, and `valid_until` must be in the future (`CalendarExpired`). A new calendar starts empty and expired, which means Closed.
31. **Profile ids:** `UsEquity` = 1 (matches `calendarProfileIds: [1]` in config); `AlwaysOpen` has no calendar.
32. **Decision #2 is superseded:** swaps always refresh first, so a "stale Open" state can't be traded on.
33. **New events:** `GlobalPauseSet` (in addition to the brief's `ParamsUpdated` and `HaltSet`). `Swapped` also carries `fee_bps`.
34. **Proposal for Phase 4 (not implemented):** the 60-second demo can use a compressed calendar (sessions seconds apart) and demo parameters (fast band growth) instead of an on-chain simulated clock. That way no time-offset code exists anywhere.

### Brief 6.11 coverage

| Requirement | Test(s) |
|---|---|
| Swap math, fees retained, rounding, extremes | `math::tests::*` (incl. 3 proptests), `swap_matches_math_and_keeps_fees_in_pool` |
| Every 6.4 mode case and transition | `friday_close_weekend_news_and_monday_recenter`, `halt_*`, `global_pause_*`, `stale_oracle_in_session_*`, `always_open_*`, `oracle_halt_status_*` |
| Friday close, weekend, holiday, Monday open | `friday_close_*`, `thanksgiving_holiday_and_early_close` |
| Band grows and caps; outside band fails; Monday re-centre with no trade | `band_and_fee_grow_then_cap`, `friday_close_*`, `swap_outside_band_is_rejected` |
| Paused blocks swaps and deposits, withdrawals work | `halt_*`, `global_pause_*`, `stale_oracle_*` (both files) |
| Stale oracle in session -> Paused; expired calendar -> Closed | `stale_oracle_in_session_pauses_and_expired_calendar_closes` |
| Wrong feed / wrong owner rejected | `wrong_feed_and_wrong_owner_are_rejected` |
| `update_reference` twice is harmless | `recentre_only_on_newer_*`, `friday_close_*` (while Closed) |
| AlwaysOpen behaves 24/7 | `always_open_pool_trades_through_the_weekend` |

## Phase 3 decisions (2026-09-25)

35. **Config `mints` map replaces `usdcMint`** (a change to brief section 7). `mints: { SYMBOL: { address, decimals } }`, and pools reference mints by symbol (`base`, `quote`). `address: null` means "not created yet" and is filled in by `create-test-mints` (never allowed on mainnet; the safety check requires every mainnet address). Devnet pools use our own test USDC, because we can't mint Circle's devnet USDC to seed liquidity.
36. **Mock feed ids** are `sha256("afterbell:mock:v2:<symbol>")`: labels for our mock oracle accounts, not Pyth feeds. (v2 since #59: the old mock accounts at the v1 addresses have the old size.)
37. **SDK/program parity** is enforced with recorded vectors rather than a hand-maintained duplicate test suite. `tests/vectors.rs` runs 120 randomized swaps on the SBPF program (Open, re-centre on a newer price, first swap after close, stale oracle, AlwaysOpen) and writes `packages/sdk/test/vectors.json`; the SDK replays them exactly. CI regenerates both the IDL copy and the vectors and fails on any diff. A mutation check (flipping one rounding and one re-centre comparison in the SDK) made the test fail, as it should. The live `smoke` command repeats the check against a real validator (localnet, then devnet).
38. **NYSE calendar data** (`scripts/src/nyse-calendar.json`) comes from https://www.nyse.com/markets/hours-calendars (fetched 2026-09-25): core session 9:30 a.m. to 4:00 p.m. ET, 2026 to 2028 holidays, early closes at 1:00 p.m. ET (Nov 27 2026, Dec 24 2026, Nov 26 2027, Jul 3 2028, Nov 24 2028). Daylight saving comes from the system tz database via `Intl` (America/New_York). The generated UTC times match the Rust test fixtures, which I computed independently.
39. **`update-calendar --mode demo --hours N`** (localnet/devnet only) sets one session from now, so stock pools can be exercised at any hour. The default mode is the real NYSE calendar, starting a week back so the last close is known after weekends.
40. **Keeper mock heartbeat** (`KEEPER_MOCK_HEARTBEAT=true`, localnet/devnet only, refused unless `features.mockOracle`): each round the keeper re-posts the *current* mock price with a fresh timestamp, then calls `update_reference`, so demo pools don't go Paused from staleness. It needs the admin key. It is never available on mainnet (no mock instructions exist there).
41. **Keeper duplicates:** two keepers with the same key can produce byte-identical transactions in the same block; "already processed" is treated as success, not an RPC failure.
42. **The deploy guard** refuses a `.so` whose mock-ness doesn't match the network (mock required on localnet/devnet, forbidden on mainnet), detected by Anchor's `Instruction: MockSetPrice` log string.
43. **pnpm `allowBuilds`:** install scripts are off for `bigint-buffer`, `bufferutil`, `utf-8-validate` (optional native accelerators from `@solana/web3.js`; the pure-JS fallbacks work).
44. **Node runs TypeScript directly** (type stripping), so the code avoids non-erasable syntax (no enums, no constructor parameter properties). `tsc --noEmit` type-checks scripts and the keeper in `pnpm build`.
45. **Localnet mint addresses** get written into `config/localnet.json` by `setup`. They change on every validator reset, so don't commit them (`git checkout config/localnet.json`).

46. **The Pyth reader requires fully verified updates.** The owner must be the receiver program (`pyth_solana_receiver_sdk::ID`, `rec5EKMG...`), the discriminator must be `PriceUpdateV2`, and `feed_id` must equal the pool's. `verification_level` must be `Full`; a `Partial` update carries fewer Wormhole guardian signatures and is rejected with a new error, `OracleNotVerified`. Staleness and confidence use the same rules as the mock (they lead to Paused, not an error). Pyth updates carry no market-status field, so `status_hint` is None and the calendar decides market hours. Fields researched in `pyth-solana-receiver-sdk` 2.0.0 `src/price_update.rs` and `pythnet-sdk` 3.0.0 `src/messages.rs`.
47. **Any fresh receiver-owned update account is accepted** (not only one fixed address), since keepers post updates to accounts of their choosing. This is safe because of the owner, discriminator, feed and verification checks, and because older updates can't move the pool (#10, test `newer_update_in_a_new_account_recentres_and_older_is_refused`).
48. **The keeper's Pyth path (Hermes fetch, post, `update_reference` in one transaction) is deferred to Phase 6.** Hermes now requires an API key (HTTP 401 without one), so that path can't be run or verified without it, and I'd rather not ship untested code. Until then the keeper skips Pyth pools with a warning. The on-chain side is fully tested.

49. **Bug found and fixed (Phase 3, localnet run): the size fee was silently zeroed.** Anchor's TS client camel-cases `size_fee_bps_per_1pct_depth` as `sizeFeeBpsPer1pctDepth`, while the SDK and config used `sizeFeeBpsPer1PctDepth`. Anchor's encoder writes 0 for a missing field without complaining, so pools created by the scripts got `size_fee_bps_per_1pct_depth = 0`. The on-chain validation accepts 0, so nothing failed. The parity vectors didn't catch it because they use the SDK's own names. Fix: explicit `toIdlParams`/`fromIdlParams` mapping in the SDK that throws on any missing or non-u16 field, plus a round-trip test through Anchor's own IDL coder (it fails if the old key comes back; checked by mutation). The `set-params` command repaired the localnet pools; devnet pools are created after the fix. A live Closed-mode `smoke` confirmed fee 63 bps = 61 base + 2 size, matching the SDK.
50. **`deploy` waits two slots after deploying.** A new or upgraded program only becomes callable from the next slot; without the wait, the next setup step failed with "Program is not deployed" (a timing race).
51. **CLI negative values need `=`** (`--open-in=-60`), because Node's `parseArgs` reads `-60` as a flag.
52. **Live localnet run of the weekend story** (validator + keeper + CLI): Open, then Closed at the session end (band 200 bps, fee 61 bps), weekend news ignored (reference 225 while the oracle said 202.50), halt Paused, halt lifted back to Closed with the weekend clock preserved, then the open jumped straight to 202.50 with no trade. The keeper ran with 0 failures throughout.

## Phase 5 decisions (2026-09-25)

53. **Python 3.13 via uv 0.12.19**, because the system Python is 3.10 and the current pandas 3.0.6 (>=3.11), NumPy 2.5.3 (>=3.12) and matplotlib 3.11.2 (>=3.11) don't support it. uv lives in `~/.local/bin` (its installer defaulted to a VS Code-snap path, which I moved). yfinance 1.7.0. The pins are in `backtest/pyproject.toml` and `uv.lock`.
54. **The backtest simulates Afterbell with a Python port of the program's math**, checked against the same 120 program vectors as the SDK (checked by mutation; a CI job runs it). The backtest measures our actual pricing, not a model of it.
55. **Headline:** with devnet params, Afterbell LPs lose 37% less than normal-pool LPs over the 20 largest weekend gaps (2021 to 2026). The band (±8.55% by Monday) binds on every event, and the first 8.55% of a move is where most of the informed trader's profit is. Sensitivity: 56% with half the band growth, 81% with a flat 2% band, 10% with a looser band. Fees barely matter. **The band is a product decision**: the backtest has no benign flow, so it can't measure what a tighter band costs in lost weekend volume.
56. **Design finding: the size fee is easy to dodge.** It's per trade and rounds up, so a trader who splits trades pays about 1 bps no matter how much depth they consume in total. If the size fee is meant to matter, it should depend on the cumulative move since the close, not on each trade's size. Logged as an open question.
57. **Price data isn't committed** (`backtest/data/` is git-ignored because of Yahoo's terms); the derived `output/results.json` and PNGs are committed for the web page.

58. **Devnet deployed (2026-09-28).** Program `AUkfc1YB8AB1BSno52xnsPvKcXYCbnHyySDxhrkmwp9x` (upgrade authority `3TVDWras…`), test mints committed in `config/devnet.json`, both pools seeded with $40k a side, demo calendar (one 72-hour session). The keeper ran 4 rounds on each pool with 0 failures, and `smoke` matched SDK quotes to on-chain swaps on both pools. Two things to know: the public devnet RPC rate-limits (HTTP 429) during `setup`, which stopped it at `seed-liquidity`; re-running that step alone finished it. And `smoke` reports a false mismatch if a keeper round re-centres the pool between the swap and the read (expected Open behaviour), so run it with the keeper stopped. A private devnet RPC in `rpcUrls` avoids the 429s.

## Phase 4 decisions (2026-09-28)

59. **Simulated time for the demo week (brief 8.6) lives in the mock oracle.** `MockOracle.clock_offset` (seconds) is added to the real clock for every pool on that feed: `update_reference`, `swap`, `deposit` and `create_pool` all compute `now = clock + oracle.clock_offset`, so mode, calendar, band and fee all follow the simulated week, and `mock_set_price` stamps prices in simulated time. `mock_advance_clock(seconds)` moves it; admin-only and forward-only (`seconds > 0`), so publish times and pool timestamps never go backwards. **Why it can't exist on mainnet:** the offset is a field of `MockOracle`, which only exists in `devnet-mock` builds; Pyth pools always use offset 0 (`read_pyth` hard-codes it); the mainnet build has no `mock_*` instructions (CI checks the IDL and greps the binary for both `MockSetPrice` and `MockAdvanceClock`). Withdraw doesn't read the clock at all. Why not a compressed calendar with fast parameters (#34): `PoolParams::validate` caps band growth at 5000 bps/hour, so a real weekend can't be squeezed into 60 real seconds; the offset reproduces the real devnet parameters exactly instead. The SDK adds the same offset (`mockMarketContext`). The account grew, so devnet got new mock feed ids (#36) and fresh test pools.
60. **Private RPC:** `RPC_URL` in the git-ignored `.env.<network>` is put ahead of the config's public `rpcUrls` (public ones stay as failover). `loadConfig` reads the env file; logs print RPC URLs without their query string, where API keys live. Note the web app's RPC URL is visible to anyone who loads the site; fine for a free devnet key, and Phase 7 moves browser reads to our API.

61. **Web stack (verified 2026-09-28):** Next.js 16.3.6 (App Router, Turbopack), React 19.3.0, Tailwind 4.3.3, `@solana/wallet-adapter-react` 0.15.40 / `-react-ui` 0.9.40 / `-base` 0.9.28 (wallets found through the Wallet Standard, so no adapter list). No chart library: a ~150-line SVG chart covers every chart in the design.
62. **Design from Figma, data never dummy.** The 9 screens (`docs/design`) are implemented with their tokens, icons and layout. Anything the design shows that we can't back with real data is replaced or marked, per the user's instruction: price history → "recent on-chain updates" (the pool's own `ReferenceUpdated`/`Swapped` events); top gainers/losers → recent activity; 24h volume, APR, fees earned, fee history → "Coming soon" (needs the Phase 7 indexer); watchlist of 8 assets, limit orders, 24h change, network switcher → removed (the network is a build-time choice, shown as a badge). The design's results numbers (58%) were placeholders; the page shows the backtest's.
63. **One batched read per poll.** `AfterbellClient.fetchMarkets` reads all pools with two `getMultipleAccountsInfo` calls and returns each pool's *live* state (what `refresh` would produce now), so the UI shows the mode, band and fee a trade would actually get, not the last keeper-written state. Every 5 s.
64. **Event history without batch RPC.** Helius' free plan rejects JSON-RPC batches (`getTransactions`), so events are read with single `getTransaction` calls, 4 at a time, and cached per signature (confirmed transactions never change).
65. **Demo signer:** the presenter loads the devnet admin keypair file into `/demo`; it is checked against `GlobalConfig.admin`, kept in React state only (never stored or sent), and signs the demo steps locally. No server holds it; users' own swaps are still signed by their wallets.
66. **Demo progress is derived from chain state**, not browser state: a demo week is a calendar of exactly Mon-Fri + next Monday (the next holiday-free NYSE week), and the step is read from the pool's simulated clock, so a page reload resumes correctly. The chart's history is per page session.
67. **Demo code isn't shipped without demo controls.** `/demo` and the Demo tab check `process.env.NEXT_PUBLIC_DEMO === "true"` written out in place (an imported constant was not folded across modules and the panel chunk still shipped; found by building with the flag off). CI builds with `demoControls: false` and greps the output for the panel.
68. **Bug found by the demo: keeper heartbeat raced price changes.** The heartbeat re-posted the mock price it had just read; a demo price change landing in between was overwritten (seen as the Monday re-centre using Friday's price). New devnet-only `mock_heartbeat` re-stamps `publish_ts` without touching the price. Verified with the keeper every 10 s during a full demo.
69. **Keeper survives stray library rejections.** A Helius connect timeout inside `@solana/web3.js`'s confirmation polling was an unhandled rejection that killed the keeper. `main.ts` now logs unhandled rejections at error level and keeps running; real failures are still retried, failed over and alerted per pool.
70. **Phones:** every page fits 390 px (measured with device emulation; `grid-cols-1` so single-column grids can shrink below their content).

## Phase 6 decisions (2026-09-28)

71. **Pyth Core upgrade (26 Aug 2026), verified today.** Hermes requires an API key (`Authorization: Bearer`; 401 without, 200 with, on both `https://pyth.dourolabs.app/hermes` and `hermes.pyth.network`); keys come from Pyth Terminal (https://pythdata.app/signup, free trial, paid plans for ongoing use). On Solana the upgraded deployment is enabled by the `pro-compatible` feature of `pyth-solana-receiver-sdk` (2.0.0 has it): receiver `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp`, push oracle `pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou`, Wormhole `HDw2E7P8X1SkCyjvoGsfBGAVUutKcj874bXjHrpVYrVL`. Sources: docs.pyth.network/price-feeds/core/upgrade/preparing(/solana) and /upgrade/contracts; all three are executable on devnet and mainnet (checked with `solana account`). The program now trusts only the upgraded receiver (test `only_the_upgraded_pyth_receiver_is_trusted`); config carries all three addresses and the new Hermes URL. **Resolves the open question** on which receiver to use.
72. **Feed ids come from Hermes itself** (`/v2/price_feeds`): SOL/USD `0xef0d8b6f...b56d` (`Crypto.SOL/USD`) and TSLA `0x16dad506...32f1` (`Equity.US.TSLA/USD`, schedule 09:30-16:00 ET with NYSE holidays). The SDK test pins the SOL/USD push-oracle account address to the one read from devnet (`7AviUf9n...HmyE`).
73. **Pyth publishes US equities outside market hours.** At 06:48 ET on a Monday the TSLA feed was seconds old and moving (369.40 → 369.43 → 369.42, confidence about ±$0.07-0.11): pre-market prices. This confirms #26: the calendar, not oracle freshness, decides the mode, and prices published while Closed are ignored. **Resolves the open question.** The Live data page shows this.
74. **Keeper Pyth path = push, then refresh.** Each round the keeper fetches the latest update from Hermes, writes it into the push oracle's feed account for that feed (`addUpdatePriceFeed`: the encoded-VAA path, so the account is Full verification as the program requires) and runs `update_reference` in the last transaction. User swaps and deposits read that same public account (`AfterbellClient.oracleFor`), so browsers never need the API key and no per-user posting is needed. Measured on devnet: 2 transactions, about 4 s, about 0.000015 SOL per push (temporary VAA accounts are closed). Pyth's own sponsored refresh of that account was about 5 minutes apart on devnet, too slow for `maxStalenessSecs` 120, so a keeper must run for Pyth pools.
75. **Devnet real-price pool:** `pSOL-test/USDC` (test base mint, `AlwaysOpen`, Pyth SOL/USD). `create-pool` and `seed-liquidity` push a fresh price in the same bundle so the pool starts priced and Open. `smoke` matched SDK quote and on-chain swap on it.
76. **Pyth TS SDK packaging workarounds:** `@pythnetwork/pyth-solana-receiver` 0.16.0 and `@pythnetwork/hermes-client` 3.1.0. The receiver's ES-module build pulls in `jito-ts` through an extensionless deep import that Node can't resolve, so `pyth-push.ts` loads its CommonJS build (`createRequire`); `jito-ts` also pins `@solana/web3.js` 1.77, which breaks with `rpc-websockets` 9, so a pnpm override pins 1.99.0 workspace-wide. `protobufjs`'s install script (a version print) stays off.
77. **Hermes access stays on servers.** Node code uses `@afterbell/sdk/pyth-push` (a separate subpath the web app never imports); the web app's `/api/pyth` route reads `HERMES_API_KEY` from the server environment, caches 2 s, and returns prices only. `referenceFeeds` in config lists display-only feeds (TSLA for the demo token). A static/CDN deployment of the web app would lose this route; the Phase 7 price relay replaces it.
78. **Browser decoding uses `DataView`**: the browser's global `Buffer` polyfill lacked the 64-bit readers (found as "readBigInt64LE is not a function" on the pools page).
79. **Repeatable browser checks in the repo:** `apps/web/scripts` (Chrome DevTools protocol, no dependencies): `pnpm --filter @afterbell/web demo:e2e` runs the whole devnet demo and times it; `shot` screenshots a page and checks it fits the width.

## Open questions

- Hermes pricing: Pyth offers a free trial and paid plans; the limits for a keeper posting every 60 s (and a mainnet deployment) need checking before relying on the free tier.

- Band width and growth for mainnet (see #55), and whether the size fee should be based on the cumulative move since the close rather than each trade (#56).

- Phantom sends through its own RPC for the selected network; testers must switch it to Devnet. Worth a UI hint once we can detect it.
- The mainnet `programId` stays unset until the mainnet deploy key exists (Phase 8).
