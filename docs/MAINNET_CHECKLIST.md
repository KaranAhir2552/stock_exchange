# Mainnet checklist

Every item must be checked, with evidence linked, before a mainnet deploy takes real funds.

- [ ] Program upgrade authority transferred to a Squads multisig with a timelock
- [ ] `GlobalConfig.admin` and `GlobalConfig.guardian` set to multisigs
- [ ] Mainnet build made with `anchor build` (no `devnet-mock` feature); verifiable build published and matched on-chain
- [ ] `pnpm check:mainnet` passes (no mock oracle, no demo controls, no Mock pools)
- [ ] Conservative `max_tvl_quote` caps set on every pool
- [ ] Emergency pause tested on mainnet: `set_global_pause` and `set_halt` block swaps and deposits, withdrawals still succeed
- [ ] Keepers running in at least two independent locations
- [ ] Monitoring alerts active (keeper staleness > 5 min, mode changes, failed updates)
- [ ] Market calendar populated several weeks ahead, with a scheduled update job
- [ ] Pyth feed IDs, receiver program ID, and Hermes access verified against official sources and recorded in `docs/DECISIONS.md`
- [ ] Token-2022 ScaledUiAmount handling verified against real xStocks mints
- [ ] External security audit completed before significant TVL
