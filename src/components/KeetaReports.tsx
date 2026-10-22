import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import KeetaOrders, { type KeetaPreset, type KeetaRefund } from "./KeetaOrders.tsx";
import { addDays, dayLong, dayShort, fmtPct, HourlyChart, kwd, kwNow, kwTime, kwToday, Kpi, mb, num, pct, useGrow } from "./TalabatReports.tsx";
import { AlertCircle, Ban, ChevronLeft, ChevronRight, Clock, Download, LayoutDashboard, ListOrdered, RefreshCw, Store, Undo2, XCircle } from "lucide-react";

// Keeta: the same four views as Talabat, from the daily Order-data report (by completion date) and the refund list.
// Money for a day comes from platform_orders / platform_refunds (the same numbers the Net sales dashboard adds up).

interface KSummary {
  orders: number; cancelled: number; statuses: Record<string, number>; stores: number; hourly: number[]; cancel_types: Record<string, number>; prep_avg_min: number | null;
  item_sales_fils: number; promo_fils: number; compensation_fils: number; brands: { brand: string; orders: number; cancelled: number; stores: number }[];
}
interface KReport { report_day: string; file_name: string; csv_bytes: number; order_count: number; summary: KSummary; uploaded_at: string }
interface Row { platform: "talabat" | "keeta"; day: string; brand: string; orders: number; cancelled: number; gross: number; promo: number; refund: number; refunded_orders: number; payout: number; payout_orders: number; adjust: number }

const kwDay = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 10) : "");
const kwHm = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "—");
const refundDay = (r: KeetaRefund) => r.day || kwDay(r.ordered_at);

function Bars({ title, sub, groups, color }: { title: string; sub?: string; groups: { key: string; n: number; v?: number }[]; color: string }) {
  const max = Math.max(1, ...groups.map((g) => g.n));
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-lg">
      <h3 className="text-sm font-bold text-[var(--heading)]">{title}</h3>
      {sub && <p className="text-[11px] text-[var(--muted)] mt-0.5">{sub}</p>}
      {groups.length ? (
        <div className="mt-3 space-y-2.5">
          {groups.map((g, i) => (
            <div key={g.key}>
              <div className="flex justify-between gap-3 text-[11px]"><span className="truncate">{g.key}</span><span className="font-mono font-bold text-[var(--heading)] whitespace-nowrap">{g.n}{g.v !== undefined && <span className="text-[10px] text-[var(--muted)] font-normal"> · {kwd(g.v)}</span>}</span></div>
              <div className="h-2 rounded-full bg-[var(--surface-2)] mt-1 overflow-hidden"><div className="h-full rounded-full tlb-grow" style={{ width: `${pct(g.n, max)}%`, background: color, animationDelay: `${i * 50}ms` }} /></div>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-[var(--muted)] text-center py-6">Nothing this day.</p>}
    </div>
  );
}

export default function KeetaReports() {
  const [reports, setReports] = useState<KReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [day, setDay] = useState("");
  const [tab, setTab] = useState<"overview" | "orders" | "refunds" | "cancellations">("overview");
  const [preset, setPreset] = useState<KeetaPreset | undefined>();
  const [refundList, setRefundList] = useState<KeetaRefund[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [scope, setScope] = useState<"day" | "all">("day");
  const [kind, setKind] = useState<"all" | "partial" | "full">("all");

  const load = useCallback(async () => {
    try {
      setLoading(true); setError("");
      const [r, f] = await Promise.all([apiFetch("/api/keeta/reports"), apiFetch("/api/keeta/refunds")]);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not load the Keeta reports.");
      const list: KReport[] = await r.json();
      setReports(list);
      setRefundList(f.ok ? await f.json() : []);
      setDay((d) => (d && list.some((x) => x.report_day === d) ? d : list[0]?.report_day || ""));
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!day) return;
    let gone = false;
    apiFetch(`/api/platforms/daily?from=${day}&to=${day}`).then((r) => (r.ok ? r.json() : [])).then((d: Row[]) => { if (!gone) setRows(d.filter((x) => x.platform === "keeta")); }).catch(() => {});
    return () => { gone = true; };
  }, [day]);

  const idx = reports.findIndex((r) => r.report_day === day);
  const cur = idx >= 0 ? reports[idx] : undefined;
  const s = cur?.summary;
  const grown = useGrow(day);
  const refundMap = useMemo(() => new Map(refundList.map((r) => [r.order_id, r])), [refundList]);
  const showOrders = (p: Omit<KeetaPreset, "nonce">) => { setPreset({ ...p, nonce: Date.now() }); setTab("orders"); };

  const tot = useMemo(() => rows.reduce((a, r) => ({ orders: a.orders + r.orders, cancelled: a.cancelled + r.cancelled, gross: a.gross + r.gross, promo: a.promo + r.promo, refund: a.refund + r.refund, refunded: a.refunded + r.refunded_orders, payout: a.payout + r.payout + r.adjust }), { orders: 0, cancelled: 0, gross: 0, promo: 0, refund: 0, refunded: 0, payout: 0 }), [rows]);
  const net = tot.gross - tot.promo - tot.refund;

  // Refunds of the day (by the order's completion day) or all of them.
  const dayRefunds = useMemo(() => refundList.filter((r) => (scope === "all" || refundDay(r) === day) && (kind === "all" || (kind === "partial") === !!r.partial)), [refundList, scope, day, kind]);
  const counted = dayRefunds.filter((r) => !r.order_cancelled);
  const refundSum = counted.reduce((a, r) => a + (r.original - r.item_after), 0);
  const byReason = useMemo(() => { const m = new Map<string, { n: number; v: number }>(); for (const r of counted) { const k = r.reason || "No reason"; const x = m.get(k) || { n: 0, v: 0 }; x.n++; x.v += r.original - r.item_after; m.set(k, x); } return [...m.entries()].map(([key, x]) => ({ key, n: x.n, v: x.v })).sort((a, b) => b.n - a.n).slice(0, 8); }, [counted]);
  const byBrand = useMemo(() => { const m = new Map<string, { n: number; v: number }>(); for (const r of counted) { const k = r.brand || "Unknown"; const x = m.get(k) || { n: 0, v: 0 }; x.n++; x.v += r.original - r.item_after; m.set(k, x); } return [...m.entries()].map(([key, x]) => ({ key, n: x.n, v: x.v })).sort((a, b) => b.v - a.v); }, [counted]);

  const yesterday = addDays(kwToday(), -1);
  const latest = reports[0];
  const fresh = latest?.report_day === yesterday
    ? { tone: "ok", text: `Up to date — yesterday's Keeta report arrived ${kwTime(latest.uploaded_at).slice(11)} Kuwait time` }
    : kwNow().getUTCHours() >= 9
      ? { tone: "warn", text: `Yesterday's Keeta report (${dayShort(yesterday)}) has not arrived yet${latest ? ` — the latest is ${dayShort(latest.report_day)}` : ""}. Check that the office laptop is on and signed in to Keeta.` }
      : { tone: "wait", text: `Yesterday's report usually arrives a little after 06:00 Kuwait time${latest ? ` — the latest is ${dayShort(latest.report_day)}` : ""}.` };

  const download = async (r: KReport) => {
    const res = await apiFetch(`/api/keeta/reports/${r.report_day}/download`);
    if (!res.ok) { setError("Download failed."); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = r.file_name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const chip = (on: boolean) => `px-3 py-1.5 rounded-xl text-[11px] font-bold border transition ${on ? "text-white border-transparent" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)]"}`;
  const violet = (on: boolean) => (on ? { background: "var(--t-violet)" } : undefined);
  const cancelTypes: { key: string; n: number }[] = s ? (Object.entries(s.cancel_types) as [string, number][]).sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, n })) : [];

  if (loading) return <div className="text-center py-16 text-[var(--muted)] text-xs">Loading…</div>;
  return (
    <div className="space-y-5">
      {!loading && (
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border ${fresh.tone === "ok" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" : fresh.tone === "warn" ? "bg-amber-500/10 text-amber-500 border-amber-500/30" : "bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]"}`}>
          {fresh.tone === "ok" ? <span className="w-2 h-2 rounded-full bg-emerald-500 tlb-pulse" /> : fresh.tone === "warn" ? <AlertCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}{fresh.text}
        </div>
      )}
      {error && <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>}

      {!cur || !s ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-10 text-center shadow-lg">
          <Store className="w-8 h-8 mx-auto text-[var(--muted)]" />
          <p className="text-sm font-bold text-[var(--heading)] mt-3">No Keeta report has been uploaded yet</p>
          <p className="text-xs text-[var(--muted)] mt-1">The office laptop pulls Keeta's Order data report every morning after 06:00 Kuwait time, and the refund list every 6 hours.</p>
        </div>
      ) : (
        <>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 shadow-lg flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <button onClick={() => idx < reports.length - 1 && setDay(reports[idx + 1].report_day)} disabled={idx >= reports.length - 1} title="Earlier day" className="p-2 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
              <select value={day} onChange={(e) => setDay(e.target.value)} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs font-bold focus:outline-none">
                {reports.map((r) => <option key={r.report_day} value={r.report_day}>{dayLong(r.report_day)}</option>)}
              </select>
              <button onClick={() => idx > 0 && setDay(reports[idx - 1].report_day)} disabled={idx <= 0} title="Later day" className="p-2 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <span className="text-[11px] text-[var(--muted)] flex items-center gap-1.5"><Store className="w-3.5 h-3.5" /> {s.stores} stores had orders · uploaded {kwTime(cur.uploaded_at)} Kuwait · by completion date</span>
            <div className="flex-1" />
            <button onClick={load} title="Reload" className="p-2 rounded-xl border border-[var(--border)] text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface-2)]"><RefreshCw className="w-4 h-4" /></button>
            <button onClick={() => download(cur)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white shadow-lg transition active:scale-95" style={{ background: "var(--t-violet)" }}><Download className="w-4 h-4" /> Download CSV ({mb(cur.csv_bytes)})</button>
          </div>

          <div className="flex items-center gap-1 p-1 bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg w-fit flex-wrap" role="tablist">
            {([["overview", "Overview", LayoutDashboard], ["orders", `Orders · ${num(cur.order_count)}`, ListOrdered], ["refunds", "Partial refunds", Undo2], ["cancellations", `Cancellations · ${s.cancelled}`, XCircle]] as const).map(([k, label, Icon]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => { if (k === "orders") setPreset(undefined); setTab(k); }}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition ${tab === k ? "text-white shadow-md" : "text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface-2)]"}`} style={violet(tab === k)}>
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>

          {tab === "orders" && <KeetaOrders day={cur.report_day} version={cur.uploaded_at} preset={preset} refunds={refundMap} />}

          {tab === "overview" && (
            <>
              <div key={day} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <Kpi i={0} label="Orders" color="var(--t-violet)" value={tot.orders} format={num} sub={`${s.stores} stores`} delta={null} />
                <Kpi i={1} label="Gross sales (KWD)" color="var(--t-orange)" value={tot.gross} format={(f) => kwd(f, 0)} sub={`${kwd(tot.gross)} before promo & refunds`} delta={null} />
                <Kpi i={2} label="Net sales (KWD)" color="var(--t-aqua)" value={net} format={(f) => kwd(f, 0)} sub="gross − promo − refunds" delta={null} />
                <Kpi i={3} label="Refunds (KWD)" color="var(--t-rose)" value={tot.refund} format={(f) => kwd(f, 0)} sub={`${tot.refunded} orders · ${fmtPct(pct(tot.refund, tot.gross))} of gross`} delta={null} onClick={() => setTab("refunds")} />
                <Kpi i={4} label="Cancelled" color="var(--t-amber)" value={s.cancelled} format={num} sub={`${fmtPct(pct(s.cancelled, s.orders + s.cancelled))} of orders`} delta={null} onClick={() => setTab("cancellations")} />
                <Kpi i={5} label="Payout (KWD)" color="var(--t-violet)" value={tot.payout} format={(f) => kwd(f, 0)} sub={s.prep_avg_min !== null ? `avg meal prep ${s.prep_avg_min} min` : "after commission & fees"} delta={null} />
              </div>

              <div className="grid lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-lg">
                  <h3 className="text-sm font-bold text-[var(--heading)]">Orders by hour</h3>
                  <p className="text-[11px] text-[var(--muted)] mt-0.5 mb-2">When the orders completed on {dayLong(cur.report_day)} were placed (Kuwait time).</p>
                  <HourlyChart hourly={s.hourly} grown={grown} />
                </div>
                <Bars title="Cancellations" sub={`${s.cancelled} cancelled — by who and how`} groups={cancelTypes} color="var(--t-rose)" />
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg overflow-hidden">
                <div className="p-5 pb-3"><h3 className="text-sm font-bold text-[var(--heading)]">By brand</h3></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-y border-[var(--border)] bg-[var(--surface-2)]/40 whitespace-nowrap">
                      <th className="text-left py-2.5 px-4">Brand</th><th className="text-right py-2.5 px-4">Orders</th><th className="text-right py-2.5 px-4">Cancelled</th><th className="text-right py-2.5 px-4">Gross</th>
                      <th className="text-right py-2.5 px-4">Promotions</th><th className="text-right py-2.5 px-4">Refunds</th><th className="text-right py-2.5 px-4">Net sales</th><th className="text-right py-2.5 px-4">Payout</th><th className="text-right py-2.5 px-4">Stores</th>
                    </tr></thead>
                    <tbody>
                      {[...rows].sort((a, b) => (b.gross - b.promo - b.refund) - (a.gross - a.promo - a.refund)).map((b) => (
                        <tr key={b.brand} onClick={() => showOrders({ q: b.brand })} title={`Show the ${b.brand} orders`} className="border-b border-[var(--border)]/40 hover:bg-[var(--surface-2)]/30 cursor-pointer">
                          <td className="py-2.5 px-4 font-bold text-[var(--heading)] whitespace-nowrap">{b.brand}</td>
                          <td className="py-2.5 px-4 text-right font-mono">{num(b.orders)}</td><td className="py-2.5 px-4 text-right font-mono">{num(b.cancelled)}</td>
                          <td className="py-2.5 px-4 text-right font-mono">{kwd(b.gross)}</td><td className="py-2.5 px-4 text-right font-mono">{kwd(b.promo)}</td>
                          <td className="py-2.5 px-4 text-right font-mono" style={{ color: b.refund ? "var(--t-rose)" : undefined }}>{kwd(b.refund)}</td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-[var(--heading)]">{kwd(b.gross - b.promo - b.refund)}</td>
                          <td className="py-2.5 px-4 text-right font-mono">{kwd(b.payout + b.adjust)}</td>
                          <td className="py-2.5 px-4 text-right font-mono">{s.brands.find((x) => x.brand === b.brand)?.stores ?? "—"}</td>
                        </tr>
                      ))}
                      <tr className="bg-[var(--surface-2)]/50 font-bold text-[var(--heading)]">
                        <td className="py-2.5 px-4">Total</td><td className="py-2.5 px-4 text-right font-mono">{num(tot.orders)}</td><td className="py-2.5 px-4 text-right font-mono">{num(tot.cancelled)}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{kwd(tot.gross)}</td><td className="py-2.5 px-4 text-right font-mono">{kwd(tot.promo)}</td><td className="py-2.5 px-4 text-right font-mono">{kwd(tot.refund)}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{kwd(net)}</td><td className="py-2.5 px-4 text-right font-mono">{kwd(tot.payout)}</td><td className="py-2.5 px-4 text-right font-mono">{s.stores}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {tab === "refunds" && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setScope("day")} className={chip(scope === "day")} style={violet(scope === "day")}>Orders of {dayShort(day)}</button>
                <button onClick={() => setScope("all")} className={chip(scope === "all")} style={violet(scope === "all")}>All days on the system</button>
                <span className="w-px h-5 bg-[var(--border)] mx-1" />
                {([["all", "Partial + full"], ["partial", "Partial only"], ["full", "Full only"]] as const).map(([k, l]) => <button key={k} onClick={() => setKind(k)} className={chip(kind === k)} style={violet(kind === k)}>{l}</button>)}
                <span className="flex-1" />
                <button onClick={() => downloadCSV(["Order ID", "Order day", "Refunded at (Kuwait)", "Brand", "Store", "Type", "Reason", "Original (KWD)", "Refunded items (KWD)", "After refund (KWD)", "Customer got back (KWD)", "Earnings after refund (KWD)"],
                  dayRefunds.map((r) => [r.order_id, refundDay(r), kwHm(r.refunded_at), r.brand || "", r.store || "", r.partial ? "Partial" : "Full", r.reason || "", kwd(r.original), kwd(r.original - r.item_after), kwd(r.item_after), r.refund_money !== null ? kwd(r.refund_money) : "", r.payout_after !== null ? kwd(r.payout_after) : ""]), `keeta-refunds${scope === "day" ? "_" + day : ""}`)}
                  disabled={!dayRefunds.length} className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-emerald-600/20 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-600/30 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> Export</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi i={0} label="Refunded orders" color="var(--t-rose)" value={counted.length} format={num} sub={`${counted.filter((r) => r.partial).length} partial · ${counted.filter((r) => !r.partial).length} full`} delta={null} />
                <Kpi i={1} label="Items refunded (KWD)" color="var(--t-rose)" value={refundSum} format={(f) => kwd(f)} sub="original − what is left on the order" delta={null} />
                <Kpi i={2} label="Original value (KWD)" color="var(--t-violet)" value={counted.reduce((a, r) => a + r.original, 0)} format={(f) => kwd(f)} sub="of those orders" delta={null} />
                <Kpi i={3} label="Refunded share" color="var(--t-amber)" value={Math.round(pct(refundSum, counted.reduce((a, r) => a + r.original, 0)) * 10)} format={(f) => `${(f / 10).toFixed(1)}%`} sub="of their original value" delta={null} />
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                <Bars title="Refunded by reason" groups={byReason} color="var(--t-rose)" />
                <Bars title="Refunded by brand" sub="KWD of items refunded next to each count" groups={byBrand} color="var(--t-rose)" />
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg overflow-hidden">
                {!dayRefunds.length ? <div className="text-center py-10 text-xs text-[var(--muted)]">No refund for this selection.</div> : (
                  <div className="overflow-x-auto max-h-[520px]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[var(--surface)]"><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] whitespace-nowrap">
                        <th className="text-left py-2.5 px-3">Refunded (Kuwait)</th><th className="text-left py-2.5 px-3">Order ID</th><th className="text-left py-2.5 px-3">Store</th><th className="text-left py-2.5 px-3">Reason</th>
                        <th className="text-right py-2.5 px-3">Original</th><th className="text-right py-2.5 px-3">Refund</th><th className="text-right py-2.5 px-3">After</th><th className="text-right py-2.5 px-3">%</th><th className="text-left py-2.5 px-3">Type</th>
                      </tr></thead>
                      <tbody>
                        {dayRefunds.map((r) => {
                          const refunded = r.original - r.item_after;
                          const openable = !!reports.find((x) => x.report_day === refundDay(r));
                          return (
                            <tr key={r.order_id} onClick={openable ? () => { setDay(refundDay(r)); showOrders({ q: r.order_id, openId: r.order_id }); } : undefined} title={openable ? "Open the order" : "That day's report is not on the system"}
                              className={`border-b border-[var(--border)]/40 last:border-0 ${openable ? "cursor-pointer hover:bg-[var(--surface-2)]/40" : ""}`}>
                              <td className="py-2 px-3 font-mono whitespace-nowrap">{kwHm(r.refunded_at)}</td>
                              <td className="py-2 px-3 font-mono font-bold text-[var(--heading)] whitespace-nowrap">{r.order_id}</td>
                              <td className="py-2 px-3 max-w-[13rem]"><div className="font-bold text-[var(--heading)] truncate">{r.brand || "—"}</div><div className="text-[10px] text-[var(--muted)] truncate">{(r.store || "").replace(/^[^(]*\(|\)$/g, "")}</div></td>
                              <td className="py-2 px-3 max-w-[15rem] truncate" title={r.reason || ""}>{r.reason || "—"}</td>
                              <td className="py-2 px-3 text-right font-mono whitespace-nowrap">{kwd(r.original)}</td>
                              <td className="py-2 px-3 text-right font-mono whitespace-nowrap font-bold" style={{ color: "var(--t-rose)" }}>−{kwd(refunded)}</td>
                              <td className="py-2 px-3 text-right font-mono whitespace-nowrap">{kwd(r.item_after)}</td>
                              <td className="py-2 px-3 text-right font-mono whitespace-nowrap">{fmtPct(pct(refunded, r.original))}</td>
                              <td className="py-2 px-3 whitespace-nowrap"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${r.order_cancelled ? "bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]" : r.partial ? "bg-amber-500/10 text-amber-500 border-amber-500/30" : "bg-rose-500/10 text-rose-500 border-rose-500/30"}`}>{r.order_cancelled ? "On a cancelled order" : r.partial ? "Partial" : "Full"}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-[var(--muted)]">Exact amounts from Keeta's Refund orders list, pulled every 6 hours (Keeta keeps it for a limited time, so it is accumulated here). Keeta's own report already carries every refund: a same-day partial refund shows the order at its value after the refund, and a refund made on a later day is a negative row on that day — so the totals tie out with Keeta's Store data report whether or not the list has the order; the list only adds the original value and the reason. "On a cancelled order" refunds are not in the totals: a cancelled order was never counted as a sale.</p>
            </>
          )}

          {tab === "cancellations" && (
            <>
              <div className="grid lg:grid-cols-3 gap-4">
                <Bars title="Cancellations by type" sub={`${s.cancelled} on ${dayLong(cur.report_day)}`} groups={cancelTypes} color="var(--t-rose)" />
                <div className="lg:col-span-2 grid grid-cols-2 gap-3 content-start">
                  <Kpi i={0} label="Cancelled" color="var(--t-rose)" value={s.cancelled} format={num} sub={`${fmtPct(pct(s.cancelled, s.orders + s.cancelled))} of the day's orders`} delta={null} />
                  <Kpi i={1} label="Keeta compensation (KWD)" color="var(--t-aqua)" value={s.compensation_fils} format={(f) => kwd(f)} sub="paid to us on cancelled orders" delta={null} />
                  <div className="col-span-2 text-[11px] text-[var(--muted)] flex items-start gap-1.5 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]"><Ban className="w-4 h-4 shrink-0 mt-0.5" /> Orders cancelled by Keeta or by the customer after the store accepted them are compensated; the amount is each order's earnings below. An order cancelled after the day it was completed is not here: Keeta writes it as a negative "Cancelled*" row on the later day, which the totals count as a refund.</div>
                </div>
              </div>
              <KeetaOrders day={cur.report_day} version={cur.uploaded_at} preset={{ status: "cancelled", nonce: 1 }} refunds={refundMap} />
            </>
          )}
        </>
      )}
    </div>
  );
}
