"use client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { ReactNode } from "react";
import { cfg } from "@/lib/config";
import { MarketProvider } from "@/lib/market";
import "@solana/wallet-adapter-react-ui/styles.css";

// Wallets are discovered through the Wallet Standard (Phantom, Solflare, Backpack...), so no adapter list.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={cfg.rpcUrls[0]} config={{ commitment: "confirmed", wsEndpoint: cfg.wsUrls[0] }}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <MarketProvider>{children}</MarketProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
