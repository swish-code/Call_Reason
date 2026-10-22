import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../lib/api.ts";
import { parseCsv, brandOf } from "../lib/talabatCsv.ts";
import { downloadCSV } from "../utils.js";
import { Search, X, Download, ChevronLeft, ChevronRight, Loader2, ArrowDown, ArrowUp, AlertTriangle, Undo2, Copy, Check, Ban, Megaphone } from "lucide-react";
import { kwd } from "./TalabatReports.tsx";

// The orders of one Keeta day (Download-center "Order data" report, by completion date): the page fetches the day's
// stored CSV (sent gzipped), reads it in the browser and lists every order, with a side panel for one order's
// timeline and money. Refunds come from Keeta's refund list (exact amounts) and are shown on the orders they hit.

export interface KeetaRefund {
  order_id: string; original: number; item_after: number; promo_after: number | null; payout_after: number | null; refund_money: number | null;
  partial: boolean | null; reason: string | null; responsible: string | null; ordered_at: string | null; refunded_at: string | null;
  store: string | null; brand: string | null; day: string | null; order_cancelled: boolean | null;
}
export interface KeetaPreset { status?: "all" | "completed" | "partial" | "cancelled"; refunded?: boolean; q?: string; openId?: string; nonce: number }

interface Order {
  row: string[]; id: string; store: string; brand: string; branch: string; status: string; cancelled: boolean; reversal: boolean;
  finish: string; orderTime: string; finishMin: number | null; prep: number | null;
  item: number; promo: number; comm: number; other: number; earn: number; rev: number; delivery: number; subsidy: number; cancelType: string; search: string;
}
interface Parsed { header: string[]; col: (n: string) => number; orders: Order[] }

const PAGE = 50;
const cache = new Map<string, Parsed>();

const fils = (v: string | undefined): number => { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? Math.round(n * 1000) : 0; };
const toMin = (s: string | undefined): number | null => {
  const m = /(\d{4})-?(\d{2})-?(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;
};
const hhmm = (s: string) => (/(\d{2}):(\d{2})/.exec(s || "") || [])[0] || "";
const brandName = (store: string) => { const b = brandOf(store); return b.includes("(") ? b.slice(0, b.indexOf("(")).trim() : b; };
const branchName = (store: string) => (/\(([^)]*)\)/.exec(store) || [])[1] || "";

function build(rows: string[][]): Parsed {
  const header = (rows[0] || []).map((h) => h.trim());
  const idx = new Map(header.map((h, i) => [h.toLowerCase(), i]));
  const col = (n: string) => idx.get(n.toLowerCase()) ?? -1;
  const g = (r: string[], n: string) => { const i = col(n); return i >= 0 ? (r[i] || "").trim() : ""; };
  const orders: Order[] = [];
  for (const r of rows.slice(1)) {
    const id = g(r, "Order ID");
    if (!id) continue;
    const store = g(r, "Store name"), status = g(r, "Order status") || "Unknown";
    const item = fils(g(r, "Item sales"));
    // Same rule as server/keeta.ts: a "*" status is Keeta restating an earlier order on a later day (negative money, not an order).
    const reversal = /\*$/.test(status) && item <= 0, cancelled = /^cancel/i.test(status) && !reversal;
    const oMin = toMin(g(r, "Order time")), fMin = toMin(g(r, "Completion time"));
    const prep = parseFloat(g(r, "Meal ready time (min)"));
    orders.push({
      row: r, id, store, brand: brandName(store), branch: branchName(store) || store, status, cancelled, reversal,
      finish: g(r, "Completion time"), orderTime: g(r, "Order time"), finishMin: fMin !== null && oMin !== null ? fMin - oMin : null, prep: Number.isFinite(prep) ? prep : null,
      item, promo: fils(g(r, "Promotion expense")), comm: fils(g(r, "Commission")), other: fils(g(r, "Other expenses")), earn: fils(g(r, "Earnings")), rev: fils(g(r, "Other revenue")),
      delivery: fils(g(r, "Delivery fee")), subsidy: fils(g(r, "Keeta promotion subsidies")), cancelType: g(r, "Cancellation type"),
      search: [id, store, g(r, "Cancellation type")].join(" ").toLowerCase(),
    });
  }
  return { header, col, orders };
}

type SortKey = "time" | "item" | "earn" | "prep";

function StatusBadge({ o }: { o: Order }) {
  const cls = o.status === "Completed" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" : o.status === "Partial refund" ? "bg-amber-500/10 text-amber-500 border-amber-500/30" : o.cancelled ? "bg-rose-500/10 text-rose-500 border-rose-500/30" : "bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${cls}`}>{o.status}</span>;
}

export default function KeetaOrders({ day, version, preset, refunds }: { day: string; version: string; preset?: KeetaPreset; refunds: Map<string, KeetaRefund> }) {
  const [data, setData] = useState<Parsed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [status, setStatus] = useState<"all" | "completed" | "partial" | "cancelled">("all");
  const [refundedOnly, setRefundedOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "time", desc: true });
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const dq = useDeferredValue(q.trim().toLowerCase());

  useEffect(() => {
    let gone = false;
    const key = `${day}|${version}`;
    const hit = cache.get(key);
    if (hit) { setData(hit); setError(""); return; }
    setData(null); setLoading(true); setError("");
    (async () => {
      const res = await apiFetch(`/api/keeta/reports/${day}/download`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load the orders.");
      const text = (await res.text()).replace(/^\uFEFF/, "");
      await new Promise((r) => setTimeout(r, 0));
      const parsed = build(parseCsv(text));
      cache.set(key, parsed);
      if (cache.size > 4) cache.delete(cache.keys().next().value as string);
      if (!gone) setData(parsed);
    })().catch((e) => { if (!gone) setError(e.message); }).finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, [day, version]);

  useEffect(() => {
    if (!preset) return;
    setStatus(preset.status || "all"); setRefundedOnly(!!preset.refunded); setQ(preset.q || ""); setBrand(""); setPage(0); setOpenId(preset.openId || null);
  }, [preset?.nonce]);
  useEffect(() => { setPage(0); }, [dq, brand, status, refundedOnly, sort, day]);
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
      (status === "all" || (status === "completed" ? o.status === "Completed" : status === "partial" ? o.status === "Partial refund" : o.cancelled)) &&
      (!refundedOnly || (refunds.has(o.id) && !o.cancelled)) && (!dq || o.search.includes(dq)));
    const val = (o: Order): number => sort.key === "time" ? toMin(o.finish) ?? toMin(o.orderTime) ?? 0 : sort.key === "item" ? o.item : sort.key === "earn" ? o.earn : o.prep ?? -1;
    r.sort((a, b) => (sort.desc ? val(b) - val(a) : val(a) - val(b)) || a.id.localeCompare(b.id));
    return r;
  }, [data, brand, status, refundedOnly, dq, sort, refunds]);

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
      <button onClick={() => sortBy(k)} className={`inline-flex items-center gap-1 hover:text-[var(--heading)] ${sort.key === k ? "text-[var(--heading)]" : ""}`}>{label}{sort.key === k && (sort.desc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}</button>
    </th>
  );
  const chip = (on: boolean) => `px-3 py-1.5 rounded-xl text-[11px] font-bold border transition ${on ? "text-white border-transparent" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)]"}`;
  const onStyle = (on: boolean) => (on ? { background: "var(--t-violet)" } : undefined);
  const filtered = !!(brand || status !== "all" || refundedOnly || dq);

  if (error) return <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {error}</div>;
  if (loading || !data) return <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-12 text-center shadow-lg text-xs text-[var(--muted)] flex flex-col items-center gap-3"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--t-violet)" }} /> Loading the orders of this day…</div>;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg overflow-hidden tlb-rise">
      <div className="p-4 border-b border-[var(--border)] space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-2.5" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order ID, store, cancellation type…" className="w-full pl-9 pr-8 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:outline-none focus:ring-2" />
            {q && <button onClick={() => setQ("")} className="absolute right-2 top-2 p-0.5 text-[var(--muted)] hover:text-[var(--heading)]"><X className="w-3.5 h-3.5" /></button>}
          </div>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs font-bold focus:outline-none">
            <option value="">All brands</option>
            {brands.map(([b, n]) => <option key={b} value={b}>{b} ({n.toLocaleString("en-US")})</option>)}
          </select>
          <button onClick={() => downloadCSV(data.header, rows.map((o) => o.row), `keeta-orders_${day}${filtered ? "_filtered" : ""}`)} disabled={!rows.length}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600/20 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-600/30 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> Export {filtered ? "filtered" : "all"}</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {([["all", "All statuses"], ["completed", "Completed"], ["partial", "Partial refund"], ["cancelled", "Cancelled"]] as const).map(([k, l]) => <button key={k} onClick={() => setStatus(k)} className={chip(status === k)} style={onStyle(status === k)}>{l}</button>)}
          <span className="w-px h-5 bg-[var(--border)] mx-1" />
          <button onClick={() => setRefundedOnly(!refundedOnly)} className={chip(refundedOnly)} style={onStyle(refundedOnly)}>Has a refund</button>
          {filtered && <button onClick={() => { setQ(""); setBrand(""); setStatus("all"); setRefundedOnly(false); }} className="text-[11px] font-bold text-[var(--muted)] hover:text-[var(--heading)] underline underline-offset-2 ml-1">Clear filters</button>}
          <span className="flex-1" />
          <span className="text-[11px] text-[var(--muted)]"><b className="text-[var(--heading)] font-mono">{rows.length.toLocaleString("en-US")}</b> of {data.orders.length.toLocaleString("en-US")} orders</span>
        </div>
      </div>

      {!rows.length ? <div className="text-center py-12 text-xs text-[var(--muted)]">No order matches these filters.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] bg-[var(--surface-2)]/40 whitespace-nowrap">
                <SortHead k="time" label="Completed" />
                <th className="text-left py-2.5 px-3">Order ID</th><th className="text-left py-2.5 px-3">Store</th><th className="text-left py-2.5 px-3">Status</th>
                <SortHead k="prep" label="Prep" /><SortHead k="item" label="Item sales" right />
                <th className="text-right py-2.5 px-3">Promo</th><th className="text-right py-2.5 px-3">Commission</th><SortHead k="earn" label="Earnings" right />
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => {
                const rf = refunds.get(o.id);
                return (
                  <tr key={o.id} onClick={() => setOpenId(o.id)} className={`border-b border-[var(--border)]/40 last:border-0 cursor-pointer transition-colors ${openId === o.id ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]/40"}`}>
                    <td className="py-2 px-3 font-mono whitespace-nowrap">{hhmm(o.finish) || "—"}</td>
                    <td className="py-2 px-3 font-mono font-bold text-[var(--heading)] whitespace-nowrap">{o.id}</td>
                    <td className="py-2 px-3 max-w-[14rem]"><div className="font-bold text-[var(--heading)] truncate">{o.brand}</div><div className="text-[10px] text-[var(--muted)] truncate">{o.branch}</div></td>
                    <td className="py-2 px-3 whitespace-nowrap"><div className="flex items-center gap-1.5"><StatusBadge o={o} />{rf && !o.cancelled && <span title={`Refund −${kwd(rf.original - rf.item_after)} KWD`}><Undo2 className="w-3.5 h-3.5 text-rose-500" /></span>}</div></td>
                    <td className="py-2 px-3 font-mono whitespace-nowrap">{o.prep !== null ? `${Math.round(o.prep)} min` : "—"}</td>
                    <td className="py-2 px-3 text-right font-mono whitespace-nowrap">{o.cancelled ? "—" : kwd(o.item)}</td>
                    <td className="py-2 px-3 text-right font-mono whitespace-nowrap text-[var(--muted)]">{o.cancelled ? "—" : kwd(o.promo)}</td>
                    <td className="py-2 px-3 text-right font-mono whitespace-nowrap text-[var(--muted)]">{o.cancelled ? "—" : kwd(o.comm)}</td>
                    <td className="py-2 px-3 text-right font-mono whitespace-nowrap font-bold" style={{ color: o.cancelled && o.earn > 0 ? "var(--t-aqua)" : undefined }}>{o.reversal ? "—" : o.cancelled && o.earn > 0 ? `+${kwd(o.earn)}` : kwd(o.earn)}</td>
                  </tr>
                );
              })}
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
        <OrderPanel o={open} data={data} refund={refunds.get(open.id)} onClose={() => setOpenId(null)}
          onPrev={openIdx > 0 ? () => setOpenId(rows[openIdx - 1].id) : undefined}
          onNext={openIdx >= 0 && openIdx < rows.length - 1 ? () => setOpenId(rows[openIdx + 1].id) : undefined}
          position={openIdx >= 0 ? `${openIdx + 1} of ${rows.length.toLocaleString("en-US")}` : ""} />
      )}
    </div>
  );
}

function OrderPanel({ o, data, refund, onClose, onPrev, onNext, position }: { o: Order; data: Parsed; refund?: KeetaRefund; onClose: () => void; onPrev?: () => void; onNext?: () => void; position: string }) {
  const [copied, setCopied] = useState(false);
  const [all, setAll] = useState(false);
  const g = (name: string) => { const i = data.col(name); return i >= 0 ? (o.row[i] || "").trim() : ""; };
  useEffect(() => { setCopied(false); }, [o.id]);
  const steps: { label: string; at: string }[] = [
    { label: "Order placed", at: g("Order time") }, { label: "Accepted by the store", at: g("Order acceptance time") }, { label: "Meal ready", at: g("Meal ready time") },
    { label: "Courier pickup", at: g("Courier pickup time") }, { label: o.cancelled ? "Cancelled / refunded" : "Completed", at: o.cancelled ? g("Cancellation & refund time") : g("Completion time") },
  ];
  let prev: number | null = null;
  const copy = async () => { try { await navigator.clipboard.writeText(o.id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  const line = (label: string, v: number, strong?: boolean, hint?: string) => (
    <div className={`flex justify-between px-3 py-2 text-xs ${strong ? "font-bold text-[var(--heading)]" : ""}`}><span>{label}{hint && <span className="text-[10px] text-[var(--muted)] font-normal"> · {hint}</span>}</span><span className="font-mono">{kwd(v)}</span></div>
  );
  const campaign = g("Campaign Details");
  return createPortal(
    <div className="tlb fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Order ${o.id}`}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full overflow-y-auto bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl text-[var(--text)]" style={{ animation: "tlb-slide .28s cubic-bezier(.2,.8,.2,1) both" }}>
        <style>{"@keyframes tlb-slide { from { transform: translateX(32px); opacity: 0 } to { transform: none; opacity: 1 } }"}</style>
        <div className="sticky top-0 z-10 bg-[var(--surface)]/95 backdrop-blur border-b border-[var(--border)] px-5 py-3 flex items-center gap-2">
          <button onClick={onPrev} disabled={!onPrev} title="Previous order (↑)" className="p-1.5 rounded-lg border border-[var(--border)] disabled:opacity-30 hover:bg-[var(--surface-2)]"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={onNext} disabled={!onNext} title="Next order (↓)" className="p-1.5 rounded-lg border border-[var(--border)] disabled:opacity-30 hover:bg-[var(--surface-2)]"><ChevronRight className="w-4 h-4" /></button>
          <span className="text-[11px] text-[var(--muted)]">{position}</span><span className="flex-1" />
          <button onClick={onClose} title="Close (Esc)" className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--heading)]"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-black text-[var(--heading)] font-mono">#{o.id}</h2>
              <button onClick={copy} title="Copy the order ID" className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface-2)]">{copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}</button>
              <StatusBadge o={o} />
            </div>
            <div className="text-sm font-bold text-[var(--heading)] mt-1.5">{o.store}</div>
            <div className="text-[11px] text-[var(--muted)]">Store ID {g("Store ID")} · {o.brand} · {g("Order type")}</div>
          </div>

          {refund && !o.cancelled && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs">
              <div className="font-bold text-rose-500 flex items-center gap-1.5"><Undo2 className="w-4 h-4" /> {refund.partial ? "Partial refund" : "Full refund"}{refund.reason ? ` — ${refund.reason}` : ""}</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div><div className="text-[10px] text-[var(--muted)]">Original</div><div className="font-mono font-bold text-[var(--heading)]">{kwd(refund.original)}</div></div>
                <div><div className="text-[10px] text-[var(--muted)]">Refunded</div><div className="font-mono font-bold text-rose-500">−{kwd(refund.original - refund.item_after)}</div></div>
                <div><div className="text-[10px] text-[var(--muted)]">After refund</div><div className="font-mono font-bold text-[var(--heading)]">{kwd(refund.item_after)}</div></div>
              </div>
              {refund.payout_after !== null && <div className="text-[10px] text-[var(--muted)] mt-2">Earnings after the refund: <b className="font-mono text-[var(--heading)]">{kwd(refund.payout_after)}</b> KWD{refund.refund_money ? ` · the customer got ${kwd(refund.refund_money)} KWD back` : ""}</div>}
            </div>
          )}

          {o.cancelled && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs">
              <div className="font-bold text-rose-500 flex items-center gap-1.5"><Ban className="w-4 h-4" /> {o.status}</div>
              <div className="mt-1 text-[var(--heading)]">{o.cancelType || "No cancellation type"}</div>
              {o.reversal && <div className="text-[10px] text-[var(--muted)] mt-1">Refunded or cancelled after the day it was completed: Keeta writes the amount taken back as a negative row on this day. It is counted as a refund here, not as an order.</div>}
              {o.earn > 0 && <div className="text-[10px] text-[var(--muted)] mt-1">Keeta compensated the store <b className="font-mono text-emerald-500">+{kwd(o.earn)}</b> KWD for this order.</div>}
            </div>
          )}

          <section>
            <h3 className="text-xs font-extrabold text-[var(--heading)] uppercase tracking-wider mb-3">Timeline</h3>
            <ol className="relative border-l-2 border-[var(--border)] ml-2 space-y-3">
              {steps.map((s) => {
                const m = toMin(s.at), gap = m !== null && prev !== null ? m - prev : null;
                if (m !== null) prev = m;
                return (
                  <li key={s.label} className="pl-4 relative">
                    <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 border-[var(--surface)]" style={{ background: m === null ? "var(--border)" : "var(--t-violet)" }} />
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={`text-xs ${m === null ? "text-[var(--muted)]" : "font-bold text-[var(--heading)]"}`}>{s.label}</span>
                      <span className="font-mono text-xs text-[var(--heading)]">{m === null ? "—" : hhmm(s.at)}{gap !== null && gap > 0 && <span className="text-[10px] text-[var(--muted)] ml-1.5">+{gap}m</span>}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
            {o.finishMin !== null && !o.cancelled && <div className="mt-3 text-[11px] text-[var(--muted)]">From order to completion: <b className="text-[var(--heading)]">{o.finishMin} min</b>{o.prep !== null && <> · meal ready after <b className="text-[var(--heading)]">{Math.round(o.prep)} min</b></>}</div>}
          </section>

          {!o.reversal && (
            <section>
              <h3 className="text-xs font-extrabold text-[var(--heading)] uppercase tracking-wider mb-2">Money (KWD)</h3>
              <div className="rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]">
                {!o.cancelled && line("Item sales", o.item, true)}
                {!o.cancelled && o.promo !== 0 && line("Promotion funded by the store", -o.promo)}
                {!o.cancelled && o.comm !== 0 && line("Commission", -o.comm)}
                {!o.cancelled && o.other !== 0 && line("Other expenses", -o.other, false, "bank fee")}
                {o.rev !== 0 && line("Other revenue", o.rev, false, "compensation")}
                {line("Earnings", o.earn, true)}
                {!o.cancelled && o.subsidy !== 0 && <div className="flex justify-between px-3 py-2 text-[11px] text-[var(--muted)]"><span>Keeta-funded promotion (not charged to the store)</span><span className="font-mono">{kwd(o.subsidy)}</span></div>}
                {!o.cancelled && o.delivery !== 0 && <div className="flex justify-between px-3 py-2 text-[11px] text-[var(--muted)]"><span>Delivery fee (paid by the customer, not part of earnings)</span><span className="font-mono">{kwd(o.delivery)}</span></div>}
              </div>
            </section>
          )}

          {campaign && campaign !== "-" && (
            <section>
              <h3 className="text-xs font-extrabold text-[var(--heading)] uppercase tracking-wider mb-2 flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5" /> Campaign</h3>
              <div className="rounded-xl border border-[var(--border)] p-2.5 text-[11px] break-words" dir="auto">{campaign}</div>
            </section>
          )}

          <section>
            <button onClick={() => setAll(!all)} className="text-xs font-bold text-[var(--muted)] hover:text-[var(--heading)] flex items-center gap-1"><ChevronRight className={`w-3.5 h-3.5 transition-transform ${all ? "rotate-90" : ""}`} /> All {data.header.length} fields from Keeta</button>
            {all && (
              <div className="mt-2 rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]/60">
                {data.header.map((h, k) => (
                  <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-1.5 text-[11px]">
                    <span className="text-[var(--muted)]">{h}</span><span className="text-[var(--heading)] break-words" dir="auto">{(o.row[k] || "").trim() || <span className="text-[var(--muted)]">—</span>}</span>
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
