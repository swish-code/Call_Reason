import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { apiFetch } from "../lib/api.ts";
import { RefreshCw, AlertCircle, LayoutDashboard } from "lucide-react";
import { BarChart } from "./PlatformAnalysis.tsx";

// Ratings & Reviews → Brand & Branch: the "Customer Reviews Dashboard" sheet as a live page. All brands and all aggregators
// unless the filters narrow it; everything below (numbers, findings, six charts) follows the filters.

interface Brand { name: string; total: number; avg: number; negative: number; rate: number; reasons: Record<string, number> }
interface BranchRow { name: string; total: number; avg: number; negative: number; rate: number }
interface Data {
  max_stars: number;
  totals: { total: number; avg: number; negative: number; rate: number; five_share: number; branches_to_action: number };
  reasons: { key: string; label: string; short: string; count: number }[];
  brands: Brand[]; platforms: { name: string; total: number; avg: number; rate: number }[];
  top_negative_branches: BranchRow[]; lowest_branches: BranchRow[]; min_reviews_for_lowest: number;
}
interface Opts { brands: { id: string; name: string }[]; platforms: { id: string; name: string }[] }

const KW_MS = 3 * 3600_000;
const kwToday = () => new Date(Date.now() + KW_MS).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const TONE: Record<string, string> = { cold: "#0ea5e9", late: "#f59e0b", food: "#dc2626", missing: "#8b5cf6", portion: "#14b8a6", packaging: "#ec4899", driver: "#6366f1", unspecified: "#94a3b8" };

/** Horizontal bars, label on the left and value at the end (top-10 and reason charts). */
function HBars({ title, rows, color, fmt, max }: { title: string; rows: { label: string; v: number; color?: string }[]; color: string; fmt: (v: number) => string; max?: number }) {
  const reduce = useReducedMotion();
  const top = max ?? Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-lg p-5">
      <h3 className="text-sm font-extrabold text-[var(--heading)] text-center mb-4">{title}</h3>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-xs text-[var(--muted)] text-center py-6">Nothing to show for these filters.</p>}
        {rows.map((r, i) => (
          <div key={r.label} className="grid grid-cols-[minmax(0,11rem)_1fr_3rem] items-center gap-3 text-[11px]">
            <span className="text-right font-bold text-[var(--text)] truncate" title={r.label}>{r.label}</span>
            <span className="h-4 rounded-r-md bg-[var(--surface-2)]/60 overflow-hidden">
              <motion.span className="block h-full rounded-r-md" initial={reduce ? false : { width: 0 }} animate={{ width: `${Math.max(1, (r.v / top) * 100)}%` }} transition={{ duration: 0.8, delay: i * 0.05, ease: "easeOut" }} style={{ background: r.color || color }} />
            </span>
            <b className="tabular-nums text-[var(--heading)]">{fmt(r.v)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Stacked vertical bars: one per brand, split by reason. */
function Stacked({ title, brands, reasons }: { title: string; brands: Brand[]; reasons: { key: string; label: string }[] }) {
  const reduce = useReducedMotion();
  const H = 190;
  const sums = brands.map((b) => reasons.reduce((a, r) => a + (b.reasons[r.key] || 0), 0));
  const max = Math.max(1, ...sums), step = max <= 50 ? 10 : max <= 150 ? 25 : max <= 300 ? 50 : 100, top = Math.ceil(max / step) * step;
  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-lg p-5">
      <h3 className="text-sm font-extrabold text-[var(--heading)] text-center mb-4">{title}</h3>
      <div className="flex gap-2">
        <div className="relative w-9 text-[10px] text-[var(--muted)] tabular-nums" style={{ height: H }}>
          {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((t) => <span key={t} className="absolute right-1 -translate-y-1/2" style={{ bottom: (t / top) * H }}>{t}</span>)}
        </div>
        <div className="flex-1 flex items-end justify-around gap-2 border-l border-b border-[var(--border)]" style={{ height: H }}>
          {brands.map((b, bi) => (
            <div key={b.name} className="flex-1 max-w-[56px] flex flex-col-reverse" title={`${b.name}: ${sums[bi]}`}>
              {reasons.map((r, ri) => {
                const v = b.reasons[r.key] || 0;
                return v ? <motion.div key={r.key} initial={reduce ? false : { height: 0 }} animate={{ height: (v / top) * H }} transition={{ duration: 0.7, delay: bi * 0.05 + ri * 0.03 }} style={{ background: TONE[r.key] }} title={`${r.label}: ${v}`} /> : null;
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-2 mt-1.5 h-16">
        <span className="w-9" />
        <div className="flex-1 flex justify-around gap-2">{brands.map((b) => <span key={b.name} className="flex-1 max-w-[56px] text-[10px] font-bold text-[var(--text)] text-right whitespace-nowrap origin-top-right -rotate-[35deg] translate-y-1" title={b.name}>{b.name}</span>)}</div>
      </div>
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2">{reasons.map((r) => <span key={r.key} className="flex items-center gap-1 text-[10px] text-[var(--muted)]"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: TONE[r.key] }} />{r.label}</span>)}</div>
    </div>
  );
}

export default function BrandPerformance() {
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
      const r = await apiFetch(`/api/ratings/performance?${p}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not load the dashboard.");
      setD(j);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [from, to, brandId, platformId, maxStars]);
  useEffect(() => { load(); }, [load]);

  const today = kwToday();
  const activePreset = to === today ? (from === addDays(today, -6) ? "7" : from === addDays(today, -29) ? "30" : from === today.slice(0, 8) + "01" ? "month" : "") : "";
  const hasData = !!d && d.totals.total > 0;
  const named = useMemo(() => (d?.reasons || []).filter((r) => r.key !== "unspecified"), [d]);
  const topReason = useMemo(() => [...named].sort((a, b) => b.count - a.count)[0], [named]);

  const sel = "px-3.5 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs font-bold text-[var(--heading)] focus:outline-none focus:ring-2 focus:ring-violet-500/60 transition";
  const lab = "flex flex-col gap-1 text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)]";
  const fade = (i: number) => reduce ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, delay: i * 0.05 } };

  // The "key findings" lines of the sheet
  const findings: string[] = [];
  if (hasData && d) {
    const lowB = [...d.brands].filter((b) => b.total).sort((a, b) => a.avg - b.avg)[0];
    const hiNeg = [...d.brands].sort((a, b) => b.rate - a.rate)[0];
    if (lowB) findings.push(`Lowest-rated brand: ${lowB.name} – ${lowB.avg.toFixed(2)} avg  (company avg ${d.totals.avg.toFixed(2)})`);
    if (hiNeg) findings.push(`Highest negative review rate (brand): ${hiNeg.name} – ${Math.round(hiNeg.rate)}% of reviews are low-rated`);
    if (d.lowest_branches[0]) findings.push(`Lowest-rated branch: ${d.lowest_branches[0].name} – ${d.lowest_branches[0].avg.toFixed(2)} avg`);
    if (d.top_negative_branches[0]) findings.push(`Most negative reviews (branch): ${d.top_negative_branches[0].name} – ${d.top_negative_branches[0].negative} low-rated reviews`);
    if (topReason && topReason.count) findings.push(`#1 negative review reason: ${topReason.short} (${d.totals.negative ? Math.round((topReason.count / d.totals.negative) * 100) : 0}% of negative reviews)  |  ${named.map((r) => `${r.short}: ${r.count}`).join("  |  ")}`);
    if (d.platforms.length) findings.push(`Rating by platform: ${d.platforms.map((p) => `${p.name} ${p.avg.toFixed(2)} (${Math.round(p.rate)}% low-rated)`).join("   |   ")}`);
  }

  const kpis: [string, string, boolean][] = d ? [
    ["Total ratings", d.totals.total.toLocaleString(), false], ["Avg rating", d.totals.avg.toFixed(2), false],
    ["Negative reviews (low-rated)", d.totals.negative.toLocaleString(), true], ["Negative review rate", `${d.totals.rate.toFixed(1)}%`, true],
    ["5-star share", `${d.totals.five_share.toFixed(1)}%`, false], ["Branches to action", String(d.totals.branches_to_action), true],
  ] : [];
  const maxRate = Math.max(10, Math.ceil(Math.max(0, ...(d?.brands || []).map((b) => b.rate)) / 10) * 10);

  return (
    <div className="space-y-5 text-[var(--text)]">
      <div className="rounded-3xl border border-[var(--border)] overflow-hidden shadow-xl bg-[var(--surface)]">
        <div className="bg-[#1f3864] text-white px-5 py-4 flex flex-wrap items-center gap-3">
          <LayoutDashboard className="w-6 h-6" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-extrabold tracking-tight leading-tight">Customer Reviews Dashboard – Brand &amp; Branch Performance</h2>
            <p className="text-[11px] opacity-80">Period: {longDay(from)} – {longDay(to)}  |  Negative Review = rating 1-{maxStars} stars ({maxStars === 2 ? "3 stars and above = good" : "4 stars and above = good"})</p>
          </div>
          <button onClick={load} className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition active:scale-95" title="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
        <div className="p-4 flex flex-wrap items-end gap-3">
          <label className={lab}>Platform
            <select value={platformId} onChange={(e) => setPlatformId(e.target.value)} className={sel + " min-w-[10rem]"}><option value="">All Platforms</option>{opts.platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <label className={lab}>Brand
            <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className={sel + " min-w-[11rem]"}><option value="">All Brands</option>{opts.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </label>
          <label className={lab}>From<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={sel} /></label>
          <label className={lab}>To<input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className={sel} /></label>
          <div className="flex rounded-xl bg-[var(--bg)] border border-[var(--border)] p-0.5 text-[11px] font-extrabold">
            {([["7", "7 days", () => { setTo(today); setFrom(addDays(today, -6)); }], ["30", "30 days", () => { setTo(today); setFrom(addDays(today, -29)); }], ["month", "This month", () => { setTo(today); setFrom(today.slice(0, 8) + "01"); }]] as [string, string, () => void][]).map(([key, l, f]) => (
              <button key={key} onClick={f} className={`px-3 py-2 rounded-lg transition ${activePreset === key ? "text-white shadow bg-[#1f3864]" : "text-[var(--muted)] hover:text-[var(--heading)]"}`}>{l}</button>
            ))}
          </div>
          <div className="flex rounded-xl bg-[var(--bg)] border border-[var(--border)] p-0.5 text-[11px] font-extrabold" title="Which ratings count as a negative review">
            {([[2, "Negative = 1–2 ★"], [3, "1–3 ★"]] as const).map(([n, l]) => (
              <button key={n} onClick={() => setMaxStars(n)} className={`px-3 py-2 rounded-lg transition ${maxStars === n ? "text-white shadow bg-rose-600" : "text-[var(--muted)] hover:text-[var(--heading)]"}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-2xl text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>}

      {d && (
        <div className={`space-y-5 transition-opacity duration-300 ${loading ? "opacity-50" : ""}`}>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {kpis.map(([l, v, red], i) => (
              <motion.div key={l} {...fade(i)} className="rounded-2xl overflow-hidden shadow-lg border border-[var(--border)]">
                <div className={`text-[10px] font-extrabold uppercase tracking-wide text-white text-center py-2 px-2 ${red ? "bg-[#c00000]" : "bg-[#1f3864]"}`}>{l}</div>
                <div className={`text-3xl font-extrabold text-center py-4 tabular-nums bg-[var(--surface-2)] ${red ? "text-[#c00000]" : "text-[#1f3864] dark:text-sky-300"}`}>{hasData || l.startsWith("Total") ? v : "—"}</div>
              </motion.div>
            ))}
          </div>

          {!hasData ? (
            <div className="p-10 text-center bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-lg text-sm font-bold text-[var(--heading)]">No reviews in these dates for the chosen filters</div>
          ) : (
            <>
              <motion.div {...fade(6)} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-lg p-5">
                <h3 className="text-sm font-extrabold text-[#1f3864] dark:text-sky-300 uppercase tracking-wide mb-2">Key findings</h3>
                <ul className="space-y-1.5 text-[12px] text-[var(--text)]">{findings.map((f, i) => <li key={i} className="flex gap-2"><span className="text-[var(--muted)]">•</span><span>{f}</span></li>)}</ul>
              </motion.div>

              <motion.div {...fade(7)} className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <BarChart rotate title="Average rating by brand (lowest first)" rows={d.brands.map((b) => ({ name: b.name, v: b.avg, color: "#2f5597" }))} max={5} fmt={(v) => v.toFixed(v % 1 ? 2 : 1)} ticks={[0, 1, 2, 3, 4, 5]} />
                <BarChart rotate title={`Negative review rate by brand (% of reviews rated 1-${d.max_stars} stars)`} rows={[...d.brands].sort((a, b) => b.rate - a.rate).map((b) => ({ name: b.name, v: b.rate, color: "#c00000" }))} max={maxRate} fmt={(v) => `${v % 1 ? v.toFixed(1) : v}%`} ticks={Array.from({ length: maxRate / 10 + 1 }, (_, i) => i * 10)} />
              </motion.div>

              <motion.div {...fade(8)} className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <HBars title="What are the negative reviews about? (all brands)" color="#ed7d31" fmt={(v) => String(v)} rows={named.map((r) => ({ label: r.label, v: r.count }))} />
                <Stacked title="Negative review reasons by brand" brands={[...d.brands].sort((a, b) => b.negative - a.negative)} reasons={named} />
              </motion.div>

              <motion.div {...fade(9)} className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <HBars title="Top 10 branches by number of negative reviews" color="#c00000" fmt={(v) => String(v)} rows={d.top_negative_branches.map((b) => ({ label: b.name, v: b.negative }))} />
                <HBars title="10 lowest-rated branches (average rating)" color="#2f5597" fmt={(v) => v.toFixed(2)} max={5} rows={d.lowest_branches.map((b) => ({ label: b.name, v: b.avg }))} />
              </motion.div>
              <p className="text-[10px] text-[var(--muted)] px-1">Lowest-rated branches count only branches with at least {d.min_reviews_for_lowest} ratings in the period, so one unhappy customer doesn't rank a branch last. "Branches to action" = branches whose negative review rate is above the overall rate.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
