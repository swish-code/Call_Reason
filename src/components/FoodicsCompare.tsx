import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import { AlertCircle, CheckCircle2, Download, Info, ShoppingBag, Store } from "lucide-react";
import { dayShort, kwd, num, pct, fmtPct } from "./TalabatReports.tsx";

// Platforms vs POS: every Talabat / Keeta order that reached Foodics (the POS), matched order by order on the platform's
// own order id (GrubTech writes it into the Foodics order notes). Server: /api/foodics/compare (DB.foodicsMatch).
//   Matched       = the order is on the platform AND in Foodics;
//   Not in Foodics = the platform delivered it but the POS has no closed order with that id (lost between GrubTech and the POS);
//   Not on platform = Foodics has it but the platform report does not (a day-boundary effect, a cancelled order, or a wrong id).
// The first day's unmatched platform orders and the last day's unmatched Foodics orders are not judged: their early /
// late hours belong to the neighbouring Foodics business day (Foodics' day runs 06:00 to 06:00).

type Plat = "talabat" | "keeta";
interface Group { key: string; brand: string; platform_orders: number; platform_gross: number; foodics_orders: number; foodics_subtotal: number; foodics_discount: number; matched: number; matched_platform_gross: number; matched_foodics_subtotal: number; matched_payout: number; only_platform: number; only_platform_gross: number; only_foodics: number; only_foodics_subtotal: number; price_diff_orders: number; price_diff_total: number }
interface Lists { only_platform: any[]; only_foodics: any[]; price: any[] }
interface Compare { from: string; to: string; platforms: Record<Plat, { brands: Group[]; lists: Lists }>; daily: any[] }
interface Pull { brand: string; from_day: string; to_day: string; rows: number; branches: number; pulled_at: string }

const PLATS: { key: Plat; label: string; color: string; icon: any }[] = [
  { key: "talabat", label: "Talabat", color: "var(--t-orange)", icon: ShoppingBag },
  { key: "keeta", label: "Keeta", color: "var(--t-violet)", icon: Store },
];
type ListKey = keyof Lists;
const LISTS: { key: ListKey; label: string }[] = [
  { key: "only_platform", label: "Not in Foodics" },
  { key: "only_foodics", label: "Not on the platform" },
  { key: "price", label: "Price differs" },
];

const sum = (gs: Group[], f: (g: Group) => number) => gs.reduce((a, g) => a + f(g), 0);

export default function FoodicsCompare() {
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [cmp, setCmp] = useState<Compare | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [plat, setPlat] = useState<Plat>("talabat");
  const [list, setList] = useState<ListKey>("only_platform");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/foodics/pulls");
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load the Foodics pulls.");
        const p: Pull[] = await res.json();
        setPulls(p);
        if (p.length) { setFrom(p.map((x) => x.from_day).sort()[0]); setTo(p.map((x) => x.to_day).sort().slice(-1)[0]); }
        else setBusy(false);
      } catch (e: any) { setErr(e.message); setBusy(false); }
    })();
  }, []);

  useEffect(() => {
    if (!from || !to || from > to) return;
    let dead = false;
    setBusy(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/foodics/compare?from=${from}&to=${to}`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not compare.");
        const j: Compare = await res.json();
        if (!dead) { setCmp(j); setErr(""); }
      } catch (e: any) { if (!dead) setErr(e.message); } finally { if (!dead) setBusy(false); }
    })();
    return () => { dead = true; };
  }, [from, to]);

  const cur = cmp?.platforms[plat];
  const brands = cur?.brands || [];
  const t = useMemo(() => ({
    platform: sum(brands, (g) => g.platform_orders), foodics: sum(brands, (g) => g.foodics_orders), matched: sum(brands, (g) => g.matched),
    onlyP: sum(brands, (g) => g.only_platform), onlyPv: sum(brands, (g) => g.only_platform_gross), onlyF: sum(brands, (g) => g.only_foodics), onlyFv: sum(brands, (g) => g.only_foodics_subtotal),
    mp: sum(brands, (g) => g.matched_platform_gross), mf: sum(brands, (g) => g.matched_foodics_subtotal), priceN: sum(brands, (g) => g.price_diff_orders), priceV: sum(brands, (g) => g.price_diff_total),
    pg: sum(brands, (g) => g.platform_gross), fs: sum(brands, (g) => g.foodics_subtotal),
  }), [brands]);

  const exportList = () => {
    const rows = cur?.lists[list] || [];
    if (list === "only_platform") downloadCSV(["Order ID", "Brand", "Store", "Day", "Platform value (KWD)"], rows.map((r) => [r.id, r.brand, r.store, r.day, kwd(r.platform)]), `foodics_${plat}_not-in-foodics_${from}_${to}`);
    else if (list === "only_foodics") downloadCSV(["Order ID", "Brand", "Branch", "Foodics day", "Opened", "Foodics subtotal (KWD)"], rows.map((r) => [r.id, r.brand, r.branch, r.day, r.opened, kwd(r.foodics)]), `foodics_${plat}_not-on-platform_${from}_${to}`);
    else downloadCSV(["Order ID", "Brand", "Branch", "Day", "Platform (KWD)", "Foodics (KWD)", "Difference (KWD)"], rows.map((r) => [r.id, r.brand, r.branch, r.day, kwd(r.platform), kwd(r.foodics), kwd(r.diff)]), `foodics_${plat}_price-differs_${from}_${to}`);
  };

  const card = "bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-xl";
  const input = "px-3 py-1.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--heading)]";
  const th = "text-right py-2.5 px-3";

  return (
    <div className="space-y-5">
      <div className={`${card} p-5 flex flex-wrap items-center gap-3`}>
        <div className="flex-1 min-w-[14rem]">
          <h2 className="text-lg font-extrabold text-[var(--heading)]">Platforms vs POS (Foodics)</h2>
          <p className="text-[11px] text-[var(--muted)] mt-0.5">Every Talabat / Keeta order matched with the Foodics order carrying the same platform order id.</p>
        </div>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        <span className="text-[var(--muted)]">→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
        <div className="flex gap-1 p-1 bg-[var(--bg)] border border-[var(--border)] rounded-xl">
          {PLATS.map((p) => (
            <button key={p.key} onClick={() => setPlat(p.key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${plat === p.key ? "text-white" : "text-[var(--muted)]"}`} style={plat === p.key ? { background: p.color } : undefined}>
              <p.icon className="w-3.5 h-3.5" /> {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${card} p-4`}>
        <div className="text-[11px] font-extrabold tracking-wider text-[var(--muted)] uppercase mb-2">Foodics data on the system</div>
        {pulls.length === 0 ? (
          <div className="flex items-start gap-2 text-xs text-[var(--muted)]"><Info className="w-4 h-4 shrink-0 mt-0.5" /> No Foodics orders yet. They are pulled from the Foodics Console by hand (one brand at a time) until the official API token is available.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {pulls.map((p) => (
              <span key={p.brand} className="text-[11px] px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg)]" title={`Pulled ${p.pulled_at}`}>
                <b className="text-[var(--heading)]">{p.brand}</b> · {dayShort(p.from_day)} → {dayShort(p.to_day)} · {num(p.rows)} orders · {p.branches} branches
              </span>
            ))}
          </div>
        )}
      </div>

      {err && <div className="flex items-center gap-2 text-xs text-rose-500 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10"><AlertCircle className="w-4 h-4" /> {err}</div>}

      {cmp && pulls.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className={`${card} p-4`}><div className="text-[11px] font-extrabold tracking-wider text-[var(--muted)] uppercase">Match rate</div><div className="text-3xl font-black font-mono text-[var(--heading)] mt-1">{fmtPct(pct(t.matched, t.platform))}</div><div className="text-[11px] text-[var(--muted)] mt-1">{num(t.matched)} of {num(t.platform)} platform orders are in Foodics</div></div>
            <div className={`${card} p-4`}><div className="text-[11px] font-extrabold tracking-wider text-[var(--muted)] uppercase">Not in Foodics</div><div className="text-3xl font-black font-mono mt-1" style={{ color: t.onlyP ? "var(--t-rose)" : "var(--heading)" }}>{num(t.onlyP)}</div><div className="text-[11px] text-[var(--muted)] mt-1">{kwd(t.onlyPv)} KWD delivered by the platform, not booked in the POS</div></div>
            <div className={`${card} p-4`}><div className="text-[11px] font-extrabold tracking-wider text-[var(--muted)] uppercase">Not on the platform</div><div className="text-3xl font-black font-mono mt-1 text-[var(--heading)]">{num(t.onlyF)}</div><div className="text-[11px] text-[var(--muted)] mt-1">{kwd(t.onlyFv)} KWD in Foodics with no platform order</div></div>
            <div className={`${card} p-4`}><div className="text-[11px] font-extrabold tracking-wider text-[var(--muted)] uppercase">Price differences</div><div className="text-3xl font-black font-mono mt-1 text-[var(--heading)]">{num(t.priceN)}</div><div className="text-[11px] text-[var(--muted)] mt-1">net {kwd(t.priceV)} KWD on matched orders (platform − Foodics)</div></div>
          </div>

          <div className={`${card} overflow-hidden`}>
            <div className="p-4 pb-2 text-sm font-extrabold text-[var(--heading)]">{PLATS.find((p) => p.key === plat)?.label} by brand · {dayShort(cmp.from)} → {dayShort(cmp.to)}{busy && <span className="text-[var(--muted)] font-normal"> · loading…</span>}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-[10px] uppercase tracking-wider text-[var(--muted)] bg-[var(--surface-2)]">
                  <th className="text-left py-2.5 px-4">Brand</th><th className={th}>Platform orders</th><th className={th}>Foodics orders</th><th className={th}>Matched</th>
                  <th className={th}>Not in Foodics</th><th className={th}>Not on platform</th><th className={th}>Platform value</th><th className={th}>Foodics subtotal</th><th className={th}>Difference</th><th className={th}>Price differs</th>
                </tr></thead>
                <tbody>
                  {brands.map((g) => {
                    const d = g.platform_gross - g.foodics_subtotal;
                    return (
                      <tr key={g.key} className="border-t border-[var(--border)]">
                        <td className="py-2.5 px-4 font-bold text-[var(--heading)]">{g.brand}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{num(g.platform_orders)}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{num(g.foodics_orders)}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{num(g.matched)} <span className="text-[var(--muted)]">({fmtPct(pct(g.matched, g.platform_orders))})</span></td>
                        <td className="py-2.5 px-3 text-right font-mono" style={{ color: g.only_platform ? "var(--t-rose)" : undefined }}>{num(g.only_platform)}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{num(g.only_foodics)}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{kwd(g.platform_gross)}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{kwd(g.foodics_subtotal)}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold" style={{ color: Math.abs(d) > 5000 ? "var(--t-rose)" : undefined }}>{kwd(d)}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{num(g.price_diff_orders)}</td>
                      </tr>
                    );
                  })}
                  {brands.length > 0 && (
                    <tr className="border-t-2 border-[var(--border)] bg-[var(--surface-2)] font-bold">
                      <td className="py-2.5 px-4">Total</td><td className="py-2.5 px-3 text-right font-mono">{num(t.platform)}</td><td className="py-2.5 px-3 text-right font-mono">{num(t.foodics)}</td><td className="py-2.5 px-3 text-right font-mono">{num(t.matched)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{num(t.onlyP)}</td><td className="py-2.5 px-3 text-right font-mono">{num(t.onlyF)}</td><td className="py-2.5 px-3 text-right font-mono">{kwd(t.pg)}</td><td className="py-2.5 px-3 text-right font-mono">{kwd(t.fs)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{kwd(t.pg - t.fs)}</td><td className="py-2.5 px-3 text-right font-mono">{num(t.priceN)}</td>
                    </tr>
                  )}
                  {brands.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-[var(--muted)]">No {plat} orders in this range.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="p-4 text-[11px] text-[var(--muted)] flex items-start gap-1.5"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Only brands whose Foodics orders were pulled can match; a brand with no Foodics data shows all its orders under “Not in Foodics”. Platform value is the original basket (before refunds), the same basis as Foodics' subtotal. Edge orders of the first / last day are not judged (Foodics' business day runs 06:00 to 06:00).</p>
          </div>

          <div className={`${card} overflow-hidden`}>
            <div className="p-4 flex flex-wrap items-center gap-2">
              <div className="flex gap-1 p-1 bg-[var(--bg)] border border-[var(--border)] rounded-xl">
                {LISTS.map((l) => (
                  <button key={l.key} onClick={() => setList(l.key)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${list === l.key ? "bg-[var(--t-aqua)] text-white" : "text-[var(--muted)]"}`}>{l.label} · {num(l.key === "only_platform" ? t.onlyP : l.key === "only_foodics" ? t.onlyF : t.priceN)}</button>
                ))}
              </div>
              <span className="flex-1" />
              <button onClick={exportList} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-[var(--border)] text-[var(--heading)] hover:bg-[var(--surface-2)]"><Download className="w-3.5 h-3.5" /> Export the first {Math.min(300, (cur?.lists[list] || []).length)}</button>
            </div>
            <div className="overflow-x-auto max-h-[28rem]">
              <table className="w-full text-xs">
                <thead><tr className="text-[10px] uppercase tracking-wider text-[var(--muted)] bg-[var(--surface-2)] sticky top-0">
                  <th className="text-left py-2 px-4">Order ID</th><th className="text-left py-2 px-3">Brand</th><th className="text-left py-2 px-3">{list === "only_platform" ? "Store" : "Branch"}</th><th className="text-left py-2 px-3">Day</th>
                  {list === "only_foodics" && <th className="text-left py-2 px-3">Opened</th>}
                  <th className={th}>{list === "price" ? "Platform" : list === "only_platform" ? "Platform value" : "Foodics subtotal"}</th>{list === "price" && <><th className={th}>Foodics</th><th className={th}>Difference</th></>}
                </tr></thead>
                <tbody>
                  {(cur?.lists[list] || []).map((r) => (
                    <tr key={r.id} className="border-t border-[var(--border)]">
                      <td className="py-2 px-4 font-mono">{r.id}</td><td className="py-2 px-3">{r.brand}</td><td className="py-2 px-3">{r.store || r.branch}</td><td className="py-2 px-3">{r.day}</td>
                      {list === "only_foodics" && <td className="py-2 px-3 font-mono">{r.opened}</td>}
                      <td className="py-2 px-3 text-right font-mono">{kwd(list === "only_foodics" ? r.foodics : r.platform)}</td>
                      {list === "price" && <><td className="py-2 px-3 text-right font-mono">{kwd(r.foodics)}</td><td className="py-2 px-3 text-right font-mono font-bold">{kwd(r.diff)}</td></>}
                    </tr>
                  ))}
                  {(cur?.lists[list] || []).length === 0 && <tr><td colSpan={8} className="py-6 text-center text-[var(--muted)] flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4" /> Nothing here.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
