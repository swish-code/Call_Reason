// ---------------------------------------------------------------------------
//  Phone enrichment
//
//  Aggregator exports often arrive with no customer phone, which leaves an
//  agent nothing to call. Our own scrapers already hold the phone for those
//  same orders, keyed by the aggregator's order id — so we ask them.
//
//  Each scraper exposes  GET /api/lookup?orders=a,b,c&token=...  and answers
//  only about the ids we name. Nothing hands over a database, and the token is
//  a lookup-only one, separate from the scraper's dashboard/download token.
// ---------------------------------------------------------------------------

export type LookupHit = {
  phone: string;
  phoneIntl?: string;
  name?: string;
  orderTime?: string;
  shop?: string;
};

// Platform name (as seeded in the platforms table) -> env var prefix.
const PREFIX_BY_PLATFORM: Record<string, string> = {
  keeta: "KEETA",
  snoonu: "SNOONU",
};

// Order ids per request. ~17 chars each, so 300 keeps the URL near 5 KB —
// comfortably under the 8 KB that proxies tend to cut off.
const IDS_PER_REQUEST = 300;
const TIMEOUT_MS = 20000;

function sourceFor(platformName: string): { url: string; token: string } | null {
  const prefix = PREFIX_BY_PLATFORM[platformName.trim().toLowerCase()];
  if (!prefix) return null;
  const url = process.env[`${prefix}_LOOKUP_URL`];
  const token = process.env[`${prefix}_LOOKUP_TOKEN`];
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

/** Which platforms we can currently enrich — i.e. have both env vars set. */
export function enrichablePlatforms(): string[] {
  return Object.keys(PREFIX_BY_PLATFORM).filter((p) => sourceFor(p));
}

/**
 * Ask one scraper about a batch of order ids.
 * Never throws: a scraper being down must not fail an upload, it just means
 * no phones this round — the periodic retry will pick them up later.
 */
export async function lookupOrders(
  platformName: string,
  orderIds: string[]
): Promise<Map<string, LookupHit>> {
  const out = new Map<string, LookupHit>();
  const src = sourceFor(platformName);
  if (!src || !orderIds.length) return out;

  const unique = [...new Set(orderIds.map((s) => String(s).trim()).filter(Boolean))];

  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) {
    const chunk = unique.slice(i, i + IDS_PER_REQUEST);
    const url = `${src.url}/api/lookup?token=${encodeURIComponent(src.token)}&orders=${encodeURIComponent(chunk.join(","))}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) {
        console.warn(`[enrich] ${platformName} lookup returned ${res.status}`);
        continue;
      }
      const body: any = await res.json();
      for (const [id, hit] of Object.entries(body?.orders ?? {})) {
        const h = hit as LookupHit;
        if (h && h.phone) out.set(id, h);
      }
    } catch (e: any) {
      console.warn(`[enrich] ${platformName} lookup failed: ${e?.message || e}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}
