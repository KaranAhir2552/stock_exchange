import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import { feedIdBytes } from "../src/client.ts";
import { decodePriceUpdate, pythFeedAccount, pythOraclePrice } from "../src/pyth.ts";

const SOL_USD = feedIdBytes("0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d");
const PUSH_ORACLE = new PublicKey("pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou");
const RECEIVER = new PublicKey("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp");

function account(level: "Full" | "Partial", feed = SOL_USD) {
  const b = Buffer.alloc(8 + 32 + 2 + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8 + 8);
  let o = 40;
  if (level === "Full") b[o++] = 1;
  else {
    b[o++] = 0; // Partial { num_signatures: 5 }
    b[o++] = 5;
  }
  Buffer.from(feed).copy(b, o);
  o += 32;
  b.writeBigInt64LE(11_856_565_123n, o); // $118.56565123
  b.writeBigUInt64LE(1_072_454n, o + 8);
  b.writeInt32LE(-8, o + 16);
  b.writeBigInt64LE(1_790_592_172n, o + 20);
  return b;
}

test("feed account PDA matches the live devnet SOL/USD account", () => {
  // Read from devnet on 2026-09-28: owner rec2HHDD..., Full, feed SOL/USD.
  assert.equal(pythFeedAccount(PUSH_ORACLE, SOL_USD).toBase58(), "7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE");
});

test("decodes both verification levels", () => {
  for (const level of ["Full", "Partial"] as const) {
    const u = decodePriceUpdate(account(level));
    assert.equal(u.fullyVerified, level === "Full");
    assert.equal(u.price, 11_856_565_123n);
    assert.equal(u.expo, -8);
    assert.equal(u.publishTs, 1_790_592_172n);
  }
});

test("only a fully verified update for the pool's feed, owned by the receiver, prices the pool", () => {
  const pool = { baseDecimals: 9, quoteDecimals: 6 };
  const ok = pythOraclePrice(pool, SOL_USD, { owner: RECEIVER, data: account("Full") }, RECEIVER);
  assert.ok(ok);
  assert.equal(ok.publishTs, 1_790_592_172n);
  assert.equal(pythOraclePrice(pool, SOL_USD, { owner: PUSH_ORACLE, data: account("Full") }, RECEIVER), null);
  assert.equal(pythOraclePrice(pool, SOL_USD, { owner: RECEIVER, data: account("Partial") }, RECEIVER), null);
  assert.equal(pythOraclePrice(pool, new Uint8Array(32), { owner: RECEIVER, data: account("Full") }, RECEIVER), null);
});
