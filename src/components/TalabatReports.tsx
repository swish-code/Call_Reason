import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import TalabatOrders, { type OrdersPreset } from "./TalabatOrders.tsx";
import TalabatRefunds from "./TalabatRefunds.tsx";
import { ShoppingBag, Download, ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, Clock, Store, RefreshCw, LayoutDashboard, ListOrdered, Undo2 } from "lucide-react";

// Talabat partner-portal Order report (every store, one row per order). The talabat-export tool on the office PC
// downloads it each morning after 06:00 Kuwait time and uploads it here; the server keeps the CSV and a summary of
// it (server/talabat.ts). Admins only. Money is kept in fils (1 KWD = 1000 fils) so sums never drift.

interface BrandRow { brand: string; orders: number; delivered: number; cancelled: number; complaints: number; stores: number; sales_fils: number }
interface Summary {
  orders: number; delivered: number; cancelled: number; statuses: Record<string, number>; stores: number; complaints: number;
  pro_orders: number; vendor_delivery: number; sales_fils: number; payout_fils: number; hourly: number[];
  brands: BrandRow[]; cancel_reasons: { reason: string; count: number }[]; cancel_owners: Record<string, number>;
}
interface Report { report_day: string; file_name: string; csv_bytes: number; order_count: number; summary: Summary; export_id: string | null; uploaded_at: string }

const KW_MS = 3 * 3600_000;
const kwNow = () => new Date(Date.now() + KW_MS);
const kwToday = () => kwNow().toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayShort = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const dayLong = (d: string) => `${WEEKDAYS[new Date(d + "T00:00:00Z").getUTCDay()]} ${dayShort(d)} ${d.slice(0, 4)}`;
const kwTime = (ts: string) => new Date(new Date(ts).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16);
const kwd = (f: number, dp = 3) => (f / 1000).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const num = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
const fmtPct = (v: number) => `${v.toFixed(v >= 10 || v === 0 ? 0 : 1)}%`;
const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
const avgFils = (s: { sales_fils: number; orders: number; cancelled: number }) => (s.orders - s.cancelled > 0 ? s.sales_fils / (s.orders - s.cancelled) : 0);

const STYLE = `
.tlb { --t-orange:#ff5a00; --t-orange-soft:#ffb27f; --t-aqua:#1baf7a; --t-rose:#e11d48; --t-violet:#6250d6; --t-amber:#eda100; }
.dark .tlb { --t-orange:#ff6d1f; --t-orange-soft:#9a4a1f; --t-aqua:#199e70; --t-rose:#f43f5e; --t-violet:#9085e9; --t-amber:#c98500; }
@keyframes tlb-rise { from { opacity:0; transform: translateY(6px) } to { opacity:1; transform:none } }
.tlb-rise { animation: tlb-rise .45s cubic-bezier(.2,.8,.2,1) both }
@keyframes tlb-pulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }
.tlb-pulse { animation: tlb-pulse 1.6s ease-in-out infinite }
@keyframes tlb-grow { from { transform: scaleX(0) } to { transform: none } }
.tlb-grow { transform-origin: left; animation: tlb-grow .7s cubic-bezier(.2,.8,.2,1) both }
`;

/** Counts up from the previous value to the new one, so switching days visibly moves the numbers. */
function useCountUp(target: number, ms = 650): number {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      const cur = start + (target - start) * e;
      from.current = cur;
      setV(cur);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // A background tab gets no animation frames: land on the real number anyway.
    const done = setTimeout(() => { cancelAnimationFrame(raf); from.current = target; setV(target); }, ms + 80);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
  }, [target, ms]);
  return v;
}

/** False for one frame after `key` changes, so bars can grow in from zero. */
function useGrow(key: unknown): boolean {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    setGrown(false);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    const done = setTimeout(() => setGrown(true), 120); // no frames in a background tab
    return () => { cancelAnimationFrame(id); clearTimeout(done); };
  }, [key]);
  return grown;
}

function Delta({ now, before, against, invert }: { now: number; before?: number; against?: string; invert?: boolean }) {
  if (before === undefined || !against) return <span className="text-[10px] text-[var(--muted)]">no earlier day to compare</span>;
  if (before === 0) return <span className="text-[10px] text-[var(--muted)]">vs {against}: —</span>;
  const d = ((now - before) / before) * 100;
  const good = invert ? d < 0 : d > 0;
  const flat = Math.abs(d) < 0.5;
  return (
    <span className={`text-[10px] font-bold ${flat ? "text-[var(--muted)]" : good ? "text-emerald-500" : "text-rose-500"}`}>
      {flat ? "≈" : d > 0 ? "▲" : "▼"} {Math.abs(d).toFixed(1)}% <span className="font-normal text-[var(--muted)]">vs {against}</span>
    </span>
  );
}

function Kpi({ label, color, value, format, sub, delta, i, onClick }: { label: string; color: string; value: number; format: (n: number) => string; sub?: string; delta: ReactNode; i: number; onClick?: () => void }) {
  const v = useCountUp(value);
  return (
    <div onClick={onClick} title={onClick ? "Show these orders" : undefined}
      className={`tlb-rise relative overflow-hidden bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-lg ${onClick ? "cursor-pointer transition hover:-translate-y-0.5 hover:shadow-xl" : ""}`} style={{ animationDelay: `${i * 60}ms` }}>
      <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl opacity-20" style={{ background: color }} />
      <div className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-wider text-[var(--muted)] uppercase">
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />{label}
      </div>
      <div className="text-2xl font-black text-[var(--heading)] mt-1.5 font-mono tabular-nums">{format(v)}</div>
      {sub && <div className="text-[11px] text-[var(--muted)] mt-0.5">{sub}</div>}
      <div className="mt-1.5">{delta}</div>
    </div>
  );
}

function HourlyChart({ hourly, grown }: { hourly: number[]; grown: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 230, ML = 36, MR = 8, MT = 22, MB = 26, PW = W - ML - MR, PH = H - MT - MB;
  const max = Math.max(1, ...hourly);
  const step = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => s * 4 >= max) || Math.ceil(max / 4);
  const top = step * 4;
  const band = PW / 24, bw = band * 0.68;
  const peak = hourly.indexOf(Math.max(...hourly));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Orders by hour" onMouseLeave={() => setHover(null)}>
      {[0, 1, 2, 3, 4].map((k) => {
        const y = MT + PH - (k / 4) * PH;
        return <g key={k}><line x1={ML} x2={W - MR} y1={y} y2={y} stroke="var(--border)" /><text x={ML - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)">{num(k * step)}</text></g>;
      })}
      {hourly.map((v, h) => {
        const bh = (v / top) * PH, x = ML + h * band + (band - bw) / 2, y = MT + PH - bh;
        const isPeak = h === peak && v > 0, isHover = hover === h;
        return (
          <g key={h} onMouseEnter={() => setHover(h)}>
            <rect x={ML + h * band} y={MT} width={band} height={PH + MB} fill={isHover ? "var(--border)" : "transparent"} opacity={0.5} rx={4} />
            <rect x={x} y={y} width={bw} height={Math.max(bh, v ? 1 : 0)} rx={3}
              fill={isPeak ? "var(--t-orange)" : "var(--t-orange-soft)"}
              style={{ transformBox: "fill-box", transformOrigin: "bottom", transform: grown ? "scaleY(1)" : "scaleY(0)", transition: `transform .6s cubic-bezier(.2,.8,.2,1) ${h * 18}ms` }} />
            {(isHover || isPeak) && v > 0 && <text x={x + bw / 2} y={y - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--heading)">{num(v)}</text>}
            {h % 3 === 0 && <text x={ML + h * band + band / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--muted)">{String(h).padStart(2, "0")}:00</text>}
          </g>
        );
      })}
    </svg>
  );
}

function TrendChart({ days, selected, onPick, grown }: { days: Report[]; selected: string; onPick: (d: string) => void; grown: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 200, ML = 40, MR = 8, MT = 20, MB = 26, PW = W - ML - MR, PH = H - MT - MB;
  const max = Math.max(1, ...days.map((d) => d.order_count));
  const top = Math.ceil(max / 1000) * 1000 || 1000;
  const band = PW / Math.max(days.length, 1), bw = Math.min(26, band * 0.7);
  const every = days.length <= 14 ? 1 : days.length <= 31 ? 3 : 7;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Orders per day" onMouseLeave={() => setHover(null)}>
      {[0, 1, 2, 3, 4].map((k) => {
        const y = MT + PH - (k / 4) * PH;
        return <g key={k}><line x1={ML} x2={W - MR} y1={y} y2={y} stroke="var(--border)" /><text x={ML - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)">{num((k / 4) * top)}</text></g>;
      })}
      {days.map((d, i) => {
        const bh = (d.order_count / top) * PH, x = ML + i * band + (band - bw) / 2, y = MT + PH - bh;
        const sel = d.report_day === selected, hov = hover === i;
        return (
          <g key={d.report_day} className="cursor-pointer" onClick={() => onPick(d.report_day)} onMouseEnter={() => setHover(i)}>
            <rect x={ML + i * band} y={MT} width={band} height={PH + MB} fill={sel || hov ? "var(--border)" : "transparent"} opacity={sel ? 0.7 : 0.4} rx={4} />
            <rect x={x} y={y} width={bw} height={bh} rx={3} fill={sel ? "var(--t-orange)" : "var(--t-violet)"} opacity={sel ? 1 : 0.75}
              style={{ transformBox: "fill-box", transformOrigin: "bottom", transform: grown ? "scaleY(1)" : "scaleY(0)", transition: `transform .6s cubic-bezier(.2,.8,.2,1) ${i * 14}ms` }} />
            {(sel || hov) && <text x={x + bw / 2} y={y - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--heading)">{num(d.order_count)}</text>}
            {(i % every === 0 || sel) && <text x={ML + i * band + band / 2} y={H - 8} textAnchor="middle" fontSize={10} fill={sel ? "var(--heading)" : "var(--muted)"} fontWeight={sel ? 700 : 400}>{dayShort(d.report_day)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export default function TalabatReports({ currentUser }: { currentUser: User }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState("");
  const [tab, setTab] = useState<"overview" | "orders" | "refunds">("overview");
  const [preset, setPreset] = useState<OrdersPreset | undefined>();
  const showOrders = (p: Omit<OrdersPreset, "nonce">) => { setPreset({ ...p, nonce: Date.now() }); setTab("orders"); };

  const load = useCallback(async () => {
    try {
      setLoading(true); setError("");
      const res = await apiFetch("/api/talabat-reports");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load the Talabat reports.");
      const rows: Report[] = await res.json();
      setReports(rows);
      setDay((d) => (d && rows.some((r) => r.report_day === d) ? d : rows[0]?.report_day || ""));
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const byDay = useMemo(() => new Map(reports.map((r) => [r.report_day, r])), [reports]);
  const idx = reports.findIndex((r) => r.report_day === day);
  const cur = idx >= 0 ? reports[idx] : undefined;
  const s = cur?.summary;
  // Restaurants run on a weekly rhythm, so compare with the same weekday last week; the previous day if that is missing.
  const cmp = cur ? byDay.get(addDays(cur.report_day, -7)) || byDay.get(addDays(cur.report_day, -1)) : undefined;
  const against = cmp ? `${WEEKDAYS[new Date(cmp.report_day + "T00:00:00Z").getUTCDay()]} ${dayShort(cmp.report_day)}` : undefined;
  const p = cmp?.summary;
  const grown = useGrow(day);
  const trend = useMemo(() => reports.slice(0, 30).reverse(), [reports]);

  const download = async (r: Report) => {
    setBusy(r.report_day); setError("");
    try {
      const res = await apiFetch(`/api/talabat-reports/${r.report_day}/download`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Download failed.");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = r.file_name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };

  // Is yesterday's report here? It normally lands a little after 06:00 Kuwait time.
  const yesterday = addDays(kwToday(), -1);
  const latest = reports[0];
  const fresh = latest?.report_day === yesterday
    ? { tone: "ok", text: `Up to date — yesterday's report arrived ${kwTime(latest.uploaded_at).slice(11)} Kuwait time` }
    : kwNow().getUTCHours() >= 9
      ? { tone: "warn", text: `Yesterday's report (${dayShort(yesterday)}) has not arrived yet${latest ? ` — the latest is ${dayShort(latest.report_day)}` : ""}. Check that the office PC is on and signed in to Talabat.` }
      : { tone: "wait", text: `Yesterday's report usually arrives a little after 06:00 Kuwait time${latest ? ` — the latest is ${dayShort(latest.report_day)}` : ""}.` };

  const owners: [string, number][] = s ? (Object.entries(s.cancel_owners) as [string, number][]).sort((a, b) => b[1] - a[1]) : [];
  const ownerTotal = owners.reduce((a, [, n]) => a + n, 0);
  const maxBrand = s ? Math.max(1, ...s.brands.map((b) => b.orders)) : 1;
  const ownerColors: Record<string, string> = { Customer: "var(--t-violet)", Rider: "var(--t-amber)", Vendor: "var(--t-rose)", Platform: "var(--t-aqua)" };

  return (
    <div className="tlb space-y-6 text-[var(--text)]">
      <style>{STYLE}</style>

      <div className="relative overflow-hidden bg-gradient-to-r from-[var(--surface)] via-[var(--surface-2)] to-[var(--bg)] border border-[var(--border)] p-6 rounded-3xl shadow-xl">
        <div className="absolute -top-16 -right-10 w-64 h-64 rounded-full blur-3xl opacity-25 pointer-events-none" style={{ background: "var(--t-orange)" }} />
        <span className="relative text-xs font-bold px-3 py-1 rounded-full border" style={{ color: "var(--t-orange)", borderColor: "color-mix(in srgb, var(--t-orange) 40%, transparent)", background: "color-mix(in srgb, var(--t-orange) 12%, transparent)" }}>Talabat · Admin only</span>
        <h1 className="relative text-2xl font-extrabold text-[var(--heading)] tracking-tight mt-2 flex items-center gap-2"><ShoppingBag className="w-6 h-6" style={{ color: "var(--t-orange)" }} /> Talabat Order Report</h1>
        <p className="relative text-[var(--muted)] text-sm mt-1 font-light max-w-3xl">Talabat's Order report for every store — one row per order with its timeline, payment, complaint and cancellation. It is downloaded automatically from the Talabat partner portal every morning and uploaded here; download the full file of any day below.</p>
        {!loading && (
          <div className={`relative mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border ${
            fresh.tone === "ok" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" : fresh.tone === "warn" ? "bg-amber-500/10 text-amber-500 border-amber-500/30" : "bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]"}`}>
            {fresh.tone === "ok" ? <span className="w-2 h-2 rounded-full bg-emerald-500 tlb-pulse" /> : fresh.tone === "warn" ? <AlertCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
            {fresh.text}
          </div>
        )}
      </div>

      {error && <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>}

      {loading ? (
        <div className="text-center py-16 text-[var(--muted)] text-xs">Loading…</div>
      ) : !cur || !s ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-10 text-center shadow-lg">
          <ShoppingBag className="w-8 h-8 mx-auto text-[var(--muted)]" />
          <p className="text-sm font-bold text-[var(--heading)] mt-3">No Talabat report has been uploaded yet</p>
          <p className="text-xs text-[var(--muted)] mt-1">The first one appears here after the office PC uploads it — every morning after 06:00 Kuwait time.</p>
        </div>
      ) : (
        <>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 shadow-lg flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <button onClick={() => idx < reports.length - 1 && setDay(reports[idx + 1].report_day)} disabled={idx >= reports.length - 1} title="Earlier day" className="p-2 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
              <select value={day} onChange={(e) => setDay(e.target.value)} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs font-bold focus:ring-2 focus:outline-none">
                {reports.map((r) => <option key={r.report_day} value={r.report_day}>{dayLong(r.report_day)}</option>)}
              </select>
              <button onClick={() => idx > 0 && setDay(reports[idx - 1].report_day)} disabled={idx <= 0} title="Later day" className="p-2 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <span className="text-[11px] text-[var(--muted)] flex items-center gap-1.5"><Store className="w-3.5 h-3.5" /> {s.stores} stores had orders · uploaded {kwTime(cur.uploaded_at)} Kuwait</span>
            <div className="flex-1" />
            <button onClick={load} title="Reload" className="p-2 rounded-xl border border-[var(--border)] text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface-2)]"><RefreshCw className="w-4 h-4" /></button>
            <button onClick={() => download(cur)} disabled={busy === cur.report_day} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-60 shadow-lg transition active:scale-95" style={{ background: "var(--t-orange)" }}>
              <Download className="w-4 h-4" /> {busy === cur.report_day ? "Preparing…" : `Download CSV (${mb(cur.csv_bytes)})`}
            </button>
          </div>

          <div className="flex items-center gap-1 p-1 bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg w-fit" role="tablist">
            {([["overview", "Overview", LayoutDashboard], ["orders", `Orders · ${num(s.orders)}`, ListOrdered], ["refunds", "Partial refunds", Undo2]] as const).map(([k, label, Icon]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => { if (k === "orders") setPreset(undefined); setTab(k); }}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition ${tab === k ? "text-white shadow-md" : "text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface-2)]"}`}
                style={tab === k ? { background: "var(--t-orange)" } : undefined}>
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>

          {tab === "orders" ? (
            <TalabatOrders day={cur.report_day} version={cur.uploaded_at} preset={preset} />
          ) : tab === "refunds" ? (
            <TalabatRefunds initialDay={cur.report_day} orderDays={new Set(reports.map((r) => r.report_day))}
              dayOrders={(d) => byDay.get(d)?.order_count}
              onOpenOrder={(d, id) => { setDay(d); showOrders({ q: id, openId: id }); }} />
          ) : (<>
          <div key={day} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi i={0} label="Orders" color="var(--t-orange)" value={s.orders} format={num} sub={`${s.stores} stores`} delta={<Delta now={s.orders} before={p?.orders} against={against} />} />
            <Kpi i={1} label="Delivered" color="var(--t-aqua)" value={s.delivered} format={num} sub={`${fmtPct(pct(s.delivered, s.orders))} of orders`} delta={<Delta now={s.delivered} before={p?.delivered} against={against} />} />
            <Kpi i={2} label="Cancelled" color="var(--t-rose)" value={s.cancelled} format={num} sub={`${fmtPct(pct(s.cancelled, s.orders))} cancel rate`} delta={<Delta now={s.cancelled} before={p?.cancelled} against={against} invert />} onClick={() => showOrders({ status: "cancelled" })} />
            <Kpi i={3} label="Complaints" color="var(--t-amber)" value={s.complaints} format={num} sub={`${fmtPct(pct(s.complaints, s.orders))} of orders`} delta={<Delta now={s.complaints} before={p?.complaints} against={against} invert />} onClick={() => showOrders({ complaints: true })} />
            <Kpi i={4} label="Sales (KWD)" color="var(--t-violet)" value={s.sales_fils} format={(f) => kwd(f, 0)} sub={`${kwd(s.sales_fils)} subtotal, not cancelled`} delta={<Delta now={s.sales_fils} before={p?.sales_fils} against={against} />} />
            <Kpi i={5} label="Avg order (KWD)" color="var(--t-orange-soft)" value={avgFils(s)} format={(f) => kwd(f)} sub={`Pro orders ${fmtPct(pct(s.pro_orders, s.orders))}`} delta={<Delta now={avgFils(s)} before={p ? avgFils(p) : undefined} against={against} />} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-lg">
              <h3 className="text-sm font-bold text-[var(--heading)]">Orders by hour</h3>
              <p className="text-[11px] text-[var(--muted)] mt-0.5 mb-2">When the orders came in on {dayLong(cur.report_day)} (Kuwait time) — the busiest hour is highlighted.</p>
              <HourlyChart hourly={s.hourly} grown={grown} />
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-lg">
              <h3 className="text-sm font-bold text-[var(--heading)]">Cancellations</h3>
              <p className="text-[11px] text-[var(--muted)] mt-0.5">{num(s.cancelled)} cancelled — who cancelled, and why.</p>
              {ownerTotal > 0 ? (
                <>
                  <div className="flex h-3 rounded-full overflow-hidden mt-3 bg-[var(--surface-2)]">
                    {owners.map(([o, n]) => (
                      <div key={o} title={`${o}: ${n}`} style={{ width: grown ? `${pct(n, ownerTotal)}%` : 0, background: ownerColors[o] || "var(--muted)", transition: "width .7s cubic-bezier(.2,.8,.2,1)" }} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                    {owners.map(([o, n]) => (
                      <span key={o} className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: ownerColors[o] || "var(--muted)" }} />{o} <b className="text-[var(--heading)] font-mono">{n}</b></span>
                    ))}
                  </div>
                  <div className="mt-4 space-y-2">
                    {s.cancel_reasons.map((r) => (
                      <div key={r.reason}>
                        <div className="flex justify-between text-[11px]"><span className="truncate pr-2">{r.reason}</span><span className="font-mono font-bold text-[var(--heading)]">{r.count}</span></div>
                        <div className="h-1.5 rounded-full bg-[var(--surface-2)] mt-0.5 overflow-hidden"><div className="h-full rounded-full" style={{ width: grown ? `${pct(r.count, s.cancel_reasons[0].count)}%` : 0, background: "var(--t-rose)", transition: "width .7s cubic-bezier(.2,.8,.2,1)" }} /></div>
                      </div>
                    ))}
                  </div>
                </>
              ) : <p className="text-xs text-[var(--muted)] mt-6 text-center">No cancellations this day.</p>}
            </div>
          </div>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg overflow-hidden">
            <div className="p-5 pb-3">
              <h3 className="text-sm font-bold text-[var(--heading)]">By brand</h3>
              <p className="text-[11px] text-[var(--muted)] mt-0.5">Brand comes from the store name in the report; sales are the subtotal of orders that were not cancelled.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-[var(--muted)] font-bold border-y border-[var(--border)] bg-[var(--surface-2)]/40">
                    <th className="text-left py-2.5 px-4">Brand</th><th className="text-left py-2.5 px-4 w-[34%]">Orders</th><th className="text-right py-2.5 px-4">Delivered</th>
                    <th className="text-right py-2.5 px-4">Cancelled</th><th className="text-right py-2.5 px-4">Complaints</th><th className="text-right py-2.5 px-4">Sales (KWD)</th>
                    <th className="text-right py-2.5 px-4">Avg order</th><th className="text-right py-2.5 px-4">Stores</th>
                  </tr>
                </thead>
                <tbody>
                  {s.brands.map((b, i) => {
                    const cr = pct(b.cancelled, b.orders);
                    return (
                      <tr key={b.brand} onClick={() => showOrders({ brand: b.brand })} title={`Show the ${b.brand} orders`} className="border-b border-[var(--border)]/40 hover:bg-[var(--surface-2)]/30 cursor-pointer">
                        <td className="py-2.5 px-4 font-bold text-[var(--heading)] whitespace-nowrap">{b.brand}</td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-full" style={{ width: grown ? `${pct(b.orders, maxBrand)}%` : 0, background: "var(--t-orange)", transition: `width .7s cubic-bezier(.2,.8,.2,1) ${i * 40}ms` }} /></div>
                            <span className="font-mono font-bold text-[var(--heading)] w-12 text-right">{num(b.orders)}</span>
                            <span className="text-[10px] text-[var(--muted)] w-9 text-right">{fmtPct(pct(b.orders, s.orders))}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono">{num(b.delivered)}</td>
                        <td className={`py-2.5 px-4 text-right font-mono ${cr >= 2 ? "text-rose-500 font-bold" : ""}`}>{num(b.cancelled)} <span className="text-[10px] text-[var(--muted)] font-normal">{fmtPct(cr)}</span></td>
                        <td className="py-2.5 px-4 text-right font-mono">{num(b.complaints)}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{kwd(b.sales_fils)}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{kwd(avgFils(b))}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{b.stores}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-[var(--surface-2)]/50 font-bold text-[var(--heading)]">
                    <td className="py-2.5 px-4">Total</td>
                    <td className="py-2.5 px-4"><div className="flex justify-end"><span className="font-mono w-12 text-right">{num(s.orders)}</span><span className="w-9" /></div></td>
                    <td className="py-2.5 px-4 text-right font-mono">{num(s.delivered)}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{num(s.cancelled)} <span className="text-[10px] text-[var(--muted)] font-normal">{fmtPct(pct(s.cancelled, s.orders))}</span></td>
                    <td className="py-2.5 px-4 text-right font-mono">{num(s.complaints)}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{kwd(s.sales_fils)}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{kwd(avgFils(s))}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{s.stores}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {trend.length > 1 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-lg">
              <h3 className="text-sm font-bold text-[var(--heading)]">Orders per day</h3>
              <p className="text-[11px] text-[var(--muted)] mt-0.5 mb-2">The last {trend.length} uploaded days — click a day to open it.</p>
              <TrendChart days={trend} selected={day} onPick={setDay} grown={grown} />
            </div>
          )}

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg overflow-hidden">
            <div className="p-5 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--heading)]">All reports</h3>
                <p className="text-[11px] text-[var(--muted)] mt-0.5">{reports.length} day(s) uploaded. Each file is the exact CSV Talabat produced.</p>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[var(--surface)]">
                  <tr className="text-[10px] text-[var(--muted)] font-bold border-y border-[var(--border)]">
                    <th className="text-left py-2.5 px-4">Day</th><th className="text-right py-2.5 px-4">Orders</th><th className="text-right py-2.5 px-4">Cancelled</th>
                    <th className="text-right py-2.5 px-4">Sales (KWD)</th><th className="text-right py-2.5 px-4">File</th><th className="text-left py-2.5 px-4">Uploaded (Kuwait)</th><th className="py-2.5 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.report_day} onClick={() => setDay(r.report_day)} className={`border-b border-[var(--border)]/40 last:border-0 cursor-pointer ${r.report_day === day ? "bg-[var(--surface-2)]/70" : "hover:bg-[var(--surface-2)]/30"}`}>
                      <td className="py-2.5 px-4 font-bold text-[var(--heading)] whitespace-nowrap">{r.report_day === day && <CheckCircle2 className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" style={{ color: "var(--t-orange)" }} />}{dayLong(r.report_day)}</td>
                      <td className="py-2.5 px-4 text-right font-mono">{num(r.order_count)}</td>
                      <td className="py-2.5 px-4 text-right font-mono">{num(r.summary.cancelled)} <span className="text-[10px] text-[var(--muted)]">{fmtPct(pct(r.summary.cancelled, r.summary.orders))}</span></td>
                      <td className="py-2.5 px-4 text-right font-mono">{kwd(r.summary.sales_fils)}</td>
                      <td className="py-2.5 px-4 text-right font-mono text-[var(--muted)]">{mb(r.csv_bytes)}</td>
                      <td className="py-2.5 px-4 font-mono whitespace-nowrap text-[var(--muted)]">{kwTime(r.uploaded_at)}</td>
                      <td className="py-2.5 px-4 text-right">
                        <button onClick={(e) => { e.stopPropagation(); download(r); }} disabled={busy === r.report_day} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition disabled:opacity-50" style={{ color: "var(--t-orange)", borderColor: "color-mix(in srgb, var(--t-orange) 40%, transparent)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-orange)"; e.currentTarget.style.color = "#fff"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--t-orange)"; }}>
                          <Download className="w-3.5 h-3.5" /> {busy === r.report_day ? "…" : "CSV"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </>)}
        </>
      )}
      <p className="text-[11px] text-[var(--muted)]">Signed in as {currentUser.full_name}. Only System Admins can open this page.</p>
    </div>
  );
}
