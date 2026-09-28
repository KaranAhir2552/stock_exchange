import { price } from "@/lib/format";

/** The allowed price range around the last official price, with the current pool price on it. */
export function BandBar({
  low,
  high,
  reference,
  current,
  referenceLabel = "Friday close",
}: {
  low: number;
  high: number;
  reference: number;
  current?: number;
  referenceLabel?: string;
}) {
  const pos = (x: number) => Math.min(Math.max((x - low) / (high - low), 0), 1) * 100;
  const r = pos(reference);
  const c = current === undefined ? null : pos(current);
  const below = c !== null && c < r;
  return (
    <div className="relative h-[118px] w-full" role="img" aria-label={`Allowed range ${price(low)} to ${price(high)}`}>
      {c !== null && (
        <div
          className={`absolute top-0 flex flex-col leading-tight ${below ? "-translate-x-full items-end pr-3" : "items-start pl-3"}`}
          style={{ left: `${r}%` }}
        >
          <span className="text-[15px] font-semibold text-brand">{price(current as number)}</span>
          <span className="text-[12px] whitespace-nowrap text-ink-2">Current pool price</span>
        </div>
      )}
      <div
        className={`absolute top-0 flex flex-col leading-tight ${below || c === null ? "items-start pl-3" : "-translate-x-full items-end pr-3"} ${c === null ? "-translate-x-1/2 items-center pl-0" : ""}`}
        style={{ left: `${r}%` }}
      >
        <span className="text-[15px] font-semibold">{price(reference)}</span>
        <span className="text-[12px] whitespace-nowrap text-ink-2">{referenceLabel}</span>
      </div>
      <div className="absolute inset-x-0 top-[52px] h-4 rounded bg-band" />
      {c !== null && (
        <div
          className="absolute top-[52px] h-4 bg-brand/15"
          style={{ left: `${Math.min(c, r)}%`, width: `${Math.abs(c - r)}%` }}
        />
      )}
      <div className="absolute top-[47px] left-0 h-[26px] w-0.5 bg-brand" />
      <div className="absolute top-[47px] right-0 h-[26px] w-0.5 bg-brand" />
      <div
        className="absolute top-[40px] h-[42px] border-l-[1.5px] border-dashed border-brand"
        style={{ left: `${r}%` }}
      />
      {c !== null && (
        <div
          className="absolute top-[52px] size-4 -translate-x-1/2 rounded-full border-[3px] border-white bg-brand shadow"
          style={{ left: `${c}%` }}
        />
      )}
      <div className="absolute top-[80px] left-0 leading-tight">
        <div className="text-[14px] font-medium">{price(low)}</div>
        <div className="text-[12px] text-ink-2">Lower limit</div>
      </div>
      <div className="absolute top-[80px] right-0 text-right leading-tight">
        <div className="text-[14px] font-medium">{price(high)}</div>
        <div className="text-[12px] text-ink-2">Upper limit</div>
      </div>
    </div>
  );
}
