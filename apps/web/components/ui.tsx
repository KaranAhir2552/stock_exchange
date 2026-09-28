import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { InfoSmall, MoonSmall, Pause, Shield, Sun } from "./icons";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** White surface card (Figma: bg/surface, border/default, radius 16-18, soft shadow). */
export function Card({ className, ...p }: ComponentProps<"section">) {
  return <section className={cx("rounded-[18px] border border-line bg-surface shadow-card", className)} {...p} />;
}

type ButtonVariant = "primary" | "soft" | "positive" | "disabled";
const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand/90",
  soft: "bg-brand-subtle text-brand hover:bg-brand/10",
  positive: "bg-positive text-white hover:bg-positive/90",
  disabled: "bg-muted text-white cursor-not-allowed",
};

export function Button({
  variant = "primary",
  className,
  href,
  ...p
}: ComponentProps<"button"> & { variant?: ButtonVariant; href?: string }) {
  const cls = cx(
    "inline-flex items-center justify-center gap-2 rounded-[10px] px-7 py-3 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    buttonStyles[variant],
    className,
  );
  if (href)
    return (
      <Link href={href} className={cls}>
        {p.children}
      </Link>
    );
  return <button type="button" className={cls} disabled={variant === "disabled" || p.disabled} {...p} />;
}

/** Label with an optional plain-language explanation on hover/focus. */
export function Tip({ children, text }: { children: ReactNode; text: string }) {
  return (
    <span className="group relative inline-flex items-center gap-1.5">
      {children}
      <button type="button" aria-label={text} className="text-muted outline-none focus-visible:text-brand">
        <InfoSmall size={16} />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-64 rounded-lg bg-ink px-3 py-2 text-[13px] leading-snug font-normal text-white shadow-card group-focus-within:block group-hover:block"
      >
        {text}
      </span>
    </span>
  );
}

/** Label / value row (Figma: Key-Value Row). */
export function Row({ label, value, tip, muted }: { label: string; value: ReactNode; tip?: string; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2 border-b border-line py-3 text-[15px] last:border-b-0">
      <span className={muted ? "text-muted" : "text-ink-2"}>{tip ? <Tip text={tip}>{label}</Tip> : label}</span>
      <span className={cx("ml-auto text-right font-medium", muted ? "text-muted" : "text-ink")}>{value}</span>
    </div>
  );
}

export function Callout({
  children,
  icon = <Shield />,
  tone = "subtle",
}: {
  children: ReactNode;
  icon?: ReactNode;
  tone?: "subtle" | "brand";
}) {
  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-xl px-4 py-3.5 text-[14px]",
        tone === "brand" ? "bg-brand-subtle text-ink-2 [&_svg]:text-brand" : "bg-subtle text-ink-2 [&_svg]:text-brand",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <p>{children}</p>
    </div>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-md bg-brand-subtle px-3 py-1 text-[13px] font-medium text-ink-2">{children}</span>;
}

const AVATAR: Record<string, string> = { USDC: "#4346e0", TSLAx: "#e5484d", SOL: "#8b5cf6" };

/** Circular token avatar with the symbol's first letter (Figma: Token Avatar). */
export function TokenAvatar({ symbol, size = 40 }: { symbol: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface"
      style={{ width: size, height: size, fontSize: size * 0.42, background: AVATAR[symbol] ?? "#475569" }}
      aria-hidden
    >
      {symbol[0]}
    </span>
  );
}

export function PairAvatar({ base, quote, size = 40 }: { base: string; quote: string; size?: number }) {
  return (
    <span className="inline-flex shrink-0">
      <TokenAvatar symbol={base} size={size} />
      <span style={{ marginLeft: -size * 0.3 }}>
        <TokenAvatar symbol={quote} size={size} />
      </span>
    </span>
  );
}

export type ModeLike = "Open" | "Closed" | "Paused";

/** Market status pill. Crypto pools show "24/7" instead of Open. */
export function StatusPill({ mode, kind }: { mode: ModeLike; kind?: "Stock" | "Crypto" }) {
  if (mode === "Paused")
    return (
      <span className="inline-flex items-center gap-2 rounded-lg bg-warning-subtle px-3 py-1.5 text-[14px] font-medium text-warning">
        <span className="size-2.5 rounded-full bg-warning" /> Paused
      </span>
    );
  if (mode === "Closed")
    return (
      <span className="inline-flex items-center gap-2 rounded-lg bg-brand-subtle px-3 py-1.5 text-[14px] font-medium text-brand">
        <MoonSmall size={14} /> Closed
      </span>
    );
  if (kind === "Crypto")
    return (
      <span className="inline-flex items-center gap-2 rounded-lg bg-subtle px-3 py-1.5 text-[14px] font-medium text-ink-2">
        <span className="size-2.5 rounded-full bg-neutral" /> 24/7
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2 rounded-lg bg-positive-subtle px-3 py-1.5 text-[14px] font-medium text-positive">
      <span className="size-2.5 rounded-full bg-positive" /> Open
    </span>
  );
}

/** Large status header pill (Figma: "Market closed · Reopens in 18h"). */
export function ModeBadge({ mode, sub }: { mode: ModeLike; sub?: string }) {
  const s = {
    Open: { cls: "bg-positive-subtle text-positive", icon: <Sun />, label: "Market open" },
    Closed: { cls: "bg-brand-subtle text-brand", icon: <MoonSmall />, label: "Market closed" },
    Paused: { cls: "bg-warning-subtle text-warning", icon: <Pause />, label: "Trading paused" },
  }[mode];
  return (
    <div className={cx("rounded-xl px-3.5 py-2", s.cls)}>
      <div className="flex items-center gap-2 text-[16px] font-semibold">
        {s.icon} {s.label}
      </div>
      {sub && <div className="mt-0.5 pl-7 text-[13px] text-ink-2">{sub}</div>}
    </div>
  );
}

/** Pill-style segmented control (Figma: filter tabs / Add-Remove). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly T[] | { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <div className={cx("inline-flex gap-1 rounded-xl bg-subtle p-1", className)} role="tablist">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "flex-1 rounded-lg px-4 py-2 text-[15px] font-medium transition-colors",
            o.value === value ? "bg-surface text-brand shadow-card" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Placeholder for data that needs the Phase 7 indexer. */
export function ComingSoon({ what, className }: { what: string; className?: string }) {
  return (
    <div
      className={cx("flex flex-col items-center justify-center rounded-xl bg-subtle px-6 py-10 text-center", className)}
    >
      <span className="rounded-full bg-brand-subtle px-3 py-1 text-[12px] font-semibold tracking-wide text-brand uppercase">
        Coming soon
      </span>
      <p className="mt-3 max-w-sm text-[14px] text-ink-2">{what}</p>
    </div>
  );
}

export function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <Card className="flex items-center gap-4 p-5">
      {icon && (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[14px] text-ink-2">{label}</div>
        <div className="text-[28px] leading-tight font-bold">{value}</div>
        {sub && <div className="mt-0.5 text-[13px] text-ink-2">{sub}</div>}
      </div>
    </Card>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cx("inline-block animate-pulse rounded bg-subtle", className)} />;
}
