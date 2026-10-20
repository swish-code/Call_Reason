import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../lib/api.ts";
import { parseCsv, brandOf } from "../lib/talabatCsv.ts";
import { downloadCSV } from "../utils.js";
import { Search, X, Download, AlertTriangle, Copy, Check, ChevronLeft, ChevronRight, Loader2, ArrowDown, ArrowUp, Crown, MapPin, CreditCard, Truck, Ban, Undo2 } from "lucide-react";

// The orders of one day's Talabat report. The page fetches that day's CSV (sent gzipped, ~0.4 MB), reads it in
// the browser and lists every order — search, filters, sorting — with a side panel showing everything Talabat
// recorded about an order: timeline, items, money, complaint and cancellation. Columns are found by name,
// case-insensitively, because Talabat renames them now and then.

export interface OrdersPreset { brand?: string; status?: "all" | "delivered" | "cancelled"; complaints?: boolean; q?: string; openId?: string; nonce: number }

interface Order {
  row: string[];
  id: string; store: string; branch: string; brand: string; status: string; address: string;
  received: string; receivedMin: number | null;
  totalMin: number | null; lateMin: number | null;
  delivered: boolean; cancelled: boolean; complaint: boolean; pro: boolean;
  subtotal: number; payout: number | null;
  items: Item[]; payMethod: string; search: string;
}
interface Item { qty: number; name: string; options: string[] }
interface Refund { id: string; state: "refunded" | "pending" | "compensated"; original_fils: number; refund_fils: number; after_fils: number; pro_fee_fils: number; compensation_fils: number }
interface Parsed { header: string[]; col: (name: string) => number; orders: Order[] }

const PAGE = 50;
const cache = new Map<string, Parsed>();

const toMin = (s: string | undefined): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || "").trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;
};
const fils = (v: string | undefined): number => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 1000) : 0;
};
const kwd = (f: number) => (f / 1000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const hhmm = (s: string) => (s || "").slice(11, 16);
const yes = (v: string | undefined) => /^(y|yes|true|1)$/i.test(String(v ?? "").trim());

// "1 Combo [1 Fries, 1 Coke], 1 Garlic Bread" → items; commas inside [...] belong to the options.
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "[") depth++;
    if (ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseItems(s: string): Item[] {
  return splitTop(s || "").map((part) => {
    const m = /^(\d+)\s+([^[]*?)\s*(?:\[(.*)\])?$/.exec(part);
    if (!m) return { qty: 1, name: part, options: [] };
    return { qty: Number(m[1]), name: m[2].trim(), options: m[3] ? splitTop(m[3]) : [] };
  });
}

function build(rows: string[][]): Parsed {
  const header = (rows[0] || []).map((h) => h.trim());
  const idx = new Map(header.map((h, i) => [h.toLowerCase(), i]));
  const col = (name: string) => idx.get(name.toLowerCase()) ?? -1;
  const g = (r: string[], name: string) => { const i = col(name); return i >= 0 ? (r[i] || "").trim() : ""; };
  const hasPayout = col("Payout amount") >= 0;
  const orders: Order[] = [];
  for (const r of rows.slice(1)) {
    const id = g(r, "Order ID");
    if (!id) continue;
    const store = g(r, "Restaurant name");
    const status = g(r, "Order status") || "Unknown";
    const received = g(r, "Order received at");
    const receivedMin = toMin(received), deliveredMin = toMin(g(r, "Delivered at")), estMin = toMin(g(r, "Estimated delivery time"));
    const cancelled = /^cancel/i.test(status);
    const items = parseItems(g(r, "Order items"));
    const payoutRaw = g(r, "Payout amount");
    orders.push({
      row: r, id, store, status, received, receivedMin,
      brand: brandOf(store),
      branch: store.includes(",") ? store.slice(store.indexOf(",") + 1).trim() : store,
      address: g(r, "Restaurant address"),
      totalMin: receivedMin !== null && deliveredMin !== null ? deliveredMin - receivedMin : null,
      lateMin: deliveredMin !== null && estMin !== null ? deliveredMin - estMin : null,
      delivered: /^delivered$/i.test(status), cancelled,
      complaint: yes(g(r, "Has complaint?")), pro: yes(g(r, "Is Pro order")),
      subtotal: fils(g(r, "Subtotal")),
      payout: hasPayout && payoutRaw !== "" ? fils(payoutRaw) : null,
      items, payMethod: g(r, "Payment method") || g(r, "Payment type"),
      search: [id, store, g(r, "Store ID"), g(r, "Restaurant address"), g(r, "Order items"), g(r, "Complaint reason"), g(r, "Cancellation reason")].join(" ").toLowerCase(),
    });
  }
  return { header, col, orders };
}

type SortKey = "time" | "total" | "late" | "subtotal";

function StatusBadge({ o }: { o: Order }) {
  const cls = o.delivered ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" : o.cancelled ? "bg-rose-500/10 text-rose-500 border-rose-500/30" : "bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>{o.status}</span>;
}

function LateBadge({ late }: { late: number | null }) {
  if (late === null) return null;
  if (late <= 0) return <span className="text-[10px] font-bold text-emerald-500">on time</span>;
  return <span className={`text-[10px] font-bold ${late >= 10 ? "text-rose-500" : "text-amber-500"}`}>+{late} min late</span>;
}

export default function TalabatOrders({ day, version, preset }: { day: string; version: string; preset?: OrdersPreset }) {
  const [data, setData] = useState<Parsed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [status, setStatus] = useState<"all" | "delivered" | "cancelled">("all");
  const [complaints, setComplaints] = useState(false);
  const [late, setLate] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "time", desc: true });
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const dq = useDeferredValue(q.trim().toLowerCase());
  // This day's partial refunds, once pulled (two days after the day): the Order report is pulled the morning
  // after, often before Talabat has charged a refunded order, so its money fields alone can disagree.
  const [refunds, setRefunds] = useState<Map<string, Refund>>(new Map());
  useEffect(() => {
    let gone = false;
    setRefunds(new Map());
    apiFetch(`/api/talabat-reports/deductions/${day}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!gone && d?.summary?.rows) setRefunds(new Map((d.summary.rows as Refund[]).map((x) => [x.id, x]))); })
      .catch(() => {});
    return () => { gone = true; };
  }, [day]);

  useEffect(() => {
    let gone = false;
    const key = `${day}|${version}`;
    const hit = cache.get(key);
    if (hit) { setData(hit); setError(""); return; }
    setData(null); setLoading(true); setError("");
    (async () => {
      const res = await apiFetch(`/api/talabat-reports/${day}/download`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load the orders.");
      const text = (await res.text()).replace(/^\uFEFF/, "");
      await new Promise((r) => setTimeout(r, 0)); // let the spinner paint before parsing
      const parsed = build(parseCsv(text));
      cache.set(key, parsed);
      if (cache.size > 4) cache.delete(cache.keys().next().value as string);
      if (!gone) setData(parsed);
    })().catch((e) => { if (!gone) setError(e.message); }).finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, [day, version]);

  // A jump from the overview (a brand row, the Cancelled or Complaints card) opens the list pre-filtered;
  // one from Partial refunds searches the order and opens its panel.
  useEffect(() => {
    if (!preset) return;
    setBrand(preset.brand || ""); setStatus(preset.status || "all"); setComplaints(!!preset.complaints);
    setLate(false); setQ(preset.q || ""); setPage(0); setOpenId(preset.openId || null);
  }, [preset?.nonce]);

  useEffect(() => { setPage(0); }, [dq, brand, status, complaints, late, sort, day]);
  // Close the panel when the day changes — but not on the first render, where a preset may have just opened it.
  const shownDay = useRef(day);
  useEffect(() => { if (shownDay.current !== day) { shownDay.current = day; setOpenId(null); } }, [day]);

  const brands = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of data?.orders || []) m.set(o.brand, (m.get(o.brand) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const r = data.orders.filter((o) =>
      (!brand || o.brand === brand) &&
      (status === "all" || (status === "delivered" ? o.delivered : o.cancelled)) &&
      (!complaints || o.complaint) &&
      (!late || (o.lateMin ?? 0) > 0) &&
      (!dq || o.search.includes(dq)));
    const val = (o: Order): number => sort.key === "time" ? o.receivedMin ?? 0 : sort.key === "total" ? o.totalMin ?? -1 : sort.key === "late" ? o.lateMin ?? -999 : o.subtotal;
    r.sort((a, b) => (sort.desc ? val(b) - val(a) : val(a) - val(b)) || a.id.localeCompare(b.id));
    return r;
  }, [data, brand, status, complaints, late, dq, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const openIdx = openId ? rows.findIndex((o) => o.id === openId) : -1;
  const open = openIdx >= 0 ? rows[openIdx] : openId ? data?.orders.find((o) => o.id === openId) : undefined;

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
      if (e.key === "ArrowDown" && openIdx >= 0 && openIdx < rows.length - 1) setOpenId(rows[openIdx + 1].id);
      if (e.key === "ArrowUp" && openIdx > 0) setOpenId(rows[openIdx - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, openIdx, rows]);

  const sortBy = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }));
  const SortHead = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th className={`py-2.5 px-3 ${right ? "text-right" : "text-left"}`}>
      <button onClick={() => sortBy(k)} className={`inline-flex items-center gap-1 hover:text-[var(--heading)] ${sort.key === k ? "text-[var(--heading)]" : ""}`}>
        {label}{sort.key === k && (sort.desc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
      </button>
    </th>
  );
  const chip = (on: boolean) => `px-3 py-1.5 rounded-xl text-[11px] font-bold border transition ${on ? "text-white border-transparent" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)]"}`;
  const onStyle = (on: boolean) => (on ? { background: "var(--t-orange)" } : undefined);
  const filtered = !!(brand || status !== "all" || complaints || late || dq);

  if (error) return <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {error}</div>;
  if (loading || !data) return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-12 text-center shadow-lg text-xs text-[var(--muted)] flex flex-col items-center gap-3">
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--t-orange)" }} /> Loading the orders of this day…
    </div>
  );

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg overflow-hidden tlb-rise">
      <div className="p-4 border-b border-[var(--border)] space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-2.5" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order ID, store, item, address, reason…" dir="auto"
              className="w-full pl-9 pr-8 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:outline-none focus:ring-2" />
            {q && <button onClick={() => setQ("")} className="absolute right-2 top-2 p-0.5 text-[var(--muted)] hover:text-[var(--heading)]" title="Clear"><X className="w-3.5 h-3.5" /></button>}
          </div>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs font-bold focus:outline-none">
            <option value="">All brands</option>
            {brands.map(([b, n]) => <option key={b} value={b}>{b} ({n.toLocaleString("en-US")})</option>)}
          </select>
          <button onClick={() => downloadCSV(data.header, rows.map((o) => o.row), `talabat-orders_${day}${filtered ? "_filtered" : ""}`)} disabled={!rows.length}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600/20 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-600/30 disabled:opacity-50" title="Every column of the orders listed below">
            <Download className="w-3.5 h-3.5" /> Export {filtered ? "filtered" : "all"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "delivered", "cancelled"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={chip(status === s)} style={onStyle(status === s)}>{s === "all" ? "All statuses" : s === "delivered" ? "Delivered" : "Cancelled"}</button>
          ))}
          <span className="w-px h-5 bg-[var(--border)] mx-1" />
          <button onClick={() => setComplaints(!complaints)} className={chip(complaints)} style={onStyle(complaints)}>Has complaint</button>
          <button onClick={() => setLate(!late)} className={chip(late)} style={onStyle(late)}>Delivered late</button>
          {filtered && <button onClick={() => { setQ(""); setBrand(""); setStatus("all"); setComplaints(false); setLate(false); }} className="text-[11px] font-bold text-[var(--muted)] hover:text-[var(--heading)] underline underline-offset-2 ml-1">Clear filters</button>}
          <span className="flex-1" />
          <span className="text-[11px] text-[var(--muted)]"><b className="text-[var(--heading)] font-mono">{rows.length.toLocaleString("en-US")}</b> of {data.orders.length.toLocaleString("en-US")} orders</span>
        </div>
      </div>

      {!rows.length ? (
        <div className="text-center py-12 text-xs text-[var(--muted)]">No order matches these filters.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] bg-[var(--surface-2)]/40 whitespace-nowrap">
                <SortHead k="time" label="Time" />
                <th className="text-left py-2.5 px-3">Order ID</th>
                <th className="text-left py-2.5 px-3">Store</th>
                <th className="text-left py-2.5 px-3">Items</th>
                <th className="text-left py-2.5 px-3">Status</th>
                <SortHead k="total" label="Delivery" />
                <SortHead k="late" label="vs estimate" />
                <SortHead k="subtotal" label="Subtotal" right />
                <th className="text-right py-2.5 px-3">Payout</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id} onClick={() => setOpenId(o.id)} className={`border-b border-[var(--border)]/40 last:border-0 cursor-pointer transition-colors ${openId === o.id ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]/40"}`}>
                  <td className="py-2 px-3 font-mono whitespace-nowrap">{hhmm(o.received)}</td>
                  <td className="py-2 px-3 font-mono font-bold text-[var(--heading)] whitespace-nowrap">{o.id}</td>
                  <td className="py-2 px-3 max-w-[14rem]">
                    <div className="font-bold text-[var(--heading)] truncate">{o.brand}</div>
                    <div className="text-[10px] text-[var(--muted)] truncate">{o.branch}</div>
                  </td>
                  <td className="py-2 px-3 max-w-[18rem]" title={o.items.map((i) => `${i.qty} × ${i.name}`).join("\n")}>
                    <div className="truncate">{o.items[0] ? `${o.items[0].qty} × ${o.items[0].name}` : "—"}</div>
                    {o.items.length > 1 && <div className="text-[10px] text-[var(--muted)]">+{o.items.length - 1} more item{o.items.length > 2 ? "s" : ""}</div>}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <StatusBadge o={o} />
                      {o.complaint && <span title="Has a complaint"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /></span>}
                      {o.pro && <span title="Pro order"><Crown className="w-3.5 h-3.5 text-violet-400" /></span>}
                      {refunds.get(o.id)?.state === "refunded" && <span title={`Partial refund −${kwd(refunds.get(o.id)!.refund_fils)} KWD`}><Undo2 className="w-3.5 h-3.5 text-rose-500" /></span>}
                    </div>
                  </td>
                  <td className="py-2 px-3 font-mono whitespace-nowrap">{o.totalMin !== null ? `${o.totalMin} min` : "—"}</td>
                  <td className="py-2 px-3 whitespace-nowrap"><LateBadge late={o.lateMin} /></td>
                  <td className="py-2 px-3 text-right font-mono whitespace-nowrap">{kwd(o.subtotal)}</td>
                  <td className="py-2 px-3 text-right font-mono whitespace-nowrap text-[var(--muted)]">{o.payout !== null ? kwd(o.payout) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > PAGE && (
        <div className="p-3 border-t border-[var(--border)] flex items-center justify-between text-[11px] text-[var(--muted)]">
          <span>{(page * PAGE + 1).toLocaleString("en-US")}–{Math.min(rows.length, (page + 1) * PAGE).toLocaleString("en-US")} of {rows.length.toLocaleString("en-US")}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(0)} disabled={!page} className="px-2 py-1 rounded-lg border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--surface-2)]">First</button>
            <button onClick={() => setPage(page - 1)} disabled={!page} className="p-1 rounded-lg border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--surface-2)]"><ChevronLeft className="w-4 h-4" /></button>
            <span className="px-2 font-bold text-[var(--heading)]">Page {page + 1} / {pages}</span>
            <button onClick={() => setPage(page + 1)} disabled={page >= pages - 1} className="p-1 rounded-lg border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--surface-2)]"><ChevronRight className="w-4 h-4" /></button>
            <button onClick={() => setPage(pages - 1)} disabled={page >= pages - 1} className="px-2 py-1 rounded-lg border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--surface-2)]">Last</button>
          </div>
        </div>
      )}

      {open && data && (
        <OrderPanel o={open} data={data} refund={refunds.get(open.id)}
          onClose={() => setOpenId(null)}
          onPrev={openIdx > 0 ? () => setOpenId(rows[openIdx - 1].id) : undefined}
          onNext={openIdx >= 0 && openIdx < rows.length - 1 ? () => setOpenId(rows[openIdx + 1].id) : undefined}
          position={openIdx >= 0 ? `${openIdx + 1} of ${rows.length.toLocaleString("en-US")}` : ""} />
      )}
    </div>
  );
}

// Everything Talabat recorded about one order.
function OrderPanel({ o, data, refund, onClose, onPrev, onNext, position }: { o: Order; data: Parsed; refund?: Refund; onClose: () => void; onPrev?: () => void; onNext?: () => void; position: string }) {
  const [copied, setCopied] = useState(false);
  const [all, setAll] = useState(false);
  const g = (name: string) => { const i = data.col(name); return i >= 0 ? (o.row[i] || "").trim() : ""; };
  useEffect(() => { setCopied(false); }, [o.id]);

  const steps: { label: string; at: string; est?: string }[] = [
    { label: "Order received", at: g("Order received at") },
    { label: "Accepted by the store", at: g("Accepted at") },
    { label: "Ready to pick up", at: g("Ready to pick up at"), est: g("Estimated ready to pick up time") },
    { label: "Rider near the store", at: g("Rider near pickup at") },
    { label: "Out for delivery", at: g("In delivery at") },
    ...(o.cancelled ? [{ label: "Cancelled", at: g("Cancelled at") }] : [{ label: "Delivered", at: g("Delivered at"), est: g("Estimated delivery time") }]),
  ];
  let prev: number | null = null;

  // Money = every amount column between the cancellation columns and the items, shown when it is not zero.
  const start = data.col("Subtotal"), end = data.col("Order items");
  const money = start >= 0 && end > start
    ? data.header.slice(start, end).map((h, k) => ({ h, v: (o.row[start + k] || "").trim() }))
      .filter(({ h, v }) => v !== "" && /^-?\d+(\.\d+)?$/.test(v) && Number(v) !== 0 && !/^is /i.test(h))
    : [];
  const strong = new Set(["subtotal", "payout amount", "estimated earnings"]);

  const copy = async () => { try { await navigator.clipboard.writeText(o.id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  const fact = (icon: any, label: string, value: string) => {
    const Icon = icon;
    return value ? <div className="flex items-start gap-2"><Icon className="w-3.5 h-3.5 mt-0.5 text-[var(--muted)] shrink-0" /><div><div className="text-[10px] text-[var(--muted)]">{label}</div><div className="text-xs font-bold text-[var(--heading)]">{value}</div></div></div> : null;
  };

  // Portalled to <body>: an animated (transformed) card above it would otherwise become the panel's frame
  // instead of the screen. The tlb wrapper carries the page's colour variables along.
  return createPortal(
    <div className="tlb fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Order ${o.id}`}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full overflow-y-auto bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl text-[var(--text)]" style={{ animation: "tlb-slide .28s cubic-bezier(.2,.8,.2,1) both" }}>
        <style>{"@keyframes tlb-slide { from { transform: translateX(32px); opacity: 0 } to { transform: none; opacity: 1 } }"}</style>
        <div className="sticky top-0 z-10 bg-[var(--surface)]/95 backdrop-blur border-b border-[var(--border)] px-5 py-3 flex items-center gap-2">
          <button onClick={onPrev} disabled={!onPrev} title="Previous order (↑)" className="p-1.5 rounded-lg border border-[var(--border)] disabled:opacity-30 hover:bg-[var(--surface-2)]"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={onNext} disabled={!onNext} title="Next order (↓)" className="p-1.5 rounded-lg border border-[var(--border)] disabled:opacity-30 hover:bg-[var(--surface-2)]"><ChevronRight className="w-4 h-4" /></button>
          <span className="text-[11px] text-[var(--muted)]">{position}</span>
          <span className="flex-1" />
          <button onClick={onClose} title="Close (Esc)" className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--heading)]"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-black text-[var(--heading)] font-mono">#{o.id}</h2>
              <button onClick={copy} title="Copy the order ID" className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface-2)]">{copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}</button>
              <StatusBadge o={o} />
              {o.complaint && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-amber-500/10 text-amber-500 border-amber-500/30"><AlertTriangle className="w-3 h-3" /> Complaint</span>}
              {o.pro && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-violet-500/10 text-violet-400 border-violet-500/30"><Crown className="w-3 h-3" /> Pro</span>}
            </div>
            <div className="text-sm font-bold text-[var(--heading)] mt-1.5">{o.store}</div>
            <div className="text-[11px] text-[var(--muted)]">Store ID {g("Store ID")} · {o.brand}</div>
          </div>

          <div className="grid grid-cols-2 gap-3 bg-[var(--surface-2)]/50 border border-[var(--border)] rounded-2xl p-4">
            {fact(Truck, "Delivery", g("Delivery type"))}
            {fact(CreditCard, "Payment", [g("Payment type"), g("Payment method")].filter(Boolean).join(" · "))}
            {fact(MapPin, "Store address", o.address)}
            {fact(Check, "Payable", g("Is Payable"))}
          </div>

          {refund && refund.state !== "pending" && (
            <div className={`rounded-2xl border p-3 text-xs ${refund.state === "refunded" ? "border-rose-500/30 bg-rose-500/10" : "border-emerald-500/30 bg-emerald-500/10"}`}>
              <div className={`font-bold flex items-center gap-1.5 ${refund.state === "refunded" ? "text-rose-500" : "text-emerald-500"}`}>
                {refund.state === "refunded" ? <><Undo2 className="w-4 h-4" /> Partial refund</> : <><Check className="w-4 h-4" /> Compensated by Talabat</>}
              </div>
              {refund.state === "refunded" ? (
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div><div className="text-[10px] text-[var(--muted)]">Original</div><div className="font-mono font-bold text-[var(--heading)]">{kwd(refund.original_fils)}</div></div>
                  <div><div className="text-[10px] text-[var(--muted)]">Refunded</div><div className="font-mono font-bold text-rose-500">−{kwd(refund.refund_fils)}</div></div>
                  <div><div className="text-[10px] text-[var(--muted)]">After refund</div><div className="font-mono font-bold text-[var(--heading)]">{kwd(refund.after_fils)}</div></div>
                </div>
              ) : <div className="mt-1 text-[var(--heading)]">Talabat paid the restaurant back <b className="font-mono">+{kwd(refund.compensation_fils)}</b> KWD on this order.</div>}
              <div className="text-[10px] text-[var(--muted)] mt-2">From Talabat's "Orders with deductions", pulled after Talabat charged the order — the amounts below come from the morning report and may predate that.</div>
            </div>
          )}

          {(o.complaint || o.cancelled) && (
            <div className="space-y-2">
              {o.complaint && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                  <div className="font-bold text-amber-500 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Customer complaint</div>
                  <div className="mt-1 text-[var(--heading)]">{g("Complaint reason") || "No reason given"}</div>
                </div>
              )}
              {o.cancelled && (
                <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs">
                  <div className="font-bold text-rose-500 flex items-center gap-1.5"><Ban className="w-4 h-4" /> Cancelled{g("Cancelled at") ? ` at ${hhmm(g("Cancelled at"))}` : ""}</div>
                  <div className="mt-1 text-[var(--heading)]">{g("Cancellation reason") || "No reason given"}</div>
                  {g("Cancellation owner") && <div className="text-[11px] text-[var(--muted)] mt-0.5">Cancelled by: {g("Cancellation owner")}</div>}
                </div>
              )}
            </div>
          )}

          <section>
            <h3 className="text-xs font-extrabold text-[var(--heading)] uppercase tracking-wider mb-3">Timeline</h3>
            <ol className="relative border-l-2 border-[var(--border)] ml-2 space-y-3">
              {steps.map((s) => {
                const m = toMin(s.at), e = toMin(s.est);
                const gap = m !== null && prev !== null ? m - prev : null;
                if (m !== null) prev = m;
                const diff = m !== null && e !== null ? m - e : null;
                const isEnd = s.label === "Delivered" || s.label === "Cancelled";
                const dot = m === null ? "var(--border)" : s.label === "Cancelled" ? "var(--t-rose)" : isEnd ? "var(--t-aqua)" : "var(--t-orange)";
                return (
                  <li key={s.label} className="pl-4 relative">
                    <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 border-[var(--surface)]" style={{ background: dot }} />
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={`text-xs ${m === null ? "text-[var(--muted)]" : "font-bold text-[var(--heading)]"}`}>{s.label}</span>
                      <span className="font-mono text-xs text-[var(--heading)]">{m === null ? "—" : hhmm(s.at)}{gap !== null && gap > 0 && <span className="text-[10px] text-[var(--muted)] ml-1.5">+{gap}m</span>}</span>
                    </div>
                    {s.est && (
                      <div className="text-[10px] text-[var(--muted)]">
                        estimated {hhmm(s.est) || "—"}
                        {diff !== null && <span className={`ml-1.5 font-bold ${diff > 0 ? (diff >= 10 ? "text-rose-500" : "text-amber-500") : "text-emerald-500"}`}>{diff > 0 ? `${diff} min late` : diff < 0 ? `${-diff} min early` : "on time"}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {o.totalMin !== null && <div className="mt-3 text-[11px] text-[var(--muted)]">From order to door: <b className="text-[var(--heading)]">{o.totalMin} min</b></div>}
          </section>

          <section>
            <h3 className="text-xs font-extrabold text-[var(--heading)] uppercase tracking-wider mb-2">Items</h3>
            <div className="space-y-2">
              {o.items.length ? o.items.map((it, k) => (
                <div key={k} className="rounded-xl border border-[var(--border)] p-2.5">
                  <div className="text-xs font-bold text-[var(--heading)]" dir="auto"><span className="font-mono mr-1.5" style={{ color: "var(--t-orange)" }}>{it.qty}×</span>{it.name}</div>
                  {it.options.length > 0 && <div className="flex flex-wrap gap-1 mt-1.5">{it.options.map((op, j) => <span key={j} dir="auto" className="px-2 py-0.5 rounded-md bg-[var(--surface-2)] text-[10px]">{op}</span>)}</div>}
                </div>
              )) : <div className="text-xs text-[var(--muted)]">No items listed.</div>}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-extrabold text-[var(--heading)] uppercase tracking-wider mb-2">Money (KWD)</h3>
            <div className="rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]">
              {money.length ? money.map(({ h, v }) => (
                <div key={h} className={`flex justify-between px-3 py-2 text-xs ${strong.has(h.toLowerCase()) ? "font-bold text-[var(--heading)]" : ""}`}>
                  <span>{h}</span><span className="font-mono">{kwd(fils(v))}</span>
                </div>
              )) : <div className="px-3 py-2 text-xs text-[var(--muted)]">No amounts on this order.</div>}
              {g("Marketing fees reasons") && <div className="px-3 py-2 text-[11px] text-[var(--muted)]">Marketing fees: {g("Marketing fees reasons")}</div>}
            </div>
          </section>

          <section>
            <button onClick={() => setAll(!all)} className="text-xs font-bold text-[var(--muted)] hover:text-[var(--heading)] flex items-center gap-1">
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${all ? "rotate-90" : ""}`} /> All {data.header.length} fields from Talabat
            </button>
            {all && (
              <div className="mt-2 rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]/60">
                {data.header.map((h, k) => (
                  <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-1.5 text-[11px]">
                    <span className="text-[var(--muted)]">{h}</span>
                    <span className="text-[var(--heading)] break-words" dir="auto">{(o.row[k] || "").trim() || <span className="text-[var(--muted)]">—</span>}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
