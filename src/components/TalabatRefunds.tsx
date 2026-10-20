import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import { Search, X, Download, AlertTriangle, Clock, Undo2, ArrowDown, ArrowUp, Info, Loader2, HandCoins, Crown } from "lucide-react";

// Partial refunds: each day's "Orders with deductions" from Talabat (pulled two days after the day and again
// while Talabat is still itemising), worked out on the server (server/talabat.ts → readDeductions) into every
// order's original value, the refund charged to the restaurant, and the value after it.

interface Group { key: string; orders: number; original_fils: number; refund_fils: number }
interface Row {
  id: string; store: string; brand: string; received: string; status: string; reason: string; pro: boolean;
  state: "refunded" | "pending" | "compensated";
  original_fils: number; refund_fils: number; after_fils: number; pro_fee_fils: number; compensation_fils: number;
  payout_fils: number | null; items: string;
}
interface Totals {
  orders: number; refunded: number; pending: number; compensated: number;
  original_fils: number; refund_fils: number; after_fils: number; compensation_fils: number;
  by_reason: Group[]; by_brand: Group[];
}
interface DayList { report_day: string; order_count: number; uploaded_at: string; summary: Totals }
interface DayDetail { report_day: string; uploaded_at: string; summary: Totals & { rows: Row[] } }

const KW_MS = 3 * 3600_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayLong = (d: string) => `${WEEKDAYS[new Date(d + "T00:00:00Z").getUTCDay()]} ${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const kwTime = (ts: string) => new Date(new Date(ts).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16);
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
const kwd = (f: number) => (f / 1000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
const fmtPct = (v: number) => `${v.toFixed(v >= 10 || v === 0 ? 0 : 1)}%`;

const STATE: Record<Row["state"], { label: string; cls: string }> = {
  refunded: { label: "Refunded", cls: "bg-rose-500/10 text-rose-500 border-rose-500/30" },
  pending: { label: "Waiting for Talabat", cls: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
  compensated: { label: "Compensated", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" },
};

function Card({ label, value, sub, color, i, icon: Icon }: { label: string; value: string; sub?: string; color: string; i: number; icon?: any }) {
  return (
    <div className="tlb-rise relative overflow-hidden bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-lg" style={{ animationDelay: `${i * 60}ms` }}>
      <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl opacity-20" style={{ background: color }} />
      <div className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-wider text-[var(--muted)] uppercase">
        {Icon ? <Icon className="w-3.5 h-3.5" style={{ color }} /> : <span className="w-2 h-2 rounded-full" style={{ background: color }} />}{label}
      </div>
      <div className="text-2xl font-black text-[var(--heading)] mt-1.5 font-mono tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-[var(--muted)] mt-0.5">{sub}</div>}
    </div>
  );
}

function Bars({ title, groups, total }: { title: string; groups: Group[]; total: number }) {
  const max = Math.max(1, ...groups.map((g) => g.refund_fils));
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-lg">
      <h3 className="text-sm font-bold text-[var(--heading)] mb-3">{title}</h3>
      {groups.length ? (
        <div className="space-y-2.5">
          {groups.map((g, i) => (
            <div key={g.key}>
              <div className="flex justify-between gap-3 text-[11px]">
                <span className="truncate">{g.key} <span className="text-[var(--muted)]">· {g.orders} order{g.orders === 1 ? "" : "s"}</span></span>
                <span className="font-mono font-bold text-[var(--heading)] whitespace-nowrap">{kwd(g.refund_fils)} <span className="text-[10px] text-[var(--muted)] font-normal">{fmtPct(pct(g.refund_fils, total))}</span></span>
              </div>
              <div className="h-2 rounded-full bg-[var(--surface-2)] mt-1 overflow-hidden">
                <div className="h-full rounded-full tlb-grow" style={{ width: `${pct(g.refund_fils, max)}%`, background: "var(--t-rose)", animationDelay: `${i * 50}ms` }} />
              </div>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-[var(--muted)] text-center py-6">No refunds this day.</p>}
    </div>
  );
}

type SortKey = "refund" | "original" | "share" | "time";

export default function TalabatRefunds({ initialDay, orderDays, dayOrders, onOpenOrder }: {
  initialDay: string;
  orderDays: Set<string>;
  dayOrders: (day: string) => number | undefined;
  onOpenOrder: (day: string, orderId: string) => void;
}) {
  const [list, setList] = useState<DayList[] | null>(null);
  const [day, setDay] = useState("");
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [state, setState] = useState<"all" | Row["state"]>("refunded");
  const [brand, setBrand] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "refund", desc: true });

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/talabat-reports/deductions");
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load the refunds.");
        const rows: DayList[] = await res.json();
        setList(rows);
        setDay(rows.some((r) => r.report_day === initialDay) ? initialDay : rows[0]?.report_day || "");
      } catch (e: any) { setError(e.message); setList([]); }
    })();
  }, []);

  const loadDay = useCallback(async (d: string) => {
    if (!d) return;
    setLoading(true); setError("");
    try {
      const res = await apiFetch(`/api/talabat-reports/deductions/${d}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load that day.");
      setDetail(await res.json());
    } catch (e: any) { setError(e.message); setDetail(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { loadDay(day); setQ(""); setBrand(""); }, [day, loadDay]);

  const s = detail?.summary;
  const rows = useMemo(() => {
    if (!s) return [];
    const needle = q.trim().toLowerCase();
    const r = s.rows.filter((x) => (state === "all" || x.state === state) && (!brand || x.brand === brand)
      && (!needle || `${x.id} ${x.store} ${x.reason} ${x.items}`.toLowerCase().includes(needle)));
    const val = (x: Row) => sort.key === "refund" ? x.refund_fils : sort.key === "original" ? x.original_fils : sort.key === "share" ? pct(x.refund_fils, x.original_fils) : Date.parse(x.received.replace(" ", "T")) || 0;
    return r.sort((a, b) => (sort.desc ? val(b) - val(a) : val(a) - val(b)) || a.id.localeCompare(b.id));
  }, [s, q, state, brand, sort]);
  const brands = useMemo(() => [...new Set((s?.rows || []).map((r) => r.brand))].sort(), [s]);

  if (list === null) return <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-12 shadow-lg text-center text-xs text-[var(--muted)] flex flex-col items-center gap-3"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--t-orange)" }} /> Loading the refunds…</div>;
  if (!list.length) return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-10 text-center shadow-lg">
      <Undo2 className="w-8 h-8 mx-auto text-[var(--muted)]" />
      <p className="text-sm font-bold text-[var(--heading)] mt-3">No refunds have been pulled yet</p>
      <p className="text-xs text-[var(--muted)] mt-1 max-w-md mx-auto">Talabat itemises partial refunds a day or more after the order, so each day's refunds are pulled two days later by the office PC and appear here then.</p>
    </div>
  );

  const ordersOfDay = day ? dayOrders(day) : undefined;
  const canOpen = orderDays.has(day);
  const sortBy = (key: SortKey) => setSort((x) => ({ key, desc: x.key === key ? !x.desc : true }));
  const Head = ({ k, label }: { k: SortKey; label: string }) => (
    <th className="text-right py-2.5 px-3">
      <button onClick={() => sortBy(k)} className={`inline-flex items-center gap-1 hover:text-[var(--heading)] ${sort.key === k ? "text-[var(--heading)]" : ""}`}>
        {label}{sort.key === k && (sort.desc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
      </button>
    </th>
  );
  const chip = (on: boolean) => `px-3 py-1.5 rounded-xl text-[11px] font-bold border transition ${on ? "text-white border-transparent" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)]"}`;
  const exportRows = () => downloadCSV(
    ["Order ID", "Received", "Store", "Brand", "Status", "Reason", "Pro order", "State", "Original (KWD)", "Refund (KWD)", "After refund (KWD)", "Refunded %", "Pro fee kept (KWD)", "Compensation from Talabat (KWD)", "Items"],
    rows.map((r) => [r.id, r.received, r.store, r.brand, r.status, r.reason, r.pro ? "Y" : "N", STATE[r.state].label, kwd(r.original_fils), kwd(r.refund_fils), kwd(r.after_fils), r.state === "refunded" ? fmtPct(pct(r.refund_fils, r.original_fils)) : "", kwd(r.pro_fee_fils), kwd(r.compensation_fils), r.items]),
    `talabat-partial-refunds_${day}`,
  );
  const rawDownload = async () => {
    const res = await apiFetch(`/api/talabat-reports/deductions/${day}/download`);
    if (!res.ok) { setError("Download failed."); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = `talabat-deductions_${day}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 shadow-lg flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold text-[var(--heading)] flex items-center gap-1.5"><Undo2 className="w-4 h-4" style={{ color: "var(--t-rose)" }} /> Refunds of</span>
        <select value={day} onChange={(e) => setDay(e.target.value)} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs font-bold focus:outline-none">
          {list.map((r) => <option key={r.report_day} value={r.report_day}>{dayLong(r.report_day)}</option>)}
        </select>
        {detail && <span className="text-[11px] text-[var(--muted)] flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> pulled {kwTime(detail.uploaded_at)} Kuwait</span>}
        <span className="flex-1" />
        <button onClick={rawDownload} disabled={!detail} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border border-[var(--border)] text-[var(--muted)] hover:text-[var(--heading)] disabled:opacity-50" title="The file exactly as Talabat produced it"><Download className="w-3.5 h-3.5" /> Talabat file</button>
        <button onClick={exportRows} disabled={!rows.length} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600/20 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-600/30 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> Export listed</button>
      </div>

      {error && <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {error}</div>}

      {loading || !s ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-10 shadow-lg text-center text-xs text-[var(--muted)]"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
      ) : (
        <>
          {s.pending > 0 && (
            <div className="p-3 rounded-xl text-xs border bg-amber-500/10 border-amber-500/30 text-amber-500 flex items-start gap-2">
              <Clock className="w-4 h-4 shrink-0 mt-0.5" />
              <span><b>{s.pending}</b> of this day's {s.orders} orders with deductions are not itemised by Talabat yet, so they are left out of the totals. The office PC pulls this day again every two days until {dayLong(addDays(day, 7))}; the numbers below grow as Talabat catches up.</span>
            </div>
          )}

          <div key={day} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Card i={0} label="Refunded orders" color="var(--t-rose)" value={String(s.refunded)} sub={ordersOfDay ? `${fmtPct(pct(s.refunded, ordersOfDay))} of the day's ${ordersOfDay.toLocaleString("en-US")} orders` : `${s.orders} with deductions`} icon={Undo2} />
            <Card i={1} label="Original value" color="var(--t-violet)" value={kwd(s.original_fils)} sub="KWD, before the refunds" />
            <Card i={2} label="Refunded" color="var(--t-rose)" value={kwd(s.refund_fils)} sub={`KWD · ${fmtPct(pct(s.refund_fils, s.original_fils))} of their value`} />
            <Card i={3} label="After refund" color="var(--t-aqua)" value={kwd(s.after_fils)} sub="KWD left on these orders" />
            <Card i={4} label="Compensation" color="var(--t-amber)" value={`+${kwd(s.compensation_fils)}`} sub={`KWD Talabat paid back · ${s.compensated} order${s.compensated === 1 ? "" : "s"}`} icon={HandCoins} />
            <Card i={5} label="Waiting for Talabat" color="var(--t-orange)" value={String(s.pending)} sub="not itemised yet" icon={Clock} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Bars title="Refunded by reason" groups={s.by_reason} total={s.refund_fils} />
            <Bars title="Refunded by brand" groups={s.by_brand} total={s.refund_fils} />
          </div>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg overflow-hidden">
            <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-2.5" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order ID, store, reason, item…" dir="auto"
                  className="w-full pl-9 pr-8 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:outline-none focus:ring-2" />
                {q && <button onClick={() => setQ("")} className="absolute right-2 top-2 p-0.5 text-[var(--muted)] hover:text-[var(--heading)]"><X className="w-3.5 h-3.5" /></button>}
              </div>
              <select value={brand} onChange={(e) => setBrand(e.target.value)} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs font-bold focus:outline-none">
                <option value="">All brands</option>
                {brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              {(["refunded", "pending", "compensated", "all"] as const).map((k) => (
                <button key={k} onClick={() => setState(k)} className={chip(state === k)} style={state === k ? { background: "var(--t-orange)" } : undefined}>
                  {k === "all" ? `All (${s.orders})` : `${STATE[k].label} (${k === "refunded" ? s.refunded : k === "pending" ? s.pending : s.compensated})`}
                </button>
              ))}
            </div>
            {!rows.length ? <div className="text-center py-10 text-xs text-[var(--muted)]">No order matches.</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] bg-[var(--surface-2)]/40 whitespace-nowrap">
                      <th className="text-left py-2.5 px-3"><button onClick={() => sortBy("time")} className={`inline-flex items-center gap-1 hover:text-[var(--heading)] ${sort.key === "time" ? "text-[var(--heading)]" : ""}`}>Time{sort.key === "time" && (sort.desc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}</button></th>
                      <th className="text-left py-2.5 px-3">Order ID</th>
                      <th className="text-left py-2.5 px-3">Store</th>
                      <th className="text-left py-2.5 px-3">Reason</th>
                      <Head k="original" label="Original" />
                      <Head k="refund" label="Refund" />
                      <th className="text-right py-2.5 px-3">After</th>
                      <Head k="share" label="Refunded %" />
                      <th className="text-left py-2.5 px-3">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const share = pct(r.refund_fils, r.original_fils);
                      return (
                        <tr key={r.id} onClick={canOpen ? () => onOpenOrder(day, r.id) : undefined}
                          title={canOpen ? "Open the order's full details" : "This day's full Order report is not on the system, so the order cannot be opened"}
                          className={`border-b border-[var(--border)]/40 last:border-0 ${canOpen ? "cursor-pointer hover:bg-[var(--surface-2)]/40" : ""}`}>
                          <td className="py-2 px-3 font-mono whitespace-nowrap">{r.received.slice(11, 16)}</td>
                          <td className="py-2 px-3 font-mono font-bold text-[var(--heading)] whitespace-nowrap">{r.id}</td>
                          <td className="py-2 px-3 max-w-[14rem]">
                            <div className="font-bold text-[var(--heading)] truncate flex items-center gap-1">{r.brand}{r.pro && <span title="Pro order"><Crown className="w-3 h-3 text-violet-400 shrink-0" /></span>}</div>
                            <div className="text-[10px] text-[var(--muted)] truncate">{r.store.includes(",") ? r.store.slice(r.store.indexOf(",") + 1).trim() : r.store}</div>
                          </td>
                          <td className="py-2 px-3 max-w-[16rem]">
                            <div className="truncate">{r.reason}</div>
                            <div className="text-[10px] text-[var(--muted)] truncate" title={r.items} dir="auto">{r.items}</div>
                          </td>
                          <td className="py-2 px-3 text-right font-mono whitespace-nowrap">{kwd(r.original_fils)}</td>
                          <td className="py-2 px-3 text-right font-mono whitespace-nowrap font-bold" style={{ color: r.refund_fils ? "var(--t-rose)" : undefined }}>
                            {r.refund_fils ? `−${kwd(r.refund_fils)}` : r.compensation_fils ? <span className="text-emerald-500">+{kwd(r.compensation_fils)}</span> : "—"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono whitespace-nowrap text-[var(--heading)]">{r.state === "pending" ? "—" : kwd(r.after_fils)}</td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            {r.state === "refunded" ? (
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-14 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, share)}%`, background: "var(--t-rose)" }} /></div>
                                <span className="font-mono w-9 text-right">{fmtPct(share)}</span>
                              </div>
                            ) : "—"}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATE[r.state].cls}`}>{STATE[r.state].label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {list.length > 1 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg overflow-hidden">
              <div className="p-5 pb-3"><h3 className="text-sm font-bold text-[var(--heading)]">Refunds per day</h3><p className="text-[11px] text-[var(--muted)] mt-0.5">Click a day to open it.</p></div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-[var(--muted)] font-bold border-y border-[var(--border)] whitespace-nowrap">
                      <th className="text-left py-2.5 px-4">Day</th><th className="text-right py-2.5 px-4">Refunded orders</th><th className="text-right py-2.5 px-4">Original</th>
                      <th className="text-right py-2.5 px-4">Refunded</th><th className="text-right py-2.5 px-4">%</th><th className="text-right py-2.5 px-4">Waiting</th>
                      <th className="text-right py-2.5 px-4">Compensation</th><th className="text-left py-2.5 px-4">Pulled (Kuwait)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.report_day} onClick={() => setDay(r.report_day)} className={`border-b border-[var(--border)]/40 last:border-0 cursor-pointer ${r.report_day === day ? "bg-[var(--surface-2)]/70" : "hover:bg-[var(--surface-2)]/30"}`}>
                        <td className="py-2.5 px-4 font-bold text-[var(--heading)] whitespace-nowrap">{dayLong(r.report_day)}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{r.summary.refunded}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{kwd(r.summary.original_fils)}</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold" style={{ color: "var(--t-rose)" }}>{kwd(r.summary.refund_fils)}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{fmtPct(pct(r.summary.refund_fils, r.summary.original_fils))}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{r.summary.pending || "—"}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-emerald-500">{r.summary.compensation_fils ? `+${kwd(r.summary.compensation_fils)}` : "—"}</td>
                        <td className="py-2.5 px-4 font-mono text-[var(--muted)] whitespace-nowrap">{kwTime(r.uploaded_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-[11px] text-[var(--muted)] flex items-start gap-1.5 max-w-4xl">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Talabat's report has no refund column. Once Talabat has charged an order, its subtotal is the original value and the refund charged to the restaurant is inside "Operational charges", next to the 0.30 KWD Pro fee a Pro order keeps when it is still worth 3 KWD or more after the refund. Refund = operational charges − that Pro fee. Checked against Talabat's own before/after values on 24 orders: 23 matched, one Pro order was off by 0.30. "Compensation" is the opposite direction: money Talabat paid the restaurant back.</span>
          </p>
        </>
      )}
    </div>
  );
}
