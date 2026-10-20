// Talabat partner-portal Order report: one CSV per Kuwait day (all stores, one row per order), uploaded
// every morning by the talabat-export tool on the office PC. The CSV is parsed once at upload into a small
// summary kept next to the gzipped file, so the page never re-reads megabytes to draw its numbers.
// Columns are looked up by name, case-insensitively — Talabat renames them now and then
// ("Has Complaint?" became "Has complaint?" in Oct 2026).
import { gunzipSync, gzipSync } from "zlib";
import { parseCsv, brandOf } from "../src/lib/talabatCsv.js";

export { parseCsv, brandOf };

export interface TalabatBrandRow {
  brand: string;
  orders: number;
  delivered: number;
  cancelled: number;
  complaints: number;
  stores: number;
  sales_fils: number;
}

export interface TalabatSummary {
  orders: number;
  delivered: number;
  cancelled: number;
  statuses: Record<string, number>;
  stores: number;
  complaints: number;
  pro_orders: number;
  vendor_delivery: number;
  sales_fils: number;
  discount_fils: number;
  payout_fils: number;
  hourly: number[];
  brands: TalabatBrandRow[];
  cancel_reasons: { reason: string; count: number }[];
  cancel_owners: Record<string, number>;
}

const fils = (v: string | undefined): number => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 1000) : 0;
};
const yes = (v: string | undefined) => /^(y|yes|true|1)$/i.test(String(v ?? "").trim());

export class TalabatReportError extends Error {}

/** Parses and checks one day's report. Throws TalabatReportError when the file is not that day's Order report. */
export function readReport(csv: Buffer, day: string): { summary: TalabatSummary; columns: string[] } {
  const text = csv.toString("utf8").replace(/^﻿/, "");
  const rows = parseCsv(text).filter((r) => r.length > 1 || (r[0] || "").trim());
  if (!rows.length) throw new TalabatReportError("The file is empty.");
  const columns = rows[0].map((h) => h.trim());
  const idx = new Map(columns.map((h, i) => [h.toLowerCase(), i]));
  const col = (name: string) => idx.get(name.toLowerCase()) ?? -1;
  const need = ["Restaurant name", "Order ID", "Store ID", "Order status", "Order received at"];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) throw new TalabatReportError(`Not a Talabat Order report — missing column(s): ${missing.join(", ")}.`);

  const c = {
    name: col("Restaurant name"), id: col("Order ID"), store: col("Store ID"), status: col("Order status"),
    received: col("Order received at"), complaint: col("Has complaint?"), pro: col("Is Pro order"),
    delivery: col("Delivery type"), subtotal: col("Subtotal"), discount: col("Total discount"), payout: col("Payout amount"),
    cancelReason: col("Cancellation reason"), cancelOwner: col("Cancellation owner"),
  };
  const data = rows.slice(1);
  const s: TalabatSummary = {
    orders: 0, delivered: 0, cancelled: 0, statuses: {}, stores: 0, complaints: 0, pro_orders: 0, vendor_delivery: 0,
    sales_fils: 0, discount_fils: 0, payout_fils: 0, hourly: new Array(24).fill(0), brands: [], cancel_reasons: [], cancel_owners: {},
  };
  const stores = new Set<string>();
  const ids = new Set<string>();
  const brands = new Map<string, TalabatBrandRow & { storeSet: Set<string> }>();
  const reasons = new Map<string, number>();
  let onDay = 0;

  for (const r of data) {
    const id = (r[c.id] || "").trim();
    if (!id || ids.has(id)) continue; // a repeated order is counted once
    ids.add(id);
    const status = (r[c.status] || "").trim() || "Unknown";
    const delivered = /^delivered$/i.test(status);
    const cancelled = /^cancel/i.test(status);
    const complaint = c.complaint >= 0 && yes(r[c.complaint]);
    const store = (r[c.store] || "").trim();
    const sales = c.subtotal >= 0 ? fils(r[c.subtotal]) : 0;

    s.orders++;
    s.statuses[status] = (s.statuses[status] || 0) + 1;
    if (delivered) s.delivered++;
    if (cancelled) s.cancelled++;
    if (complaint) s.complaints++;
    if (c.pro >= 0 && yes(r[c.pro])) s.pro_orders++;
    if (c.delivery >= 0 && /vendor|own/i.test(r[c.delivery] || "")) s.vendor_delivery++;
    if (!cancelled) {
      s.sales_fils += sales;
      if (c.discount >= 0) s.discount_fils += fils(r[c.discount]);
    }
    if (c.payout >= 0) s.payout_fils += fils(r[c.payout]);
    if (store) stores.add(store);

    // Orders placed just before midnight can be received a few minutes after it; they stay in this day.
    const received = (r[c.received] || "").trim();
    const recDay = received.slice(0, 10);
    if (recDay === day) onDay++;
    const hour = recDay > day ? 23 : recDay < day ? 0 : Math.min(23, Math.max(0, parseInt(received.slice(11, 13), 10) || 0));
    s.hourly[hour]++;

    if (cancelled) {
      const reason = (c.cancelReason >= 0 ? r[c.cancelReason] : "")?.trim() || "No reason given";
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
      const owner = (c.cancelOwner >= 0 ? r[c.cancelOwner] : "")?.trim() || "Unknown";
      s.cancel_owners[owner] = (s.cancel_owners[owner] || 0) + 1;
    }

    const brand = brandOf(r[c.name]);
    let b = brands.get(brand);
    if (!b) { b = { brand, orders: 0, delivered: 0, cancelled: 0, complaints: 0, stores: 0, sales_fils: 0, storeSet: new Set() }; brands.set(brand, b); }
    b.orders++;
    if (delivered) b.delivered++;
    if (cancelled) b.cancelled++;
    if (complaint) b.complaints++;
    if (!cancelled) b.sales_fils += sales;
    if (store) b.storeSet.add(store);
  }

  if (s.orders >= 20 && onDay / s.orders < 0.9) {
    throw new TalabatReportError(`This file is not the report of ${day}: only ${onDay} of ${s.orders} orders were received that day.`);
  }
  s.stores = stores.size;
  s.brands = [...brands.values()]
    .map(({ storeSet, ...b }) => ({ ...b, stores: storeSet.size }))
    .sort((a, b) => b.orders - a.orders);
  s.cancel_reasons = [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  return { summary: s, columns };
}

/** The upload body may arrive gzipped (the tool compresses it) or as plain CSV. */
export function plainCsv(body: Buffer): Buffer {
  return body.length > 2 && body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body) : body;
}

export const gzip = (b: Buffer) => gzipSync(b, { level: 9 });
export const gunzip = (b: Buffer) => gunzipSync(b);
