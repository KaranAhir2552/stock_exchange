// Reading Pyth price accounts (browser-safe). Mirrors `read_pyth` in programs/afterbell/src/oracle.rs.
import { PublicKey } from "@solana/web3.js";
import { confBps, oracleToPoolPrice } from "./math.ts";
import type { OraclePrice, PoolState } from "./mode.ts";

/** Fields of a Pyth receiver `PriceUpdateV2` account that the program reads. */
export interface PriceUpdate {
  fullyVerified: boolean;
  feedId: Uint8Array;
  price: bigint;
  conf: bigint;
  expo: number;
  publishTs: bigint;
}

/**
 * Borsh layout (pyth-solana-receiver-sdk 2.0.0, price_update.rs): 8-byte discriminator, write_authority
 * (32), verification_level (enum: 0 = Partial { num_signatures: u8 }, 1 = Full), then PriceFeedMessage:
 * feed_id (32), price i64, conf u64, exponent i32, publish_time i64, ...
 */
export function decodePriceUpdate(data: Uint8Array): PriceUpdate {
  // DataView, not Buffer: browsers' Buffer polyfills may lack the 64-bit readers.
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 40;
  const level = data[o];
  o += level === 0 ? 2 : 1;
  const feedId = data.slice(o, o + 32);
  o += 32;
  return {
    fullyVerified: level === 1,
    feedId,
    price: v.getBigInt64(o, true),
    conf: v.getBigUint64(o + 8, true),
    expo: v.getInt32(o + 16, true),
    publishTs: v.getBigInt64(o + 20, true),
  };
}

/** The price feed account the Pyth push oracle keeps for `feedId` (PDA of [shard u16 LE, feed id]). */
export function pythFeedAccount(pushOracleProgramId: PublicKey, feedId: Uint8Array, shard = 0): PublicKey {
  return PublicKey.findProgramAddressSync([Uint8Array.of(shard & 0xff, shard >> 8), feedId], pushOracleProgramId)[0];
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The oracle price the program would read, or null where `read_pyth` would fail (wrong owner, not fully
 * verified, other feed). Multiplier 1: our test mints have no ScaledUiAmount extension.
 */
export function pythOraclePrice(
  pool: Pick<PoolState, "baseDecimals" | "quoteDecimals">,
  feedId: Uint8Array,
  account: { owner: PublicKey; data: Uint8Array },
  receiverProgramId: PublicKey,
): OraclePrice | null {
  if (!account.owner.equals(receiverProgramId)) return null;
  const u = decodePriceUpdate(account.data);
  if (!u.fullyVerified || !sameBytes(u.feedId, feedId)) return null;
  return {
    price: oracleToPoolPrice(u.price, u.expo, pool.baseDecimals, pool.quoteDecimals),
    confBps: confBps(u.conf, u.price),
    publishTs: u.publishTs,
    statusHint: null,
  };
}
