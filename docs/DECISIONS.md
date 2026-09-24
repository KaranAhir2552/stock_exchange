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

## Open questions

- Pyth `pro-compatible` receiver vs default: which one carries the Hermes updates we'll post? Decide in Phase 6 from Pyth docs.
- Do Pyth US-equity feeds publish outside regular hours? The calendar decides the mode regardless, but it affects staleness tuning. Phase 6.
- The mainnet `programId` stays unset until the mainnet deploy key exists (Phase 8).
