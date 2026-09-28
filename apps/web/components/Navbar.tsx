"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { networkName } from "@/lib/config";
import { Button, cx } from "./ui";

const TABS = [
  { href: "/swap", label: "Swap", match: ["/", "/swap"] },
  { href: "/liquidity", label: "Liquidity" },
  { href: "/pools", label: "Pools" },
  { href: "/results", label: "Results" },
  ...(process.env.NEXT_PUBLIC_DEMO === "true" ? [{ href: "/demo", label: "Demo" }] : []), // literal: see app/demo/page.tsx
];

export function Navbar() {
  const path = usePathname();
  return (
    <header className="flex flex-wrap items-center gap-x-14 gap-y-3 rounded-2xl border border-line bg-surface py-3 pr-3.5 pl-7 shadow-card md:h-[76px] md:flex-nowrap md:py-0">
      <Link href="/" className="text-[26px] font-extrabold tracking-[-0.52px]">
        After<span className="text-brand">bell</span>
      </Link>
      <nav className="order-3 -mb-1 flex w-full gap-8 overflow-x-auto md:order-none md:w-auto md:gap-10">
        {TABS.map((t) => {
          const active = (t.match ?? [t.href]).some((m) => (m === "/" ? path === "/" : path.startsWith(m)));
          return (
            <Link key={t.href} href={t.href} className="flex shrink-0 flex-col items-center gap-2 pt-1">
              <span className={cx("text-[16px]", active ? "font-semibold text-brand" : "font-medium text-ink")}>
                {t.label}
              </span>
              <span className={cx("h-0.5 w-full rounded-full bg-brand", !active && "opacity-0")} />
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <span
          className="flex items-center gap-2.5 rounded-[10px] bg-subtle px-3.5 py-3 text-[15px] font-medium"
          title="The network is chosen when the app is built (config/<network>.json)."
        >
          <span className="size-2.5 rounded-full bg-positive" /> {networkName}
        </span>
        <WalletButton />
      </div>
    </header>
  );
}

function WalletButton() {
  const { publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  if (!publicKey) return <Button onClick={() => setVisible(true)}>Connect wallet</Button>;
  const a = publicKey.toBase58();
  return (
    <div className="relative">
      <Button variant="soft" onClick={() => setOpen((o) => !o)}>
        {a.slice(0, 4)}…{a.slice(-4)}
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-48 rounded-xl border border-line bg-surface p-1.5 shadow-card">
          <button
            type="button"
            className="w-full rounded-lg px-3 py-2 text-left text-[14px] hover:bg-subtle"
            onClick={() => navigator.clipboard.writeText(a).then(() => setOpen(false))}
          >
            Copy address
          </button>
          <button
            type="button"
            className="w-full rounded-lg px-3 py-2 text-left text-[14px] text-negative hover:bg-subtle"
            onClick={() => disconnect().then(() => setOpen(false))}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
