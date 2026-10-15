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

/**
 * Phones for orders, from our own Keeta/Snoonu scrapers — the same lookup the reviews upload
 * uses, for the survey uploads. A row's platform text is matched loosely ("Keeta", "keeta app");
 * a row with no platform is asked of every configured scraper (each answers only for order ids
 * it actually holds). One request per platform per 300 ids, and it never throws.
 */
export async function lookupPhonesForOrders(items: { platform: string; orderId: string }[]) {
  const enrichable = enrichablePlatforms();                    // e.g. ["keeta", "snoonu"]
  const platOf = (label: string): string | null => {
    const l = (label || "").trim().toLowerCase();
    return l ? enrichable.find((p) => l.includes(p)) || null : null;
  };
  const wanted = new Map<string, Set<string>>();
  for (const it of items) {
    const oid = String(it.orderId || "").trim();
    if (!oid) continue;
    const label = (it.platform || "").trim();
    const targets = label ? [platOf(label)].filter(Boolean) as string[] : enrichable;
    for (const p of targets) { if (!wanted.has(p)) wanted.set(p, new Set()); wanted.get(p)!.add(oid); }
  }
  const hits = new Map<string, { phone: string; name?: string; platform: string }>();
  for (const [p, ids] of wanted) {
    for (const [oid, hit] of await lookupOrders(p, [...ids])) hits.set(`${p}|${oid}`, { phone: hit.phone, name: hit.name, platform: p });
  }
  return {
    attempted: wanted.size > 0,
    // Platforms this row would be looked up on (empty = not a Keeta/Snoonu order, or not configured).
    platformsFor: (platform: string) => ((platform || "").trim() ? [platOf(platform)].filter(Boolean) as string[] : enrichable),
    get(platform: string, orderId: string) {
      const oid = String(orderId || "").trim();
      if (!oid) return undefined;
      for (const p of this.platformsFor(platform)) { const h = hits.get(`${p}|${oid}`); if (h) return h; }
      return undefined;
    },
  };
}
