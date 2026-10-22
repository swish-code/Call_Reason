// Keeta merchant-portal data for the "Delivery Platforms" page, uploaded by the talabat-export tool on the office
// laptop (see talabat-export/keeta-export.js):
//   * the daily Download-center "Order data" report (.xlsx, one row per order, grouped by COMPLETION date), and
//   * the Refund orders list (exact refund amounts per order, read from the portal API).
// Customer data never reaches this server: neither source is asked for names, phones or addresses.
import * as XLSX from "xlsx";
import { gzipSync } from "zlib";
import { brandOf } from "../src/lib/talabatCsv.js";

export class KeetaReportError extends Error {}

/** One order of a platform, in the shape stored in platform_orders (money in fils, 1 KWD = 1000 fils). */
export interface PlatformFact {
  order_id: string;
  day: string;
  brand: string;
  store: string;
  valid: boolean;      // counts as a sale (not cancelled)
  cancelled: boolean;
  reversal?: boolean;  // Keeta only: a later-day restatement row (negative money, not an order) — see readKeetaOrders
  after_refund?: boolean; // Keeta only: the report row already shows the value AFTER a same-day partial refund
  base_item: number;   // item value as the report shows it
  base_promo: number;  // promotion cost funded by us
  base_payout: number | null; // what the platform pays us for the order; null = not known yet
  adjust: number;      // cancelled orders only: compensation paid to us (+) or owed back to the platform (−)
}

export interface KeetaSummary {
  orders: number;          // valid orders
  cancelled: number;
  statuses: Record<string, number>;
  stores: number;
  hourly: number[];        // valid orders by hour of the ORDER time
  cancel_types: Record<string, number>;
  prep_avg_min: number | null;
  item_sales_fils: number; promo_fils: number; subsidy_fils: number; commission_fils: number;
  other_fils: number; delivery_fee_fils: number; earnings_fils: number; compensation_fils: number;
  brands: { brand: string; orders: number; cancelled: number; stores: number }[];
}

const fils = (v: unknown): number => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 1000) : 0;
};

/** Keeta names a branch "BBT(Ardiya)": brand before the bracket, branch inside it. */
export function keetaBrand(storeName: string): string {
  const b = brandOf(String(storeName || "").trim());
  return b.includes("(") ? b.slice(0, b.indexOf("(")).trim() || "Unknown" : b;
}
export const keetaBranch = (storeName: string): string => (/\(([^)]*)\)/.exec(String(storeName || "")) || [])[1]?.trim() || "";

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Reads one day's Order-data workbook. Keeta writes the sheet with a wrong declared range (A1:A<n>), so SheetJS
 * would see only the first column: the range is recomputed from the cells that really exist.
 */
export function readKeetaOrders(file: Buffer, day: string): { facts: PlatformFact[]; csvGz: Buffer; csvBytes: number; summary: KeetaSummary; columns: string[] } {
  let wb: XLSX.WorkBook;
  try { wb = XLSX.read(file, { type: "buffer" }); } catch { throw new KeetaReportError("The file is not an Excel workbook."); }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new KeetaReportError("The workbook has no sheet.");
  let maxR = 0, maxC = 0;
  for (const k of Object.keys(ws)) {
    if (k.startsWith("!")) continue;
    const c = XLSX.utils.decode_cell(k);
    if (c.r > maxR) maxR = c.r;
    if (c.c > maxC) maxC = c.c;
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  // Formatted text for ids / dates / status (what the portal shows), but money straight from the cell: Keeta formats
  // amounts with two decimals while the stored values have three, and 6,000 roundings a day add up to several KWD.
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
  for (let k = 1; k < rows.length; k++) {
    for (let i = 0; i < rows[k].length; i++) {
      const cell = ws[XLSX.utils.encode_cell({ r: k, c: i })];
      if (cell && cell.t === "n" && typeof cell.v === "number") rows[k][i] = String(cell.v);
    }
  }
  if (rows.length < 1) throw new KeetaReportError("The file is empty.");
  const columns = rows[0].map((h) => String(h).trim());
  const idx = new Map(columns.map((h, i) => [h.toLowerCase(), i]));
  const need = ["Date", "Store name", "Order ID", "Order status", "Earnings", "Item sales"];
  const missing = need.filter((n) => !idx.has(n.toLowerCase()));
  if (missing.length) throw new KeetaReportError(`Not a Keeta Order-data report — missing column(s): ${missing.join(", ")}.`);
  const col = (n: string) => idx.get(n.toLowerCase()) ?? -1;
  const c = {
    date: col("Date"), store: col("Store name"), id: col("Order ID"), status: col("Order status"), type: col("Cancellation type"),
    earn: col("Earnings"), item: col("Item sales"), promo: col("Promotion expense"), sub: col("Keeta promotion subsidies"),
    comm: col("Commission"), other: col("Other expenses"), rev: col("Other revenue"), fee: col("Delivery fee"),
    time: col("Order time"), prep: col("Meal ready time (min)"),
  };
  const compact = day.replace(/-/g, "");
  const g = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");

  const facts: PlatformFact[] = [];
  const seen = new Set<string>();
  const stores = new Set<string>();
  const brands = new Map<string, { brand: string; orders: number; cancelled: number; storeSet: Set<string> }>();
  const s: KeetaSummary = {
    orders: 0, cancelled: 0, statuses: {}, stores: 0, hourly: new Array(24).fill(0), cancel_types: {}, prep_avg_min: null,
    item_sales_fils: 0, promo_fils: 0, subsidy_fils: 0, commission_fils: 0, other_fils: 0, delivery_fee_fils: 0, earnings_fils: 0, compensation_fils: 0, brands: [],
  };
  let onDay = 0, prepSum = 0, prepN = 0;
  const lines: string[] = [columns.map(csvCell).join(",")];

  for (const r of rows.slice(1)) {
    const id = g(r, c.id);
    if (!id || seen.has(id)) continue; // a repeated row is counted once
    seen.add(id);
    if (g(r, c.date) === compact) onDay++;
    lines.push(columns.map((_, i) => csvCell(String(r[i] ?? ""))).join(","));

    const status = g(r, c.status) || "Unknown";
    const earn = fils(g(r, c.earn)), item = fils(g(r, c.item)), promo = fils(g(r, c.promo));
    // A status ending in "*" is a restatement: an order refunded or cancelled AFTER the day it was completed is written
    // again on the later day with NEGATIVE amounts (the refunded part; the whole order for "Cancelled*"). It is not an
    // order — it carries only money, which is how the portal's own totals come out net of those refunds.
    const reversal = /\*$/.test(status) && item <= 0;
    const cancelled = /^cancel/i.test(status) && !reversal;
    const store = g(r, c.store);
    const brand = keetaBrand(store);
    stores.add(store);
    s.statuses[status] = (s.statuses[status] || 0) + 1;
    let b = brands.get(brand);
    if (!b) { b = { brand, orders: 0, cancelled: 0, storeSet: new Set() }; brands.set(brand, b); }
    b.storeSet.add(store);

    const adjust = cancelled ? earn : 0;
    if (reversal) {
      s.item_sales_fils += item; s.promo_fils += promo; s.subsidy_fils += fils(g(r, c.sub)); s.commission_fils += fils(g(r, c.comm));
      s.other_fils += fils(g(r, c.other)); s.delivery_fee_fils += fils(g(r, c.fee)); s.earnings_fils += earn;
    } else if (cancelled) {
      s.cancelled++; b.cancelled++;
      const t = g(r, c.type) || "Unknown";
      s.cancel_types[t] = (s.cancel_types[t] || 0) + 1;
      s.compensation_fils += adjust;
    } else {
      s.orders++; b.orders++;
      s.item_sales_fils += item; s.promo_fils += promo; s.subsidy_fils += fils(g(r, c.sub)); s.commission_fils += fils(g(r, c.comm));
      s.other_fils += fils(g(r, c.other)); s.delivery_fee_fils += fils(g(r, c.fee)); s.earnings_fils += earn;
      const hour = parseInt(/(\d{2}):\d{2}:\d{2}$/.exec(g(r, c.time))?.[1] || "", 10);
      if (Number.isFinite(hour)) s.hourly[hour]++;
      const prep = parseFloat(g(r, c.prep));
      if (Number.isFinite(prep) && prep >= 0 && prep < 300) { prepSum += prep; prepN++; }
    }
    facts.push({
      order_id: id, day, brand, store, valid: !cancelled && !reversal, cancelled, reversal, after_refund: status === "Partial refund",
      base_item: cancelled ? 0 : item, base_promo: cancelled ? 0 : promo, base_payout: cancelled ? null : earn, adjust,
    });
  }

  if (facts.length >= 20 && onDay / facts.length < 0.9) {
    throw new KeetaReportError(`This file is not the report of ${day}: only ${onDay} of ${facts.length} orders are dated that day.`);
  }
  s.stores = stores.size;
  s.prep_avg_min = prepN ? Math.round((prepSum / prepN) * 10) / 10 : null;
  s.brands = [...brands.values()].map(({ storeSet, ...x }) => ({ ...x, stores: storeSet.size })).sort((a, b) => b.orders - a.orders);
  const csv = Buffer.from(lines.join("\n"), "utf8");
  return { facts, csvGz: gzipSync(csv, { level: 9 }), csvBytes: csv.length, summary: s, columns };
}

/** One refunded order of the Refund orders list. */
export interface KeetaRefund {
  order_id: string;
  ordered_at: string | null;   // ISO, order creation
  refunded_at: string | null;  // ISO, when the refund went through
  store: string;
  brand: string;
  partial: boolean;
  refund_money: number;        // what the customer got back (can include delivery), fils
  reason: string;
  responsible: string;
  original: number;            // item value before the refund, fils
  item_after: number;          // item value after it, fils (0 for a full refund)
  promo_after: number | null;  // our promotion cost after the refund
  payout_after: number | null; // our earnings after the refund
}

const iso = (ms: unknown) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

/** Reads the refund list the laptop pulled (an array of plain facts, see talabat-export/keeta-export.js). */
export function readKeetaRefunds(body: Buffer): KeetaRefund[] {
  let j: unknown;
  try { j = JSON.parse(body.toString("utf8")); } catch { throw new KeetaReportError("The refund list is not valid JSON."); }
  if (!Array.isArray(j)) throw new KeetaReportError("The refund list must be a JSON array.");
  const out: KeetaRefund[] = [];
  for (const r of j as any[]) {
    const id = String(r?.id ?? "").trim();
    if (!id) continue;
    const original = num(r.original);
    if (original === null) continue; // not an order with money details
    const shop = String(r.shopName ?? "").trim();
    const code = String(r.shopCode ?? "").trim();
    const store = code && code !== shop ? `${shop}(${code})` : shop;
    out.push({
      order_id: id, ordered_at: iso(r.ordered), refunded_at: iso(r.refundTime), store, brand: keetaBrand(store),
      partial: !!r.partRefund, refund_money: num(r.refundMoney) ?? 0,
      reason: String(r.reason ?? "").split(/\.?\s*Additional information/i)[0].trim().slice(0, 120),
      responsible: String(r.responsible ?? ""),
      original, item_after: num(r.itemAfter) ?? 0,
      promo_after: num(r.activity) !== null ? Math.max(0, (num(r.activity) as number) - (num(r.rebatesActivity) ?? 0)) : null,
      payout_after: num(r.earningsAfter) ?? (r.partRefund ? null : 0),
    });
  }
  if (!out.length && (j as any[]).length) throw new KeetaReportError("None of the refund rows has money details.");
  return out;
}
