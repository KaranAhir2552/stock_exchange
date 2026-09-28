"use client";
import type { AfterbellClient } from "@afterbell/sdk";
import { EventParser } from "@anchor-lang/core";
import type { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";

// Recent program events for one pool, read straight from its transaction history. Enough for
// "recent activity" and mode history; full history (24h volume, APR) needs the Phase 7 indexer.

export interface PoolEvent {
  sig: string;
  /** Block time (real seconds). */
  blockTime: number | null;
  name: string;
  // biome-ignore lint/suspicious/noExplicitAny: decoded Anchor event fields, typed per name at use sites
  data: any;
}

// Confirmed transactions never change, so each is fetched and parsed once per page load.
const cache = new Map<string, Omit<PoolEvent, "sig" | "blockTime">[]>();

export async function fetchPoolEvents(client: AfterbellClient, pool: PublicKey, limit = 40): Promise<PoolEvent[]> {
  const sigs = (await client.connection.getSignaturesForAddress(pool, { limit })).filter((s) => !s.err);
  const parser = new EventParser(client.programId, client.program.coder);
  const missing = sigs.filter((s) => !cache.has(s.signature));
  // One request at a time per worker: free RPC plans reject JSON-RPC batches and rate-limit bursts.
  for (let i = 0; i < missing.length; i += 4) {
    await Promise.all(
      missing.slice(i, i + 4).map(async (s) => {
        const tx = await client.connection.getTransaction(s.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });
        const evs = [...parser.parseLogs(tx?.meta?.logMessages ?? [])].map((e) => ({ name: e.name, data: e.data }));
        cache.set(s.signature, evs);
      }),
    );
  }
  // Newest first overall; within a transaction, later events first.
  return sigs.flatMap((s) =>
    [...(cache.get(s.signature) ?? [])]
      .reverse()
      .filter((e) => !e.data.pool || pool.equals(e.data.pool))
      .map((e) => ({ ...e, sig: s.signature, blockTime: s.blockTime ?? null })),
  );
}

/** Recent events for a pool, refreshed every `ms`. */
export function usePoolEvents(client: AfterbellClient | null, pool: PublicKey | null, ms = 20_000) {
  const [events, setEvents] = useState<PoolEvent[] | null>(null);
  useEffect(() => {
    if (!client || !pool) return;
    let live = true;
    const load = () =>
      fetchPoolEvents(client, pool)
        .then((e) => live && setEvents(e))
        .catch(() => live && setEvents((prev) => prev ?? []));
    load();
    const id = setInterval(load, ms);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [client, pool, ms]); // pool keys come from the static config, so they are stable
  return events;
}
