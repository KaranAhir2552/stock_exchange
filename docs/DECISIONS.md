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
36. **Mock feed ids** are `sha256("afterbell:mock:<symbol>")`: labels for our mock oracle accounts, not Pyth feeds.
37. **SDK/program parity** is enforced with recorded vectors rather than a hand-maintained duplicate test suite. `tests/vectors.rs` runs 120 randomized swaps on the SBPF program (Open, re-centre on a newer price, first swap after close, stale oracle, AlwaysOpen) and writes `packages/sdk/test/vectors.json`; the SDK replays them exactly. CI regenerates both the IDL copy and the vectors and fails on any diff. A mutation check (flipping one rounding and one re-centre comparison in the SDK) made the test fail, as it should. The live `smoke` command repeats the check against a real validator (localnet, then devnet).
38. **NYSE calendar data** (`scripts/src/nyse-calendar.json`) comes from https://www.nyse.com/markets/hours-calendars (fetched 2026-09-25): core session 9:30 a.m. to 4:00 p.m. ET, 2026 to 2028 holidays, early closes at 1:00 p.m. ET (Nov 27 2026, Dec 24 2026, Nov 26 2027, Jul 3 2028, Nov 24 2028). Daylight saving comes from the system tz database via `Intl` (America/New_York). The generated UTC times match the Rust test fixtures, which I computed independently.
39. **`update-calendar --mode demo --hours N`** (localnet/devnet only) sets one session from now, so stock pools can be exercised at any hour. The default mode is the real NYSE calendar, starting a week back so the last close is known after weekends.
40. **Keeper mock heartbeat** (`KEEPER_MOCK_HEARTBEAT=true`, localnet/devnet only, refused unless `features.mockOracle`): each round the keeper re-posts the *current* mock price with a fresh timestamp, then calls `update_reference`, so demo pools don't go Paused from staleness. It needs the admin key. It is never available on mainnet (no mock instructions exist there).
41. **Keeper duplicates:** two keepers with the same key can produce byte-identical transactions in the same block; "already processed" is treated as success, not an RPC failure.
42. **The deploy guard** refuses a `.so` whose mock-ness doesn't match the network (mock required on localnet/devnet, forbidden on mainnet), detected by Anchor's `Instruction: MockSetPrice` log string.
43. **pnpm `allowBuilds`:** install scripts are off for `bigint-buffer`, `bufferutil`, `utf-8-validate` (optional native accelerators from `@solana/web3.js`; the pure-JS fallbacks work).
44. **Node runs TypeScript directly** (type stripping), so the code avoids non-erasable syntax (no enums, no constructor parameter properties). `tsc --noEmit` type-checks scripts and the keeper in `pnpm build`.
45. **Localnet mint addresses** get written into `config/localnet.json` by `setup`. They change on every validator reset, so don't commit them (`git checkout config/localnet.json`).

## Open questions

- Pyth `pro-compatible` receiver vs default: which one carries the Hermes updates we'll post? Decide in Phase 6 from Pyth docs.
- Do Pyth US-equity feeds publish outside regular hours? The calendar decides the mode regardless, but it affects staleness tuning. Phase 6.
- The mainnet `programId` stays unset until the mainnet deploy key exists (Phase 8).
