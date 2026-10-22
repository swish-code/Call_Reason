import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import { AlertCircle, Download, Info, Layers, Percent, ReceiptText, ShoppingBag, Tag, TrendingUp, Undo2, XCircle } from "lucide-react";
import { addDays, dayLong, dayShort, kwd, num, pct, fmtPct, useCountUp, useGrow } from "./TalabatReports.tsx";

// Net sales of the company across the delivery platforms (Talabat + Keeta), from platform_orders / platform_refunds
// (server: DB.platformDaily). Three numbers, side by side:
//   Gross sales  = the value of the items ordered (cancelled orders excluded), before promotions and refunds;
//   Net sales    = gross − promotions we fund − refunds to customers;
//   Payout       = what the platforms actually pay us: net − commission & fees (+ compensation / commission taken back
//                  on cancelled orders). Only orders whose payout the platform has already worked out are in it —
//                  Talabat does that ~4 days after the order (41% the morning after, 99% at day 4) — so the card says
//                  how much of the period is covered instead of showing a half-finished number as if it were final.

type Plat = "talabat" | "keeta";
interface Row { platform: Plat; day: string; brand: string; orders: number; cancelled: number; gross: number; promo: number; refund: number; refunded_orders: number; payout: number; payout_orders: number; net_known: number; adjust: number }
interface Agg { orders: number; cancelled: number; gross: number; promo: number; refund: number; refunded_orders: number; payout: number; payout_orders: number; net_known: number; adjust: number }

const PLATS: { key: Plat; label: string; color: string }[] = [
  { key: "talabat", label: "Talabat", color: "var(--t-orange)" },
  { key: "keeta", label: "Keeta", color: "var(--t-violet)" },
];
const COVERED = 0.95; // payout is shown as final only when at least this share of the orders has one

const zero = (): Agg => ({ orders: 0, cancelled: 0, gross: 0, promo: 0, refund: 0, refunded_orders: 0, payout: 0, payout_orders: 0, net_known: 0, adjust: 0 });
const add = (a: Agg, r: Agg): Agg => ({
  orders: a.orders + r.orders, cancelled: a.cancelled + r.cancelled, gross: a.gross + r.gross, promo: a.promo + r.promo, refund: a.refund + r.refund,
  refunded_orders: a.refunded_orders + r.refunded_orders, payout: a.payout + r.payout, payout_orders: a.payout_orders + r.payout_orders, net_known: a.net_known + r.net_known, adjust: a.adjust + r.adjust,
});
const sumRows = (rows: Row[]) => rows.reduce(add, zero());
const netOf = (a: Agg) => a.gross - a.promo - a.refund;
const coverage = (a: Agg) => (a.orders > 0 ? a.payout_orders / a.orders : 1);
const payoutOf = (a: Agg) => a.payout + a.adjust;
const final = (a: Agg) => coverage(a) >= COVERED;
// Commission & fees as a share of net sales, measured on exactly the orders whose payout the platform has worked out.
const feeRate = (a: Agg) => (a.net_known > 0 ? ((a.net_known - a.payout) / a.net_known) * 100 : null);

function Hero({ label, hint, color, value, sub, i, split }: { label: string; hint: string; color: string; value: number; sub?: string; i: number; split: { name: string; color: string; v: number }[] }) {
  const v = useCountUp(value, 800);
  const total = split.reduce((a, s) => a + Math.max(0, s.v), 0);
  return (
    <div className="tlb-rise relative overflow-hidden bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-5 shadow-xl" style={{ animationDelay: `${i * 80}ms` }}>
      <div className="absolute -top-14 -right-14 w-44 h-44 rounded-full blur-3xl opacity-25 pointer-events-none" style={{ background: color }} />
      <div className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-wider text-[var(--muted)] uppercase"><span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />{label}</div>
      <div className="text-3xl md:text-4xl font-black text-[var(--heading)] mt-2 font-mono tabular-nums">{kwd(v, 0)} <span className="text-sm font-bold text-[var(--muted)]">KWD</span></div>
      <div className="text-[11px] text-[var(--muted)] mt-1">{hint}</div>
      {sub && <div className="text-[11px] mt-1 font-bold text-amber-500">{sub}</div>}
      <div className="flex h-2 rounded-full overflow-hidden mt-4 bg-[var(--surface-2)]">
        {split.map((s) => <div key={s.name} title={`${s.name}: ${kwd(s.v)} KWD`} style={{ width: `${pct(Math.max(0, s.v), total)}%`, background: s.color, transition: "width .7s cubic-bezier(.2,.8,.2,1)" }} />)}
      </div>
      <div className="flex gap-4 mt-2 text-[11px]">
        {split.map((s) => <span key={s.name} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />{s.name} <b className="text-[var(--heading)] font-mono">{kwd(s.v, 0)}</b></span>)}
      </div>
    </div>
  );
}

function Step({ label, value, of, color, sign, note }: { label: string; value: number; of: number; color: string; sign?: "−" | "="; note?: string }) {
  const w = of > 0 ? Math.min(100, (Math.abs(value) / of) * 100) : 0;
  return (
    <div className="grid grid-cols-[9.5rem_1fr_7.5rem] items-center gap-3 text-xs">
      <div className="text-[var(--text)] font-bold">{sign === "−" ? "− " : ""}{label}{note && <div className="text-[10px] font-normal text-[var(--muted)]">{note}</div>}</div>
      <div className="h-5 rounded-lg bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-lg tlb-grow" style={{ width: `${w}%`, background: color }} /></div>
      <div className="text-right font-mono font-bold text-[var(--heading)]">{sign === "−" ? "−" : ""}{kwd(Math.abs(value))}</div>
    </div>
  );
}

/** Net sales per day (or per week for a long range), one bar per platform. */
function Trend({ buckets, grown }: { buckets: { label: string; at: string; v: Record<Plat, number> }[]; grown: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 220, ML = 46, MR = 8, MT = 22, MB = 26, PW = W - ML - MR, PH = H - MT - MB;
  const max = Math.max(1, ...buckets.flatMap((b) => [b.v.talabat, b.v.keeta]));
  const mag = Math.pow(10, Math.floor(Math.log10(max / 4)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s * 4 >= max) || max / 4;
  const top = step * 4;
  const band = PW / Math.max(buckets.length, 1), bw = Math.min(18, (band * 0.8) / 2);
  const every = buckets.length <= 14 ? 1 : buckets.length <= 31 ? 3 : 7;
  const k = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}K` : String(Math.round(v)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Net sales per day" onMouseLeave={() => setHover(null)}>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = MT + PH - (i / 4) * PH;
        return <g key={i}><line x1={ML} x2={W - MR} y1={y} y2={y} stroke="var(--border)" /><text x={ML - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)">{k((i * step) / 1000)}</text></g>;
      })}
      {buckets.map((b, i) => {
        const x0 = ML + i * band + (band - (bw * 2 + 2)) / 2;
        return (
          <g key={b.at} onMouseEnter={() => setHover(i)}>
            <rect x={ML + i * band} y={MT} width={band} height={PH + MB} fill={hover === i ? "var(--border)" : "transparent"} opacity={0.5} rx={4} />
            {PLATS.map((p, j) => {
              const h = (b.v[p.key] / top) * PH;
              return <rect key={p.key} x={x0 + j * (bw + 2)} y={MT + PH - h} width={bw} height={Math.max(h, b.v[p.key] ? 1 : 0)} rx={3} fill={p.color}
                style={{ transformBox: "fill-box", transformOrigin: "bottom", transform: grown ? "scaleY(1)" : "scaleY(0)", transition: `transform .6s cubic-bezier(.2,.8,.2,1) ${i * 16}ms` }} />;
            })}
            {(i % every === 0 || hover === i) && <text x={ML + i * band + band / 2} y={H - 8} textAnchor="middle" fontSize={10} fill={hover === i ? "var(--heading)" : "var(--muted)"}>{b.label}</text>}
          </g>
        );
      })}
      {hover !== null && buckets[hover] && (
        <g>
          <rect x={Math.min(Math.max(ML + hover * band + band / 2 - 70, ML), W - MR - 140)} y={2} width={140} height={34} rx={8} fill="var(--surface)" stroke="var(--border)" />
          {PLATS.map((p, j) => <text key={p.key} x={Math.min(Math.max(ML + hover * band + band / 2 - 70, ML), W - MR - 140) + 8} y={15 + j * 13} fontSize={10} fill="var(--heading)" fontWeight={700}>{p.label}: {kwd(buckets[hover].v[p.key], 0)}</text>)}
        </g>
      )}
    </svg>
  );
}

export default function NetSales() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [plat, setPlat] = useState<"all" | Plat>("all");

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/platforms/daily");
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load the platform numbers.");
        const data: Row[] = await res.json();
        setRows(data);
        const days = [...new Set(data.map((r) => r.day))].sort();
        if (days.length) { setTo(days[days.length - 1]); setFrom(addDays(days[days.length - 1], -6) < days[0] ? days[0] : addDays(days[days.length - 1], -6)); }
      } catch (e: any) { setError(e.message); setRows([]); }
    })();
  }, []);

  const days = useMemo(() => [...new Set((rows || []).map((r) => r.day))].sort(), [rows]);
  const firstDay = days[0] || "", lastDay = days[days.length - 1] || "";
  const inRange = useMemo(() => (rows || []).filter((r) => r.day >= from && r.day <= to), [rows, from, to]);
  const scope = useMemo(() => inRange.filter((r) => plat === "all" || r.platform === plat), [inRange, plat]);
  const grown = useGrow(`${from}|${to}|${plat}`);

  const preset = (n: number | "month" | "all") => {
    if (!lastDay) return;
    if (n === "all") { setFrom(firstDay); setTo(lastDay); return; }
    if (n === "month") { setFrom(lastDay.slice(0, 8) + "01" < firstDay ? firstDay : lastDay.slice(0, 8) + "01"); setTo(lastDay); return; }
    const f = addDays(lastDay, -(n - 1));
    setFrom(f < firstDay ? firstDay : f); setTo(lastDay);
  };
  const isPreset = (n: number | "month" | "all") => {
    if (!lastDay || to !== lastDay) return false;
    if (n === "all") return from === firstDay;
    if (n === "month") return from === (lastDay.slice(0, 8) + "01" < firstDay ? firstDay : lastDay.slice(0, 8) + "01");
    return from === (addDays(lastDay, -(n - 1)) < firstDay ? firstDay : addDays(lastDay, -(n - 1)));
  };

  const total = useMemo(() => sumRows(scope), [scope]);
  const byPlat = useMemo(() => Object.fromEntries(PLATS.map((p) => [p.key, sumRows(inRange.filter((r) => r.platform === p.key))])) as Record<Plat, Agg>, [inRange]);
  const net = netOf(total), payout = payoutOf(total);
  const cover = coverage(total);

  const brands = useMemo(() => {
    const m = new Map<string, Agg>();
    for (const r of scope) m.set(r.brand, add(m.get(r.brand) || zero(), r));
    return [...m.entries()].map(([brand, a]) => ({ brand, a })).sort((x, y) => netOf(y.a) - netOf(x.a));
  }, [scope]);
  const maxBrandNet = Math.max(1, ...brands.map((b) => netOf(b.a)));

  // Net sales trend: per day, per week when the range is long.
  const buckets = useMemo(() => {
    const span = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 : 0;
    const weekly = span > 45;
    const key = (d: string) => (weekly ? addDays(d, -new Date(d + "T00:00:00Z").getUTCDay()) : d);
    const m = new Map<string, Record<Plat, number>>();
    for (const r of inRange) {
      if (plat !== "all" && r.platform !== plat) continue;
      const k = key(r.day);
      const v = m.get(k) || { talabat: 0, keeta: 0 };
      v[r.platform] += r.gross - r.promo - r.refund;
      m.set(k, v);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([at, v]) => ({ at, label: dayShort(at), v }));
  }, [inRange, plat, from, to]);

  const exportCsv = () => downloadCSV(
    ["Day", "Platform", "Brand", "Orders", "Cancelled", "Gross (KWD)", "Promotions (KWD)", "Refunds (KWD)", "Net sales (KWD)", "Payout (KWD)", "Orders with payout known", "Cancelled-order adjustments (KWD)"],
    scope.map((r) => [r.day, r.platform, r.brand, String(r.orders), String(r.cancelled), kwd(r.gross), kwd(r.promo), kwd(r.refund), kwd(r.gross - r.promo - r.refund), kwd(r.payout), String(r.payout_orders), kwd(r.adjust)]),
    `net-sales_${from}_${to}${plat === "all" ? "" : "_" + plat}`,
  );
  const chip = (on: boolean) => `px-3 py-1.5 rounded-xl text-[11px] font-bold border transition ${on ? "text-white border-transparent" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)]"}`;
  const onStyle = (on: boolean) => (on ? { background: "var(--t-orange)" } : undefined);
  const dateCls = "px-2.5 py-1.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-[11px] font-bold focus:outline-none";

  if (rows === null) return <div className="text-center py-16 text-[var(--muted)] text-xs">Loading…</div>;
  if (error) return <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>;
  if (!rows.length) return <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-10 text-center shadow-lg text-sm text-[var(--muted)]">No platform orders on the system yet.</div>;

  const split = (f: (a: Agg) => number) => PLATS.map((p) => ({ name: p.label, color: p.color, v: f(byPlat[p.key]) }));
  const known = (a: Agg) => (final(a) ? "" : `${Math.round(coverage(a) * 100)}% of orders`);

  return (
    <div className="space-y-5">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 shadow-lg flex flex-wrap items-center gap-2">
        {([[7, "Last 7 days"], [14, "Last 14 days"], ["month", "This month"], ["all", "All"]] as const).map(([n, l]) => (
          <button key={String(n)} onClick={() => preset(n)} className={chip(isPreset(n))} style={onStyle(isPreset(n))}>{l}</button>
        ))}
        <span className="w-px h-5 bg-[var(--border)] mx-1" />
        <input type="date" value={from} min={firstDay} max={to} onChange={(e) => setFrom(e.target.value)} className={dateCls} />
        <span className="text-[11px] text-[var(--muted)]">→</span>
        <input type="date" value={to} min={from} max={lastDay} onChange={(e) => setTo(e.target.value)} className={dateCls} />
        <span className="flex-1" />
        {(["all", "talabat", "keeta"] as const).map((k) => (
          <button key={k} onClick={() => setPlat(k)} className={chip(plat === k)} style={onStyle(plat === k)}>{k === "all" ? "Both platforms" : k === "talabat" ? "Talabat" : "Keeta"}</button>
        ))}
        <button onClick={exportCsv} disabled={!scope.length} className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-emerald-600/20 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-600/30 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> Export</button>
      </div>

      <div className="text-[11px] text-[var(--muted)] -mt-2 px-1">{dayLong(from)} → {dayLong(to)} · {num(total.orders)} orders · data on the system from {dayShort(firstDay)} to {dayShort(lastDay)}</div>

      <div className="grid md:grid-cols-3 gap-4" key={`${from}${to}${plat}`}>
        <Hero i={0} label="Gross sales" color="var(--t-orange)" value={total.gross} hint="Items ordered, before promotions and refunds" split={split((a) => a.gross)} />
        <Hero i={1} label="Net sales" color="var(--t-aqua)" value={net} hint="Gross − promotions we fund − refunds" split={split(netOf)} />
        <Hero i={2} label="Payout to the company" color="var(--t-violet)" value={payout} hint="After commission & fees (+ compensation on cancelled orders)"
          sub={final(total) ? undefined : `Known for ${Math.round(cover * 100)}% of orders — the rest is still being worked out`} split={split(payoutOf)} />
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-lg space-y-3">
          <h3 className="text-sm font-bold text-[var(--heading)] flex items-center gap-2"><Layers className="w-4 h-4" style={{ color: "var(--t-orange)" }} /> From gross to payout</h3>
          <Step label="Gross sales" value={total.gross} of={total.gross} color="var(--t-orange)" />
          <Step label="Promotions" sign="−" value={total.promo} of={total.gross} color="var(--t-amber)" note="funded by the company" />
          <Step label="Refunds" sign="−" value={total.refund} of={total.gross} color="var(--t-rose)" note={`${num(total.refunded_orders)} orders`} />
          <Step label="Net sales" sign="=" value={net} of={total.gross} color="var(--t-aqua)" />
          {final(total) ? (
            <>
              <Step label="Commission & fees" sign="−" value={net - total.payout} of={total.gross} color="var(--muted)" note={`${fmtPct(pct(net - total.payout, net))} of net`} />
              <Step label="Payout" sign="=" value={payout} of={total.gross} color="var(--t-violet)" note={total.adjust ? `incl. ${kwd(total.adjust)} on cancelled orders` : undefined} />
            </>
          ) : (
            <div className="text-[11px] text-amber-500 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>The platforms have not finished working out their commission for the most recent days ({Math.round(cover * 100)}% of the orders have it), so the payout is not final.
                {feeRate(total) !== null && <> On the orders that do, commission & fees are <b className="font-mono">{fmtPct(feeRate(total) as number)}</b> of net sales.</>} Pick an earlier range for final numbers.</span>
            </div>
          )}
        </div>
        <div className="lg:col-span-3 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--heading)] flex items-center gap-2"><TrendingUp className="w-4 h-4" style={{ color: "var(--t-aqua)" }} /> Net sales per {buckets.length && (Date.parse(to) - Date.parse(from)) / 86400000 + 1 > 45 ? "week" : "day"}</h3>
            <div className="flex gap-3 text-[11px]">{PLATS.map((p) => <span key={p.key} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />{p.label}</span>)}</div>
          </div>
          <div className="mt-2">{buckets.length ? <Trend buckets={buckets} grown={grown} /> : <p className="text-xs text-[var(--muted)] text-center py-10">No orders in this range.</p>}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { l: "Orders", v: num(total.orders), s: `${num(total.cancelled)} cancelled (${fmtPct(pct(total.cancelled, total.orders + total.cancelled))})`, i: ShoppingBag, c: "var(--t-orange)" },
          { l: "Net per order", v: kwd(total.orders ? net / total.orders : 0), s: "KWD", i: ReceiptText, c: "var(--t-aqua)" },
          { l: "Refunds", v: kwd(total.refund, 0), s: `${fmtPct(pct(total.refund, total.gross))} of gross · ${num(total.refunded_orders)} orders`, i: Undo2, c: "var(--t-rose)" },
          { l: "Promotions", v: kwd(total.promo, 0), s: `${fmtPct(pct(total.promo, total.gross))} of gross`, i: Tag, c: "var(--t-amber)" },
          { l: "Commission & fees", v: final(total) ? kwd(net - total.payout, 0) : feeRate(total) !== null ? fmtPct(feeRate(total) as number) : "—", s: final(total) ? `${fmtPct(pct(net - total.payout, net))} of net` : `of net · measured on ${Math.round(cover * 100)}% of orders`, i: Percent, c: "var(--muted)" },
          { l: "Cancelled orders", v: num(total.cancelled), s: total.adjust ? `adjustments ${kwd(total.adjust)} KWD` : "no adjustments", i: XCircle, c: "var(--t-rose)" },
        ].map((x, i) => (
          <div key={x.l} className="tlb-rise bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-lg" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-wider text-[var(--muted)] uppercase"><x.i className="w-3.5 h-3.5" style={{ color: x.c }} />{x.l}</div>
            <div className="text-xl font-black text-[var(--heading)] mt-1.5 font-mono tabular-nums">{x.v}</div>
            <div className="text-[11px] text-[var(--muted)] mt-0.5">{x.s}</div>
          </div>
        ))}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg overflow-hidden">
        <div className="p-5 pb-3"><h3 className="text-sm font-bold text-[var(--heading)]">By platform</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-y border-[var(--border)] bg-[var(--surface-2)]/40 whitespace-nowrap">
              <th className="text-left py-2.5 px-4">Platform</th><th className="text-right py-2.5 px-4">Orders</th><th className="text-right py-2.5 px-4">Gross</th><th className="text-right py-2.5 px-4">Promotions</th>
              <th className="text-right py-2.5 px-4">Refunds</th><th className="text-right py-2.5 px-4">Net sales</th><th className="text-right py-2.5 px-4">Payout</th><th className="text-right py-2.5 px-4">Fees %</th><th className="text-right py-2.5 px-4">Net / order</th>
            </tr></thead>
            <tbody>
              {PLATS.map((p) => {
                const a = byPlat[p.key], n = netOf(a);
                return (
                  <tr key={p.key} className="border-b border-[var(--border)]/40">
                    <td className="py-2.5 px-4 font-bold text-[var(--heading)]"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-2" style={{ background: p.color }} />{p.label}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{num(a.orders)}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{kwd(a.gross)}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{kwd(a.promo)}</td>
                    <td className="py-2.5 px-4 text-right font-mono" style={{ color: a.refund ? "var(--t-rose)" : undefined }}>{kwd(a.refund)}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-[var(--heading)]">{kwd(n)}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{final(a) ? kwd(payoutOf(a)) : <span className="text-amber-500" title="The platform has not finished working out its commission for these days">{kwd(payoutOf(a))}*</span>}</td>
                    <td className="py-2.5 px-4 text-right font-mono" title={final(a) ? undefined : `Measured on the ${Math.round(coverage(a) * 100)}% of orders that have a payout`}>{final(a) ? fmtPct(pct(n - a.payout, n)) : feeRate(a) !== null ? `${fmtPct(feeRate(a) as number)}*` : "—"}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{kwd(a.orders ? n / a.orders : 0)}</td>
                  </tr>
                );
              })}
              <tr className="bg-[var(--surface-2)]/50 font-bold text-[var(--heading)]">
                {(() => { const a = sumRows(inRange); return (<>
                  <td className="py-2.5 px-4">Both</td><td className="py-2.5 px-4 text-right font-mono">{num(a.orders)}</td><td className="py-2.5 px-4 text-right font-mono">{kwd(a.gross)}</td>
                  <td className="py-2.5 px-4 text-right font-mono">{kwd(a.promo)}</td><td className="py-2.5 px-4 text-right font-mono">{kwd(a.refund)}</td><td className="py-2.5 px-4 text-right font-mono">{kwd(netOf(a))}</td>
                  <td className="py-2.5 px-4 text-right font-mono">{kwd(payoutOf(a))}{final(a) ? "" : "*"}</td><td className="py-2.5 px-4 text-right font-mono">{final(a) ? fmtPct(pct(netOf(a) - a.payout, netOf(a))) : feeRate(a) !== null ? `${fmtPct(feeRate(a) as number)}*` : "—"}</td>
                  <td className="py-2.5 px-4 text-right font-mono">{kwd(a.orders ? netOf(a) / a.orders : 0)}</td></>); })()}
              </tr>
            </tbody>
          </table>
        </div>
        {!final(sumRows(inRange)) && <p className="px-5 py-3 text-[10px] text-amber-500">* Payout is only the part the platform has already worked out ({known(sumRows(inRange))}), so it is not final yet; the fee % is measured on those orders. Talabat completes its commission about 4 days after the order.</p>}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg overflow-hidden">
        <div className="p-5 pb-3"><h3 className="text-sm font-bold text-[var(--heading)]">By brand</h3><p className="text-[11px] text-[var(--muted)] mt-0.5">{plat === "all" ? "Both platforms together." : plat === "talabat" ? "Talabat only." : "Keeta only."}</p></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-y border-[var(--border)] bg-[var(--surface-2)]/40 whitespace-nowrap">
              <th className="text-left py-2.5 px-4">Brand</th><th className="text-left py-2.5 px-4 w-[26%]">Net sales</th><th className="text-right py-2.5 px-4">Orders</th><th className="text-right py-2.5 px-4">Gross</th>
              <th className="text-right py-2.5 px-4">Promotions</th><th className="text-right py-2.5 px-4">Refunds</th><th className="text-right py-2.5 px-4">Payout</th><th className="text-right py-2.5 px-4">Net / order</th>
            </tr></thead>
            <tbody>
              {brands.map(({ brand, a }, i) => (
                <tr key={brand} className="border-b border-[var(--border)]/40 hover:bg-[var(--surface-2)]/30">
                  <td className="py-2.5 px-4 font-bold text-[var(--heading)] whitespace-nowrap">{brand}</td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-full" style={{ width: grown ? `${pct(netOf(a), maxBrandNet)}%` : 0, background: "var(--t-aqua)", transition: `width .7s cubic-bezier(.2,.8,.2,1) ${i * 40}ms` }} /></div>
                      <span className="font-mono font-bold text-[var(--heading)] w-24 text-right">{kwd(netOf(a))}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono">{num(a.orders)}</td>
                  <td className="py-2.5 px-4 text-right font-mono">{kwd(a.gross)}</td>
                  <td className="py-2.5 px-4 text-right font-mono">{kwd(a.promo)}</td>
                  <td className="py-2.5 px-4 text-right font-mono" style={{ color: a.refund ? "var(--t-rose)" : undefined }}>{kwd(a.refund)}</td>
                  <td className="py-2.5 px-4 text-right font-mono">{kwd(payoutOf(a))}{final(a) ? "" : "*"}</td>
                  <td className="py-2.5 px-4 text-right font-mono">{kwd(a.orders ? netOf(a) / a.orders : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-[var(--muted)] flex items-start gap-1.5 max-w-4xl">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>Each platform's day is the day its own report uses (Talabat: the day the order was placed; Keeta: the day it was completed). Refunds are restated on the day of the order they belong to, so a day's net sales can still change as refunds arrive. Talabat refunds come from its "Orders with deductions" report (the ones Talabat has not itemised yet are not in the numbers). Keeta only keeps its refund list for 48 hours, so exact Keeta refunds are on the system from 20 Oct on; before that, Keeta's daily report already shows a partly refunded order at its value after the refund, so net sales is right but the Refunds line reads zero.</span>
      </p>
    </div>
  );
}
