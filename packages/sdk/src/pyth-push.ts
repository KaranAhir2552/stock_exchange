// Server-side only (Node): pushes fresh Pyth prices on-chain. Imported as "@afterbell/sdk/pyth-push" so the
// web app never bundles it, and the Hermes API key never leaves the server (brief 8.5).
import { createRequire } from "node:module";
import { HermesClient } from "@pythnetwork/hermes-client";
import type { PythSolanaReceiver as Receiver } from "@pythnetwork/pyth-solana-receiver";
import type {
  Connection,
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";

// The receiver's ES-module build pulls in jito-ts through an import Node can't resolve (no file extension);
// its CommonJS build loads fine. ponytail: switch back to `import` once @pythnetwork/solana-utils fixes it.
const { PythSolanaReceiver } = createRequire(import.meta.url)("@pythnetwork/pyth-solana-receiver") as {
  PythSolanaReceiver: typeof Receiver;
};

export interface PythPushConfig {
  hermesUrl: string;
  apiKey: string;
  pushOracle: PublicKey;
  receiver: PublicKey;
  wormhole: PublicKey;
}

/** Latest signed price updates for `feedIds` (hex) from Hermes, as base64 accumulator updates. */
export async function fetchHermesUpdates(cfg: PythPushConfig, feedIds: string[]): Promise<string[]> {
  const hermes = new HermesClient(cfg.hermesUrl, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
  const res = await hermes.getLatestPriceUpdates(feedIds, { encoding: "base64" });
  return res.binary.data;
}

/**
 * Transactions that write fresh Hermes prices into the push-oracle feed accounts (Wormhole-verified in full,
 * which the program requires), then run `after` in the last transaction (e.g. `update_reference`, which reads
 * those accounts). Temporary VAA accounts are closed again, so only fees are spent.
 */
export async function buildPythPush(
  connection: Connection,
  payer: Keypair,
  cfg: PythPushConfig,
  feedIds: string[],
  after: TransactionInstruction[],
  computeUnitPriceMicroLamports = 0,
): Promise<{ tx: VersionedTransaction; signers: Signer[] }[]> {
  const receiver = new PythSolanaReceiver({
    connection,
    // An Anchor 0.29 wallet: the builder only reads the key and signs through our loop below.
    wallet: {
      payer,
      publicKey: payer.publicKey,
      signTransaction: async <T>(t: T) => t,
      signAllTransactions: async <T>(t: T[]) => t,
    } as never,
    receiverProgramId: cfg.receiver,
    wormholeProgramId: cfg.wormhole,
    pushOracleProgramId: cfg.pushOracle,
  });
  const b = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
  await b.addUpdatePriceFeed(await fetchHermesUpdates(cfg, feedIds), 0);
  if (after.length)
    await b.addPriceConsumerInstructions(async () => after.map((instruction) => ({ instruction, signers: [] })));
  return b.buildVersionedTransactions({ computeUnitPriceMicroLamports });
}

/** Signs and sends the transactions in order, waiting for each (VAA posting must land before its use). */
export async function sendInOrder(
  connection: Connection,
  payer: Keypair,
  txs: { tx: VersionedTransaction; signers: Signer[] }[],
): Promise<string[]> {
  const sigs: string[] = [];
  for (const { tx, signers } of txs) {
    const latest = await connection.getLatestBlockhash("confirmed");
    tx.message.recentBlockhash = latest.blockhash;
    tx.sign([payer, ...signers]);
    const sig = await connection.sendTransaction(tx, { maxRetries: 3 });
    const res = await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
    if (res.value.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(res.value.err)}`);
    sigs.push(sig);
  }
  return sigs;
}
