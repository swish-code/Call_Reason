import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { apiFetch } from "../lib/api.ts";
import { downloadXlsx } from "../lib/xlsx.ts";
import { Layers, RefreshCw, Download, AlertCircle, Star, Flame, MessageSquareText } from "lucide-react";

// Ratings & Reviews → Platform analysis: the "Platform Analysis" sheet as a live page. One row per aggregator (Talabat, Keeta,
// FM App...) with ratings, average, negative reviews and what they name, plus two charts. Filters: brand, aggregator, dates;
// every number and chart follows them, and the count of negative reviews after filtering is the headline.

interface PRow { name: string; total: number; avg: number; negative: number; rate: number; reasons: Record<string, number> }
interface Data {
  max_stars: number; reasons: { key: string; label: string; short: string }[];
  totals: { total: number; negative: number; rate: number; avg: number }; platforms: PRow[];
}
interface Opts { brands: { id: string; name: string }[]; platforms: { id: string; name: string }[] }

const KW_MS = 3 * 3600_000;
const kwToday = () => new Date(Date.now() + KW_MS).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
const PLAT: Record<string, string> = { keeta: "#8b5cf6", talabat: "#f97316", snoonu: "#ef4444", ordable: "#0ea5e9", deliveroo: "#14b8a6", "fm app": "#10b981" };
const platColor = (n: string, i: number) => PLAT[n.toLowerCase()] || ["#6366f1", "#0ea5e9", "#f59e0b", "#ec4899", "#14b8a6", "#84cc16"][i % 6];

function useCountUp(value: number, decimals = 0) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) { setShown(value); return; }
    const a = shown, t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / 700); setShown(a + (value - a) * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const done = setTimeout(() => setShown(value), 780);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce]);
  return decimals ? shown.toFixed(decimals) : Math.round(shown).toLocaleString();
}
const Num = ({ v, decimals = 0, suffix = "" }: { v: number; decimals?: number; suffix?: string }) => <>{useCountUp(v, decimals)}{suffix}</>;

/** Vertical bars, one per platform, with the value on top: the two charts of the sheet. */
export function BarChart({ title, rows, max, fmt, ticks, rotate }: { rotate?: boolean; title: string; rows: { name: string; v: number; color: string }[]; max: number; fmt: (v: number) => string; ticks: number[] }) {
  const reduce = useReducedMotion();
  const H = 190;
  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-lg p-5">
      <h3 className="text-sm font-extrabold text-[var(--heading)] text-center mb-4">{title}</h3>
      <div className="flex gap-2">
        <div className="relative w-10 text-[10px] text-[var(--muted)] tabular-nums" style={{ height: H }}>
          {ticks.map((t) => <span key={t} className="absolute right-1 -translate-y-1/2" style={{ bottom: (t / max) * H }}>{fmt(t)}</span>)}
        </div>
        <div className="relative flex-1 flex items-end justify-around gap-3 border-l border-b border-[var(--border)]" style={{ height: H }}>
          {ticks.map((t) => <span key={t} className="absolute left-0 right-0 border-t border-dashed border-[var(--border)] opacity-60 pointer-events-none" style={{ bottom: (t / max) * H }} />)}
          {rows.map((r, i) => (
            <div key={r.name} className="relative flex flex-col items-center justify-end h-full flex-1 max-w-[90px]">
              <span className="text-[11px] font-extrabold text-[var(--heading)] tabular-nums mb-1">{fmt(r.v)}</span>
              <motion.div className="w-full rounded-t-lg" initial={reduce ? false : { height: 0 }} animate={{ height: Math.max(2, (Math.min(r.v, max) / max) * (H - 22)) }} transition={{ duration: 0.8, delay: i * 0.08, ease: "easeOut" }}
                style={{ background: `linear-gradient(180deg, ${r.color}, color-mix(in srgb, ${r.color} 62%, #000))`, boxShadow: `0 6px 16px -8px ${r.color}` }} title={`${r.name}: ${fmt(r.v)}`} />
            </div>
          ))}
        </div>
      </div>
      <div className={`flex gap-2 mt-1.5 ${rotate ? "h-16" : ""}`}>
        <span className="w-10" />
        <div className="flex-1 flex justify-around gap-3">{rows.map((r) => <span key={r.name} className={`flex-1 max-w-[90px] text-[11px] font-bold text-[var(--text)] ${rotate ? "text-right whitespace-nowrap origin-top-right -rotate-[35deg] translate-y-1" : "text-center truncate"}`} title={r.name}>{r.name}</span>)}</div>
      </div>
    </div>
  );
}

export default function PlatformAnalysis() {
  const reduce = useReducedMotion();
  const [opts, setOpts] = useState<Opts>({ brands: [], platforms: [] });
  const [from, setFrom] = useState(() => addDays(kwToday(), -29));
  const [to, setTo] = useState(kwToday);
  const [brandId, setBrandId] = useState("");
  const [platformId, setPlatformId] = useState("");
  const [maxStars, setMaxStars] = useState<2 | 3>(2);
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { apiFetch("/api/ratings/branch-options").then((r) => (r.ok ? r.json() : null)).then((j) => j && setOpts({ brands: j.brands || [], platforms: j.platforms || [] })).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const p = new URLSearchParams({ from, to, max_stars: String(maxStars) });
      if (brandId) p.set("brand_id", brandId);
      if (platformId) p.set("platform_id", platformId);
      const r = await apiFetch(`/api/ratings/platform-analysis?${p}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not load the analysis.");
      setD(j);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [from, to, brandId, platformId, maxStars]);
  useEffect(() => { load(); }, [load]);

  const today = kwToday();
  const activePreset = to === today ? (from === addDays(today, -6) ? "7" : from === addDays(today, -29) ? "30" : from === today.slice(0, 8) + "01" ? "month" : "") : "";
  const scope = [opts.brands.find((b) => b.id === brandId)?.name || "All brands", opts.platforms.find((p) => p.id === platformId)?.name || "All aggregators"].join(" · ");

  const exportXlsx = async () => {
    if (!d) return;
    await downloadXlsx(["Platform", "Total Ratings", "Avg Rating", "Negative Reviews", "Negative Review Rate", ...d.reasons.map((r) => r.label)],
      d.platforms.map((p) => [p.name, p.total, p.avg, p.negative, `${p.rate.toFixed(1)}%`, ...d.reasons.map((r) => p.reasons[r.key] || 0)]),
      `platform-analysis-${from}_${to}.xlsx`, "Platform Analysis");
  };

  const sel = "px-3.5 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs font-bold text-[var(--heading)] focus:outline-none focus:ring-2 focus:ring-violet-500/60 transition";
  const lab = "flex flex-col gap-1 text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)]";
  const fade = (i: number) => reduce ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, delay: i * 0.06 } };
  const rows = d?.platforms || [];
  const hasData = !!d && d.totals.total > 0;
  const maxRate = Math.max(10, Math.ceil(Math.max(0, ...rows.map((r) => r.rate)) / 10) * 10);

  return (
    <div className="space-y-5 text-[var(--text)]">
      <div className="rounded-3xl border border-[var(--border)] shadow-xl bg-gradient-to-br from-[var(--surface)] via-[var(--surface-2)] to-[var(--bg)] p-5">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="p-3 rounded-2xl text-white shadow-lg" style={{ background: "linear-gradient(135deg,#0ea5e9,#6366f1)" }}><Layers className="w-6 h-6" /></div>
          <div>
            <h2 className="text-xl font-extrabold text-[var(--heading)] tracking-tight leading-tight">Platform analysis</h2>
            <p className="text-[11px] text-[var(--muted)]">Rating &amp; negative reviews by aggregator · {scope}</p>
          </div>
          <span className="flex-1" />
          <button onClick={load} className="p-2.5 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--muted)] transition active:scale-95" title="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
          <button onClick={exportXlsx} disabled={!hasData} className="px-4 py-2.5 rounded-xl text-xs font-extrabold text-white flex items-center gap-1.5 shadow-lg disabled:opacity-40 transition active:scale-95" style={{ background: "linear-gradient(135deg,#10b981,#059669)" }}><Download className="w-4 h-4" /> Export</button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className={lab}>Brand
            <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className={sel + " min-w-[11rem]"}><option value="">All brands</option>{opts.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </label>
          <label className={lab}>Aggregator
            <select value={platformId} onChange={(e) => setPlatformId(e.target.value)} className={sel + " min-w-[10rem]"}><option value="">All aggregators</option>{opts.platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <label className={lab}>From<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={sel} /></label>
          <label className={lab}>To<input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className={sel} /></label>
          <div className="flex rounded-xl bg-[var(--bg)] border border-[var(--border)] p-0.5 text-[11px] font-extrabold">
            {([["7", "7 days", () => { setTo(today); setFrom(addDays(today, -6)); }], ["30", "30 days", () => { setTo(today); setFrom(addDays(today, -29)); }], ["month", "This month", () => { setTo(today); setFrom(today.slice(0, 8) + "01"); }]] as [string, string, () => void][]).map(([key, l, f]) => (
              <button key={key} onClick={f} className={`px-3 py-2 rounded-lg transition ${activePreset === key ? "text-white shadow" : "text-[var(--muted)] hover:text-[var(--heading)]"}`} style={activePreset === key ? { background: "linear-gradient(135deg,#0ea5e9,#6366f1)" } : undefined}>{l}</button>
            ))}
          </div>
          <div className="flex rounded-xl bg-[var(--bg)] border border-[var(--border)] p-0.5 text-[11px] font-extrabold" title="Which ratings count as a negative review">
            {([[2, "Negative = 1–2 ★"], [3, "1–3 ★"]] as const).map(([n, l]) => (
              <button key={n} onClick={() => setMaxStars(n)} className={`px-3 py-2 rounded-lg transition ${maxStars === n ? "text-white shadow" : "text-[var(--muted)] hover:text-[var(--heading)]"}`} style={maxStars === n ? { background: "linear-gradient(135deg,#f43f5e,#e11d48)" } : undefined}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-2xl text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>}

      {d && (
        <div className={`space-y-5 transition-opacity duration-300 ${loading ? "opacity-50" : ""}`}>
          {/* The answer to the filter: how many negative reviews are left */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <motion.div {...fade(0)} className="col-span-2 lg:col-span-1 rounded-2xl p-4 shadow-lg border border-rose-500/30" style={{ background: "linear-gradient(135deg,rgba(248,113,113,.18),rgba(225,29,72,.08))" }}>
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)] flex items-center gap-1.5"><MessageSquareText className="w-3.5 h-3.5 text-rose-500" /> Negative reviews</p>
              <p className="text-4xl font-extrabold text-rose-600 mt-1.5 tabular-nums"><Num v={d.totals.negative} /></p>
              <p className="text-[10px] text-[var(--muted)] mt-1">after the filters · 1–{d.max_stars} star ratings</p>
            </motion.div>
            <motion.div {...fade(1)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)] flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-sky-500" /> Total ratings</p>
              <p className="text-3xl font-extrabold text-[var(--heading)] mt-1.5 tabular-nums"><Num v={d.totals.total} /></p>
            </motion.div>
            <motion.div {...fade(2)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)] flex items-center gap-1.5"><Star className="w-3.5 h-3.5 text-amber-500" /> Avg rating</p>
              <p className="text-3xl font-extrabold text-[var(--heading)] mt-1.5 tabular-nums">{hasData ? <Num v={d.totals.avg} decimals={2} /> : "—"}</p>
            </motion.div>
            <motion.div {...fade(3)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)] flex items-center gap-1.5"><Flame className="w-3.5 h-3.5 text-orange-500" /> Negative review rate</p>
              <p className="text-3xl font-extrabold text-[var(--heading)] mt-1.5 tabular-nums">{hasData ? <Num v={d.totals.rate} decimals={1} suffix="%" /> : "—"}</p>
            </motion.div>
          </div>

          {!hasData ? (
            <div className="p-10 text-center bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-lg text-sm font-bold text-[var(--heading)]">No reviews for {scope} in these dates</div>
          ) : (
            <>
              <motion.div {...fade(4)} className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <BarChart title="Average rating by platform" rows={rows.map((r, i) => ({ name: r.name, v: r.avg, color: platColor(r.name, i) }))} max={5} fmt={(v) => v.toFixed(v % 1 ? 2 : 1)} ticks={[0, 1, 2, 3, 4, 5]} />
                <BarChart title={`Negative review rate by platform (rated 1-${d.max_stars} stars)`} rows={rows.map((r) => ({ name: r.name, v: r.rate, color: "#c00000" }))} max={maxRate} fmt={(v) => `${v % 1 ? v.toFixed(1) : v}%`} ticks={Array.from({ length: maxRate / 10 + 1 }, (_, i) => i * 10)} />
              </motion.div>

              <motion.div {...fade(5)} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-[10px] uppercase tracking-wide text-white bg-[#1f3864]">
                      <th className="p-3 text-left">Platform</th><th className="p-3 text-center">Total Ratings</th><th className="p-3 text-center">Avg Rating</th><th className="p-3 text-center">Negative Reviews</th><th className="p-3 text-center">Negative Review Rate</th>
                      {d.reasons.map((r) => <th key={r.key} className="p-3 text-center">{r.label}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {rows.map((p, i) => (
                        <tr key={p.name} className="hover:bg-[var(--surface-2)]/50">
                          <td className="p-3 font-extrabold" style={{ color: platColor(p.name, i) }}>{p.name}</td>
                          <td className="p-3 text-center tabular-nums">{p.total.toLocaleString()}</td>
                          <td className="p-3 text-center tabular-nums">{p.avg.toFixed(2)}</td>
                          <td className="p-3 text-center tabular-nums font-bold">{p.negative.toLocaleString()}</td>
                          <td className="p-3 text-center tabular-nums font-bold" style={{ color: p.rate > d.totals.rate ? "#e11d48" : "#059669" }}>{p.rate.toFixed(1)}%</td>
                          {d.reasons.map((r) => <td key={r.key} className="p-3 text-center tabular-nums text-[var(--muted)]">{p.reasons[r.key] || 0}</td>)}
                        </tr>
                      ))}
                      {rows.length > 1 && (
                        <tr className="bg-[var(--bg)] font-extrabold">
                          <td className="p-3">All</td><td className="p-3 text-center tabular-nums">{d.totals.total.toLocaleString()}</td><td className="p-3 text-center tabular-nums">{d.totals.avg.toFixed(2)}</td>
                          <td className="p-3 text-center tabular-nums">{d.totals.negative.toLocaleString()}</td><td className="p-3 text-center tabular-nums">{d.totals.rate.toFixed(1)}%</td>
                          {d.reasons.map((r) => <td key={r.key} className="p-3 text-center tabular-nums">{rows.reduce((a, p) => a + (p.reasons[r.key] || 0), 0)}</td>)}
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-[var(--muted)] p-3">A negative review can name more than one reason, so the reason columns can add up to more than the negative reviews.</p>
              </motion.div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
