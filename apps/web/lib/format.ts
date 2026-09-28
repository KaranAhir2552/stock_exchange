import { toUiPrice } from "@afterbell/sdk";

const n = (digits: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const n2 = n(2);

/** $1,234.56; compact from $100K up ($160.0K, $1.84M) so headline figures fit their cards. */
export function usd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e5) return `$${(v / 1e3).toFixed(1)}K`;
  return `${v < 0 ? "-" : ""}$${n2.format(Math.abs(v))}`;
}

/** Price with enough digits for small prices. */
export function price(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `$${(v >= 1 ? n2 : n(4)).format(v)}`;
}

/** Basis points as a percentage: 62 -> "0.62%". */
export const bps = (b: number, digits = 2) => `${(b / 100).toFixed(digits)}%`;

export const pct = (v: number, digits = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;

/** Atoms -> display amount, e.g. 1_000_000n with 6 decimals -> "1.00". */
export function tokens(atoms: bigint, decimals: number, digits = 4): string {
  return n(digits).format(Number(atoms) / 10 ** decimals);
}

/** Display amount -> atoms (floor). Empty or invalid input gives 0n. */
export function toAtoms(input: string, decimals: number): bigint {
  const m = input.trim().match(/^(\d*)(?:\.(\d*))?$/);
  if (!m || (m[1] === "" && !m[2])) return 0n;
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt(m[1] || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

/** Pool price units -> quote per whole base token. */
export const uiPrice = (p: bigint, baseDecimals: number, quoteDecimals: number) =>
  toUiPrice(p, baseDecimals, quoteDecimals);

/** "18h 16m", "4m", "2d 3h". */
export function duration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

const NY = { timeZone: "America/New_York" } as const;
/** "Fri, Sep 26 · 16:00" in New York time (market time). */
export function nyTime(unix: bigint | number, withDay = true): string {
  const d = new Date(Number(unix) * 1000);
  const t = d.toLocaleTimeString("en-US", { ...NY, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (!withDay) return t;
  const day = d.toLocaleDateString("en-US", { ...NY, weekday: "short", month: "short", day: "numeric" });
  return `${day} · ${t}`;
}

export const nyWeekday = (unix: bigint | number) =>
  new Date(Number(unix) * 1000).toLocaleDateString("en-US", { ...NY, weekday: "long" });
