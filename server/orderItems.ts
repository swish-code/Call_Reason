// Items of an order, from our GrubTech order archive (every delivery platform goes through grubOPS). The Reviews
// page shows them next to each review so the agent sees what the customer ordered before calling.
//
// GrubTech_Web exposes  POST <url>/api/order-items?token=…  { orders: [no, …] }  → { orders: { [no]: { items: [{ name,
// qty, modifiers[] }], platform, brand, branch } } }  and answers only for order numbers it holds WITH saved lines, so a
// missing number means "not known there (yet)". Numbers are the aggregator's own order numbers, the same the reviews carry.
import { pool } from "./db.js";

export interface OrderItem { name: string; qty: number; modifiers: string[] }
const IDS_PER_REQUEST = 300;
const TIMEOUT_MS = 20000;
/** A number not found is asked again after this long (the archive fills in within minutes of an order, hours at most). */
export const RECHECK_HOURS = 6;

function source(): { url: string; token: string } | null {
  const url = process.env.GRUBTECH_LOOKUP_URL, token = process.env.GRUBTECH_LOOKUP_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}
export const itemsConfigured = () => !!source();

/** Never throws: GrubTech being down only means no items this round. */
export async function fetchOrderItems(orderNos: string[]): Promise<Map<string, OrderItem[]>> {
  const out = new Map<string, OrderItem[]>();
  const src = source();
  const unique = [...new Set(orderNos.map((s) => String(s ?? "").trim()).filter(Boolean))];
  if (!src || !unique.length) return out;
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) {
    const chunk = unique.slice(i, i + IDS_PER_REQUEST);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${src.url}/api/order-items?token=${encodeURIComponent(src.token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orders: chunk }), signal: ctl.signal,
      });
      if (!res.ok) { console.warn(`[items] GrubTech lookup returned ${res.status}`); continue; }
      const body: any = await res.json();
      for (const [no, o] of Object.entries(body?.orders ?? {})) {
        const items = Array.isArray((o as any)?.items) ? (o as any).items : [];
        out.set(no, items.map((it: any) => ({ name: String(it.name || ""), qty: Number(it.qty) || 1, modifiers: Array.isArray(it.modifiers) ? it.modifiers.map(String) : [] })));
      }
    } catch (e: any) {
      console.warn(`[items] GrubTech lookup failed: ${e?.message || e}`);
    } finally { clearTimeout(timer); }
  }
  return out;
}

/**
 * Fill `ratings.items` for the given reviews: the ones with no items yet and not asked in the last RECHECK_HOURS.
 * Returns id → items for every review in `ids` that has items (stored before or found now).
 */
export async function fillRatingItems(ids: string[]): Promise<Record<string, OrderItem[]>> {
  const out: Record<string, OrderItem[]> = {};
  if (!ids.length) return out;
  const rows = (await pool.query(
    `SELECT id, order_id, items, items_checked_at FROM ratings WHERE id = ANY($1)`, [ids])).rows as any[];
  for (const r of rows) if (r.items) out[r.id] = r.items;
  if (!itemsConfigured()) return out;
  const due = rows.filter((r) => !r.items && r.order_id && (!r.items_checked_at || Date.now() - new Date(r.items_checked_at).getTime() > RECHECK_HOURS * 3600_000));
  if (!due.length) return out;
  const found = await fetchOrderItems(due.map((r) => r.order_id));
  for (const r of due) {
    const items = found.get(String(r.order_id).trim());
    if (items && items.length) {
      await pool.query(`UPDATE ratings SET items = $2, items_checked_at = now() WHERE id = $1`, [r.id, JSON.stringify(items)]);
      out[r.id] = items;
    } else {
      await pool.query(`UPDATE ratings SET items_checked_at = now() WHERE id = $1`, [r.id]);
    }
  }
  return out;
}

/** One line of text per order: "2× Beef Shawarma (Regular, Extra garlic) · Pepsi". */
export const itemsText = (items: OrderItem[] | null | undefined) =>
  (items || []).map((it) => `${it.qty > 1 ? `${it.qty}× ` : ""}${it.name}${it.modifiers.length ? ` (${it.modifiers.join(", ")})` : ""}`).join(" · ");
