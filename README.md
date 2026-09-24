# Afterbell

An oracle-anchored swap pool on Solana that keeps tokenized-stock trading fair for traders and safe for LPs when the real market is closed. See [CLAUDE.md](CLAUDE.md) for the full brief and [docs/DECISIONS.md](docs/DECISIONS.md) for versions and design decisions.

## Prerequisites

- Node 24+, pnpm 11
- Rust stable (`rustup`)
- Agave 4.3.0: `sh -c "$(curl -sSfL https://release.anza.xyz/v4.3.0/install)"`
- Anchor 1.2.0 via avm:
  ```sh
  cargo install --git https://github.com/otter-sec/anchor --tag v1.2.0 avm --locked
  avm install 1.2.0 --from-source   # prebuilt binary needs glibc 2.39
  avm use 1.2.0
  ```

## Commands

```sh
pnpm install
pnpm lint && pnpm build && pnpm test         # TypeScript packages
pnpm check:mainnet                           # mainnet config must have no mock/demo paths

anchor build -- --features devnet-mock       # localnet/devnet build (mock oracle + demo controls)
anchor build                                 # mainnet build (no mock)
anchor test --skip-build                     # Rust + LiteSVM program tests
```

Services read `NETWORK` (`localnet` | `devnet` | `mainnet`) and load `config/<NETWORK>.json` through `@afterbell/config`. Secrets go in `.env.<network>` (see `.env.example`).
