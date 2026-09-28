"use client";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface Pt {
  t: number;
  v: number;
}
export interface Series {
  label: string;
  color: string;
  points: Pt[];
  /** Hold the previous value until the next point (prices that jump, not drift). */
  step?: boolean;
  dashed?: boolean;
  /** Soft fill under the line (Figma price charts). */
  area?: boolean;
}

/** Nice round tick values covering [lo, hi]. */
function ticks(lo: number, hi: number, n = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Minimal time-series chart: lines, an optional shaded band (low/high per point), a dashed reference line,
 * shaded x-ranges (e.g. market closed) and numbered markers. No chart library needed for this.
 */
export function Chart({
  series,
  band,
  refLine,
  ranges = [],
  markers = [],
  height = 260,
  xDomain,
  yFmt = (v) => v.toFixed(0),
  xFmt,
  xTicks,
  empty,
}: {
  series: Series[];
  band?: { t: number; low: number; high: number }[];
  refLine?: { v: number; label: string };
  ranges?: { from: number; to: number; label?: string }[];
  markers?: { t: number; label: string; text?: string }[];
  height?: number;
  xDomain?: [number, number];
  yFmt?: (v: number) => string;
  xFmt: (t: number) => string;
  xTicks?: number[];
  empty?: ReactNode;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return <div ref={ref}>{empty}</div>;
  const ys = [...pts.map((p) => p.v), ...(band ?? []).flatMap((b) => [b.low, b.high]), ...(refLine ? [refLine.v] : [])];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const pad = (y1 - y0 || Math.abs(y1) * 0.02 || 1) * 0.12;
  [y0, y1] = [y0 - pad, y1 + pad];
  const [x0, x1] = xDomain ?? [Math.min(...pts.map((p) => p.t)), Math.max(...pts.map((p) => p.t))];
  const L = 52;
  const R = 16;
  const T = markers.length ? 44 : 14;
  const B = 34;
  const X = (t: number) => L + ((t - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (height - T - B);
  const path = (s: Series) =>
    s.points
      .map((p, i) => {
        const prev = s.points[i - 1];
        const cmd = i === 0 ? `M${X(p.t)},${Y(p.v)}` : s.step ? `H${X(p.t)}V${Y(p.v)}` : `L${X(p.t)},${Y(p.v)}`;
        return prev || i === 0 ? cmd : "";
      })
      .join("");
  const bandPath = band?.length
    ? `M${band.map((b) => `${X(b.t)},${Y(b.high)}`).join("L")}L${[...band]
        .reverse()
        .map((b) => `${X(b.t)},${Y(b.low)}`)
        .join("L")}Z`
    : null;
  const xt = xTicks ?? Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4);

  return (
    <div ref={ref} className="w-full min-w-0 overflow-hidden">
      <svg width={W} height={height} className="block" role="img" aria-label={series.map((s) => s.label).join(", ")}>
        {ranges.map((r) => (
          <g key={r.from}>
            <rect x={X(r.from)} y={T} width={Math.max(0, X(r.to) - X(r.from))} height={height - T - B} fill="#eef0ff" />
            {r.label && (
              <text x={(X(r.from) + X(r.to)) / 2} y={T + 14} textAnchor="middle" className="fill-ink-2 text-[11px]">
                {r.label}
              </text>
            )}
          </g>
        ))}
        {ticks(y0, y1).map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#e6e9f2" />
            <text x={L - 8} y={Y(v) + 4} textAnchor="end" className="fill-muted text-[11px]">
              {yFmt(v)}
            </text>
          </g>
        ))}
        {xt.map((t, i) => (
          <text
            key={t}
            x={X(t)}
            y={height - 12}
            textAnchor={i === 0 ? "start" : i === xt.length - 1 ? "end" : "middle"}
            className="fill-muted text-[11px]"
          >
            {xFmt(t)}
          </text>
        ))}
        {bandPath && <path d={bandPath} fill="#4346e0" fillOpacity={0.14} />}
        {refLine && (
          <g>
            <line
              x1={L}
              x2={W - R}
              y1={Y(refLine.v)}
              y2={Y(refLine.v)}
              stroke="#4346e0"
              strokeDasharray="5 4"
              strokeWidth={1.2}
            />
            <text x={W - R} y={Y(refLine.v) - 6} textAnchor="end" className="fill-ink-2 text-[11px]">
              {refLine.label}
            </text>
          </g>
        )}
        {series.map((s) => (
          <g key={s.label}>
            {s.area && s.points.length > 1 && (
              <path d={`${path(s)}V${height - B}H${X(s.points[0].t)}Z`} fill={s.color} fillOpacity={0.1} />
            )}
            <path
              d={path(s)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              strokeLinejoin="round"
            />
            {s.points.length < 40 &&
              s.points.map((p) => <circle key={`${p.t}-${p.v}`} cx={X(p.t)} cy={Y(p.v)} r={3} fill={s.color} />)}
          </g>
        ))}
        {markers.map((mk) => (
          <g key={`${mk.t}-${mk.label}`}>
            <line x1={X(mk.t)} x2={X(mk.t)} y1={T - 18} y2={height - B} stroke="#94a3b8" strokeDasharray="3 3" />
            <circle cx={X(mk.t)} cy={T - 26} r={10} fill="#4346e0" />
            <text x={X(mk.t)} y={T - 22} textAnchor="middle" className="fill-white text-[11px] font-semibold">
              {mk.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: "dot" | "area" | "dash" }[] }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-2">
          {i.kind === "area" ? (
            <span className="h-3 w-5 rounded-sm" style={{ background: i.color }} />
          ) : i.kind === "dash" ? (
            <span className="w-5 border-t-2 border-dashed" style={{ borderColor: i.color }} />
          ) : (
            <span className="size-2.5 rounded-full" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}
