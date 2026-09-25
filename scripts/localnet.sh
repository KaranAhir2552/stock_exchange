#!/usr/bin/env sh
# Starts a fresh local validator. Then: node scripts/src/cli.ts setup --network localnet
set -e
cd "$(dirname "$0")/.."
mkdir -p .anchor
exec solana-test-validator --reset --quiet --ledger .anchor/test-ledger "$@"
