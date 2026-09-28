"use client";
import { useState } from "react";
import { Chart, Legend } from "@/components/Chart";

export interface ExampleEvent {
  key: string;
  label: string;
  gapPct: number;
  plainPct: number;
  afterbellPct: number;
  path: [number, number][];
  weekendHours: number;
}

/** LP value vs just holding, hour by hour over one real weekend (simulated). */
export function ExampleWeekend({ events }: { events: ExampleEvent[] }) {
  const [key, setKey] = useState(events[0].key);
  const e = events.find((x) => x.key === key) ?? events[0];
  const H = e.weekendHours;
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <Chart
          height={300}
          xDomain={[0, H]}
          xTicks={[0, 16, 32, 48, H]}
          xFmt={(h) => (h === 0 ? "Fri close" : h === H ? "Mon open" : `+${h}h`)}
          yFmt={(v) => `${v.toFixed(1)}%`}
          refLine={{ v: 0, label: "Just holding" }}
          series={[
            {
              label: "Normal pool",
              color: "#8b93a5",
              points: [
                { t: 0, v: 0 },
                { t: 0.01, v: e.plainPct },
                { t: H, v: e.plainPct },
              ],
              step: true,
            },
            { label: "Afterbell", color: "#4346e0", points: e.path.map(([t, v]) => ({ t, v })), step: true },
          ]}
        />
        <div className="mt-3">
          <Legend
            items={[
              { label: "Normal pool (no protection)", color: "#8b93a5" },
              { label: "Afterbell (with price band)", color: "#4346e0" },
              { label: "Just holding (0%)", color: "#4346e0", kind: "dash" },
            ]}
          />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <label className="text-[14px] text-ink-2">
          Weekend
          <select
            className="mt-1 block w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[15px] text-ink"
            value={key}
            onChange={(ev) => setKey(ev.target.value)}
          >
            {events.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label} ({pct(x.gapPct)})
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-2xl border border-line p-5">
          <div className="mb-3 text-[16px] font-semibold">LP result at Monday open</div>
          <div className="flex justify-between py-1.5 text-[15px]">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-brand" />
              Afterbell LP
            </span>
            <span className="font-semibold text-negative">{pct(e.afterbellPct)}</span>
          </div>
          <div className="flex justify-between py-1.5 text-[15px]">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-neutral" />
              Normal pool LP
            </span>
            <span className="font-semibold text-negative">{pct(e.plainPct)}</span>
          </div>
          <p className="mt-3 text-[13px] text-ink-2">
            Versus just holding the same tokens. The normal pool loses everything at once: the trader takes the whole
            gap right after Friday&apos;s close. Afterbell&apos;s band only lets the price move a little at a time.
          </p>
        </div>
      </div>
    </div>
  );
}
