// Server-only: latest Pyth prices from Hermes. The API key stays on the server (brief 8.5); the browser
// only sees prices. ponytail: an in-process 2 s cache; the Phase 7 price relay replaces this route.
import { feedIdBytes } from "@afterbell/sdk";
import { cfg } from "@/lib/config";

export const dynamic = "force-dynamic";

export interface LivePrice {
  label: string;
  feedId: string;
  profile: "AlwaysOpen" | "UsEquity";
  price: number;
  conf: number;
  publishTime: number;
}

const feeds = [
  ...cfg.referenceFeeds,
  ...cfg.pools
    .filter((p) => p.oracleKind === "Pyth" && !cfg.referenceFeeds.some((r) => r.feedId === p.feedId))
    .map((p) => ({ label: `${p.name} oracle`, feedId: p.feedId, profile: p.profile })),
];
const hex = (id: string) => Buffer.from(feedIdBytes(id)).toString("hex");

let cache: { at: number; body: LivePrice[] } | null = null;

export async function GET() {
  const key = process.env.HERMES_API_KEY;
  if (!key) return Response.json({ error: "HERMES_API_KEY is not set on the server" }, { status: 503 });
  if (cache && Date.now() - cache.at < 2_000) return Response.json(cache.body);
  const qs = feeds.map((f) => `ids[]=${hex(f.feedId)}`).join("&");
  const res = await fetch(`${cfg.hermesUrl}/v2/updates/price/latest?${qs}&parsed=true`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) return Response.json({ error: `Hermes answered ${res.status}` }, { status: 502 });
  const parsed: { id: string; price: { price: string; conf: string; expo: number; publish_time: number } }[] = (
    await res.json()
  ).parsed;
  const body = feeds.flatMap((f): LivePrice[] => {
    const p = parsed.find((x) => x.id === hex(f.feedId));
    if (!p) return [];
    const scale = 10 ** p.price.expo;
    return [
      {
        ...f,
        price: Number(p.price.price) * scale,
        conf: Number(p.price.conf) * scale,
        publishTime: p.price.publish_time,
      },
    ];
  });
  cache = { at: Date.now(), body };
  return Response.json(body);
}
