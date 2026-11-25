import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { apiFetch } from "../lib/api.ts";
import { downloadXlsx } from "../lib/xlsx.ts";
import {
  Store, RefreshCw, Download, AlertCircle, Star, Search, X, MessageSquareText, Flame, ShieldCheck, TrendingDown, TrendingUp, Minus, Layers, CalendarRange, Sparkles,
} from "lucide-react";

// Ratings & Reviews → Branch report. Pick a period, a brand and a branch: that branch's numbers against all branches
// together, what its complaints are about (bars + donut, click a reason to filter), and the complaints themselves.
// A complaint is a 1-2 star review (1-3 on request); the reasons are read from the review's words.
// Numbers count up, bars grow and the status breathes; reduced motion turns all of that off.

interface Reason { key: string; label: string; count: number; pct_branch: number; pct_all: number }
interface Complaint { day: string; platform: string; order_id: string; rating: number; reasons: string[]; text: string; branch: string; brand: string }
interface Report {
  range: { from: string; to: string }; max_stars: number;
  kpi: { reviews: number; avg: number; complaints: number; complaint_rate: number; main_issue: string; status: "ACTION" | "OK" };
  company: { reviews: number; avg: number; complaints: number; complaint_rate: number };
  reasons: Reason[]; stars: number[]; complaints: Complaint[]; complaints_total: number; cap: number;
}
interface Opts { brands: { id: string; name: string; branches: string[] }[] }

const KW_MS = 3 * 3600_000;
const kwToday = () => new Date(Date.now() + KW_MS).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (d: string) => `${d.slice(8, 10)}-${MONTHS[Number(d.slice(5, 7)) - 1]}-${d.slice(2, 4)}`;
const short = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

// One colour per reason, used by its bar, its donut slice and its chips.
const TONE: Record<string, { c1: string; c2: string }> = {
  cold: { c1: "#7dd3fc", c2: "#0ea5e9" }, late: { c1: "#fcd34d", c2: "#f59e0b" }, food: { c1: "#fca5a5", c2: "#ef4444" },
  missing: { c1: "#c4b5fd", c2: "#8b5cf6" }, portion: { c1: "#5eead4", c2: "#14b8a6" }, packaging: { c1: "#f9a8d4", c2: "#ec4899" },
  driver: { c1: "#a5b4fc", c2: "#6366f1" }, unspecified: { c1: "#cbd5e1", c2: "#94a3b8" },
};
const KEY_OF_SHORT: Record<string, string> = { Cold: "cold", Late: "late", Food: "food", Missing: "missing", Portion: "portion", Packaging: "packaging", Driver: "driver" };
const keysOf = (c: Complaint) => (c.reasons.length ? c.reasons.map((r) => KEY_OF_SHORT[r]).filter(Boolean) : ["unspecified"]);
const PLATFORM_TONE: Record<string, string> = { keeta: "#8b5cf6", talabat: "#f97316", snoonu: "#ef4444", ordable: "#0ea5e9", deliveroo: "#14b8a6" };

const STYLE = `
.brp .glass { background: color-mix(in srgb, var(--surface) 82%, transparent); backdrop-filter: blur(10px); }
@keyframes brp-drift { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-36px,22px) scale(1.18); } }
.brp-drift { animation: brp-drift 15s ease-in-out infinite; }
@keyframes brp-pulse { 0% { box-shadow: 0 0 0 0 var(--ring); } 70% { box-shadow: 0 0 0 16px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
.brp-pulse { animation: brp-pulse 2.2s ease-out infinite; }
@keyframes brp-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
.brp-skel { background: linear-gradient(90deg, var(--surface-2) 25%, color-mix(in srgb, var(--surface-2) 55%, var(--surface)) 50%, var(--surface-2) 75%); background-size: 800px 100%; animation: brp-shimmer 1.4s linear infinite; }
.brp-row { transition: background .15s, transform .15s; } .brp-row:hover { transform: translateX(2px); }
@media (prefers-reduced-motion: reduce) { .brp-drift, .brp-pulse, .brp-skel { animation: none; } .brp-row:hover { transform: none; } }
`;

/** A number that counts from its last value to the new one. */
function useCountUp(value: number, ms = 800, decimals = 0) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const cur = useRef(reduce ? value : 0);
  useEffect(() => {
    if (reduce) { cur.current = value; setShown(value); return; }
    const a = cur.current, t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      cur.current = a + (value - a) * e; setShown(cur.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const done = setTimeout(() => { cur.current = value; setShown(value); }, ms + 80);   // a hidden tab gets no frames
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
  }, [value, ms, reduce]);
  return decimals ? shown.toFixed(decimals) : Math.round(shown).toLocaleString();
}
const Num = ({ v, decimals = 0, suffix = "" }: { v: number; decimals?: number; suffix?: string }) => <>{useCountUp(v, 800, decimals)}{suffix}</>;

const Stars = ({ n, size = 13 }: { n: number; size?: number }) => (
  <span className="inline-flex items-center gap-px" aria-label={`${n} of 5`}>
    {[1, 2, 3, 4, 5].map((i) => <Star key={i} style={{ width: size, height: size, color: i <= n ? (n <= 2 ? "#f43f5e" : "#f59e0b") : "var(--border)", fill: i <= n ? (n <= 2 ? "#f43f5e" : "#f59e0b") : "none" }} />)}
  </span>
);

/** "better / worse than all branches" chip: lowerIsBetter for the complaint rate. */
function Delta({ diff, unit, lowerIsBetter, hide }: { diff: number; unit: string; lowerIsBetter?: boolean; hide?: boolean }) {
  if (hide) return null;
  const flat = Math.abs(diff) < (unit === "%" ? 0.05 : 0.005);
  const good = flat ? null : lowerIsBetter ? diff < 0 : diff > 0;
  const Icon = flat ? Minus : diff > 0 ? TrendingUp : TrendingDown;
  const col = good === null ? "var(--muted)" : good ? "#10b981" : "#f43f5e";
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold" style={{ color: col, background: `color-mix(in srgb, ${col} 13%, transparent)` }} title="Compared with all branches in the same period">
      <Icon className="w-3 h-3" /> {flat ? "same as all" : `${diff > 0 ? "+" : ""}${unit === "%" ? diff.toFixed(1) : diff.toFixed(2)}${unit === "%" ? " pts" : ""} vs all`}
    </span>
  );
}

export default function BranchReport() {
  const reduce = useReducedMotion();
  const [opts, setOpts] = useState<Opts>({ brands: [] });
  const [from, setFrom] = useState(() => addDays(kwToday(), -29));
  const [to, setTo] = useState(kwToday);
  const [brandId, setBrandId] = useState("");
  const [branch, setBranch] = useState("");
  const [maxStars, setMaxStars] = useState<2 | 3>(2);
  const [d, setD] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pick, setPick] = useState<string | null>(null);   // a reason the list is filtered to
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(40);

  useEffect(() => { apiFetch("/api/ratings/branch-options").then((r) => (r.ok ? r.json() : { brands: [] })).then(setOpts).catch(() => {}); }, []);
  const branches = useMemo(() => opts.brands.find((b) => b.id === brandId)?.branches || [], [opts, brandId]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const p = new URLSearchParams({ from, to, max_stars: String(maxStars) });
      if (brandId) p.set("brand_id", brandId);
      if (branch) p.set("branch", branch);
      const r = await apiFetch(`/api/ratings/branch-report?${p}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not load the report.");
      setD(j);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [from, to, brandId, branch, maxStars]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPick(null); setShown(40); }, [brandId, branch, from, to, maxStars]);
  useEffect(() => { setShown(40); }, [pick, q]);

  const today = kwToday();
  const activePreset = to === today ? (from === addDays(today, -6) ? "7" : from === addDays(today, -29) ? "30" : from === today.slice(0, 8) + "01" ? "month" : "") : "";
  const scopeName = [opts.brands.find((b) => b.id === brandId)?.name, branch].filter(Boolean).join(" · ") || "All brands";

  const exportXlsx = async () => {
    if (!d) return;
    await downloadXlsx(["#", "Date", "Brand", "Branch", "Platform", "Order ID", "Rating", "Issue(s)", "Review text"],
      d.complaints.map((c, i) => [i + 1, dmy(c.day), c.brand, c.branch, c.platform, c.order_id, c.rating, c.reasons.join(", ") || "Unspecified", c.text]),
      `negative-reviews-${scopeName.replace(/[^a-z0-9]+/gi, "-")}-${from}_${to}.xlsx`, "Negative reviews");
  };

  const k = d?.kpi, co = d?.company;
  const hasData = !!k && k.reviews > 0;
  const status = k?.status;
  const maxBar = Math.max(1, ...(d?.reasons || []).map((r) => Math.max(r.count, 0)));
  const named = (d?.reasons || []).filter((r) => r.key !== "unspecified");
  const namedTotal = named.reduce((a, r) => a + r.count, 0);
  const listed = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (d?.complaints || []).filter((c) => (!pick || keysOf(c).includes(pick)) && (!needle || c.order_id.toLowerCase().includes(needle) || c.text.toLowerCase().includes(needle) || c.branch.toLowerCase().includes(needle)));
  }, [d, pick, q]);

  const sel = "px-3.5 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs font-bold text-[var(--heading)] focus:outline-none focus:ring-2 focus:ring-violet-500/60 transition";
  const fade = (i: number) => reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] as any } };

  return (
    <div className="brp space-y-5 text-[var(--text)]">
      <style>{STYLE}</style>

      {/* Hero + filters */}
      <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] shadow-xl bg-gradient-to-br from-[var(--surface)] via-[var(--surface-2)] to-[var(--bg)] p-5">
        <div className="brp-drift absolute -top-24 -right-16 w-80 h-80 rounded-full blur-3xl opacity-25 pointer-events-none" style={{ background: "radial-gradient(circle, #8b5cf6, transparent 70%)" }} />
        <div className="brp-drift absolute -bottom-28 left-1/4 w-72 h-72 rounded-full blur-3xl opacity-20 pointer-events-none" style={{ background: "radial-gradient(circle, #0ea5e9, transparent 70%)", animationDelay: "-6s" }} />
        <div className="relative flex flex-wrap items-center gap-3 mb-4">
          <div className="p-3 rounded-2xl text-white shadow-lg" style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)" }}><Store className="w-6 h-6" /></div>
          <div>
            <h2 className="text-xl font-extrabold text-[var(--heading)] tracking-tight leading-tight">Branch report</h2>
            <p className="text-[11px] text-[var(--muted)] flex items-center gap-1.5"><CalendarRange className="w-3.5 h-3.5" /> {scopeName} <span className="opacity-50">·</span> {short(from)} – {short(to)}</p>
          </div>
          <span className="flex-1" />
          <button onClick={load} className="p-2.5 rounded-xl border border-[var(--border)] glass hover:bg-[var(--surface-2)] text-[var(--muted)] transition active:scale-95" title="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
          <button onClick={exportXlsx} disabled={!d || !d.complaints.length} className="px-4 py-2.5 rounded-xl text-xs font-extrabold text-white flex items-center gap-1.5 shadow-lg disabled:opacity-40 transition active:scale-95" style={{ background: "linear-gradient(135deg,#10b981,#059669)" }}><Download className="w-4 h-4" /> Export negative reviews</button>
        </div>
        <div className="relative flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)]">Brand
            <select value={brandId} onChange={(e) => { setBrandId(e.target.value); setBranch(""); }} className={sel + " min-w-[11rem]"}>
              <option value="">All brands</option>
              {opts.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)]">Branch
            <select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!brandId} className={sel + " min-w-[12rem] disabled:opacity-50"}>
              <option value="">{brandId ? "All branches of the brand" : "Pick a brand first"}</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)]">From
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={sel} />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)]">To
            <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className={sel} />
          </label>
          <div className="flex rounded-xl bg-[var(--bg)] border border-[var(--border)] p-0.5 text-[11px] font-extrabold">
            {([["7", "7 days", () => { setTo(today); setFrom(addDays(today, -6)); }], ["30", "30 days", () => { setTo(today); setFrom(addDays(today, -29)); }], ["month", "This month", () => { setTo(today); setFrom(today.slice(0, 8) + "01"); }]] as [string, string, () => void][]).map(([key, l, f]) => (
              <button key={key} onClick={f} className={`px-3 py-2 rounded-lg transition ${activePreset === key ? "text-white shadow" : "text-[var(--muted)] hover:text-[var(--heading)]"}`} style={activePreset === key ? { background: "linear-gradient(135deg,#8b5cf6,#6366f1)" } : undefined}>{l}</button>
            ))}
          </div>
          <div className="flex rounded-xl bg-[var(--bg)] border border-[var(--border)] p-0.5 text-[11px] font-extrabold" title="Which reviews count as a negative review">
            {([[2, "Negative = 1–2 ★"], [3, "1–3 ★"]] as const).map(([n, l]) => (
              <button key={n} onClick={() => setMaxStars(n)} className={`px-3 py-2 rounded-lg transition ${maxStars === n ? "text-white shadow" : "text-[var(--muted)] hover:text-[var(--heading)]"}`} style={maxStars === n ? { background: "linear-gradient(135deg,#f43f5e,#e11d48)" } : undefined}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-2xl text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>}
      {loading && !d && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="brp-skel h-28 rounded-2xl" />)}</div>
      )}

      {d && k && co && (
        <div className={`space-y-5 transition-opacity duration-300 ${loading ? "opacity-50" : ""}`}>
          {/* Headline numbers */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <motion.div {...fade(0)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)] flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-sky-500" /> Reviews</p>
              <p className="text-3xl font-extrabold text-[var(--heading)] mt-2 tabular-nums"><Num v={k.reviews} /></p>
              <p className="text-[10px] text-[var(--muted)] mt-1">{co.reviews.toLocaleString()} across all branches</p>
            </motion.div>
            <motion.div {...fade(1)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)] flex items-center gap-1.5"><Star className="w-3.5 h-3.5 text-amber-500" /> Avg rating</p>
              <p className="text-3xl font-extrabold text-[var(--heading)] mt-2 tabular-nums">{hasData ? <Num v={k.avg} decimals={2} /> : "—"}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{hasData && <Stars n={Math.round(k.avg)} size={11} />}<Delta diff={k.avg - co.avg} unit="" hide={!hasData} /></div>
            </motion.div>
            <motion.div {...fade(2)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)] flex items-center gap-1.5"><MessageSquareText className="w-3.5 h-3.5 text-rose-500" /> Negative reviews</p>
              <p className="text-3xl font-extrabold text-[var(--heading)] mt-2 tabular-nums"><Num v={k.complaints} /></p>
              <p className="text-[10px] text-[var(--muted)] mt-1">1–{d.max_stars} star reviews</p>
            </motion.div>
            <motion.div {...fade(3)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)] flex items-center gap-1.5"><Flame className="w-3.5 h-3.5 text-orange-500" /> Negative rate</p>
              <p className="text-3xl font-extrabold text-[var(--heading)] mt-2 tabular-nums">{hasData ? <Num v={k.complaint_rate} decimals={1} suffix="%" /> : "—"}</p>
              {hasData && (
                <div className="mt-2 relative h-1.5 rounded-full bg-[var(--surface-2)]" title={`All branches: ${co.complaint_rate.toFixed(1)}%`}>
                  <motion.div className="h-full rounded-full" initial={reduce ? false : { width: 0 }} animate={{ width: `${Math.min(100, k.complaint_rate)}%` }} transition={{ duration: 0.8, ease: "easeOut" }} style={{ background: k.status === "ACTION" ? "linear-gradient(90deg,#fb923c,#e11d48)" : "linear-gradient(90deg,#34d399,#10b981)" }} />
                  <span className="absolute -top-1 w-0.5 h-3.5 rounded bg-[var(--heading)]" style={{ left: `${Math.min(100, co.complaint_rate)}%` }} />
                </div>
              )}
              <div className="mt-1.5"><Delta diff={k.complaint_rate - co.complaint_rate} unit="%" lowerIsBetter hide={!hasData} /></div>
            </motion.div>
            <motion.div {...fade(4)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)] flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-violet-500" /> Main issue</p>
              <p className="text-2xl font-extrabold mt-2 leading-tight" style={{ color: TONE[Object.keys(KEY_OF_SHORT).includes(k.main_issue) ? KEY_OF_SHORT[k.main_issue] : "unspecified"].c2 }}>{k.main_issue}</p>
              <p className="text-[10px] text-[var(--muted)] mt-1">most named reason</p>
            </motion.div>
            <motion.div {...fade(5)} className="rounded-2xl p-4 shadow-lg text-center flex flex-col items-center justify-center border"
              style={{ ["--ring" as any]: status === "ACTION" ? "rgba(225,29,72,.45)" : "rgba(16,185,129,.4)", background: !hasData ? "var(--surface)" : status === "ACTION" ? "linear-gradient(135deg,rgba(248,113,113,.18),rgba(225,29,72,.10))" : "linear-gradient(135deg,rgba(52,211,153,.2),rgba(16,185,129,.1))", borderColor: !hasData ? "var(--border)" : status === "ACTION" ? "rgba(225,29,72,.35)" : "rgba(16,185,129,.35)" }}>
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)]">Status</p>
              {hasData ? (
                <>
                  <span className={`mt-2 w-11 h-11 rounded-full flex items-center justify-center text-white brp-pulse`} style={{ background: status === "ACTION" ? "linear-gradient(135deg,#fb7185,#e11d48)" : "linear-gradient(135deg,#34d399,#059669)" }}>
                    {status === "ACTION" ? <Flame className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
                  </span>
                  <p className="mt-1.5 text-lg font-extrabold tracking-wider" style={{ color: status === "ACTION" ? "#e11d48" : "#059669" }}>{status}</p>
                </>
              ) : <p className="text-2xl font-extrabold text-[var(--muted)] mt-3">—</p>}
            </motion.div>
          </div>
          <p className="text-[11px] text-[var(--muted)] -mt-2 px-1">All branches in the same period: average <b className="text-[var(--heading)]">{co.avg.toFixed(2)}</b> · negative-review rate <b className="text-[var(--heading)]">{co.complaint_rate.toFixed(1)}%</b> ({co.complaints.toLocaleString()} of {co.reviews.toLocaleString()}). <b>ACTION</b> = this branch's negative-review rate is above the all-branch rate.</p>

          {!hasData ? (
            <div className="p-10 text-center bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-lg">
              <Store className="w-9 h-9 mx-auto text-[var(--muted)] opacity-50" />
              <p className="mt-3 text-sm font-bold text-[var(--heading)]">No reviews for {scopeName} in these dates</p>
              <p className="text-xs text-[var(--muted)] mt-1">Try a longer period or another branch.</p>
            </div>
          ) : (
            <>
              {/* Complaint reasons: bars + donut */}
              <motion.div {...fade(6)} className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                <div className="xl:col-span-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-lg p-5">
                  <div className="flex items-baseline justify-between mb-3">
                    <h3 className="text-sm font-extrabold text-[var(--heading)]">Negative review reasons</h3>
                    <span className="text-[10px] text-[var(--muted)]">click a reason to list its negative reviews · the tick marks all branches</span>
                  </div>
                  <div className="space-y-1">
                    {d.reasons.map((r, i) => {
                      const t = TONE[r.key] || TONE.unspecified, on = pick === r.key;
                      return (
                        <button key={r.key} onClick={() => setPick(on ? null : r.key)} disabled={!r.count}
                          className={`brp-row w-full grid grid-cols-[9.5rem_1fr_auto] items-center gap-3 px-2.5 py-2 rounded-xl text-left ${on ? "bg-[var(--surface-2)] ring-1 ring-[var(--border)]" : "hover:bg-[var(--surface-2)]/60"} ${!r.count ? "opacity-45" : ""}`}>
                          <span className="flex items-center gap-2 text-xs font-bold text-[var(--heading)]"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.c2 }} />{r.label}</span>
                          <span className="relative h-3.5 rounded-full bg-[var(--surface-2)]">
                            <motion.span className="absolute inset-y-0 left-0 rounded-full" initial={reduce ? false : { width: 0 }} animate={{ width: `${(r.count / maxBar) * 100}%` }} transition={{ duration: 0.8, delay: 0.1 + i * 0.05, ease: "easeOut" }} style={{ background: `linear-gradient(90deg, ${t.c1}, ${t.c2})`, boxShadow: `0 4px 14px -6px ${t.c2}` }} />
                            <span className="absolute -top-0.5 w-0.5 rounded bg-[var(--heading)] opacity-60" style={{ left: `${Math.min(100, (r.pct_all / 100) * (d.kpi.complaints || 1) / maxBar * 100)}%`, height: 18 }} title={`All branches: ${r.pct_all}% of negative reviews`} />
                          </span>
                          <span className="flex items-center gap-2 text-[11px] tabular-nums">
                            <b className="w-9 text-right text-[var(--heading)]">{r.count}</b>
                            <span className="w-10 text-right font-bold" style={{ color: t.c2 }}>{r.pct_branch}%</span>
                            <span className="w-14 text-right text-[var(--muted)]" title="Share of all-branch negative reviews">all {r.pct_all}%</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-[var(--muted)] mt-3 px-1">A review can name more than one reason, so the counts can add up to more than the negative reviews.</p>
                </div>

                <div className="xl:col-span-2 rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-lg p-5 flex flex-col items-center">
                  <h3 className="text-sm font-extrabold text-[var(--heading)] self-start">What they complain about</h3>
                  <Donut reasons={named} total={namedTotal} complaints={k.complaints} reduce={!!reduce} pick={pick} setPick={setPick} />
                  <div className="w-full mt-3 pt-3 border-t border-[var(--border)]">
                    <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)] mb-2">Ratings</p>
                    <div className="flex h-3 rounded-full overflow-hidden bg-[var(--surface-2)]">
                      {[1, 2, 3, 4, 5].map((n) => d.stars[n - 1] ? (
                        <motion.div key={n} initial={reduce ? false : { flexGrow: 0 }} animate={{ flexGrow: d.stars[n - 1] }} transition={{ duration: 0.7, delay: 0.1 * n }} style={{ flexBasis: 0, background: ["", "#e11d48", "#f97316", "#f59e0b", "#84cc16", "#10b981"][n] }} title={`${n}★ · ${d.stars[n - 1]}`} />
                      ) : null)}
                    </div>
                    <div className="flex justify-between mt-2 text-[10px] text-[var(--muted)]">
                      {[1, 2, 3, 4, 5].map((n) => <span key={n} className="flex items-center gap-0.5"><b className="text-[var(--heading)] tabular-nums">{d.stars[n - 1]}</b> {n}<Star className="w-2.5 h-2.5" style={{ color: n <= d.max_stars ? "#e11d48" : "#f59e0b", fill: n <= d.max_stars ? "#e11d48" : "#f59e0b" }} /></span>)}
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Complaints */}
              <motion.div {...fade(7)} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden">
                <div className="p-5 pb-3 flex flex-wrap items-center gap-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-[var(--heading)]">Negative reviews</h3>
                    <p className="text-[11px] text-[var(--muted)]">{listed.length === d.complaints_total ? `All ${d.complaints_total}` : `${listed.length} of ${d.complaints_total}`}{d.complaints_total > d.complaints.length ? ` · latest ${d.cap} loaded` : ""}</p>
                  </div>
                  <span className="flex-1" />
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order ID or words…" className={sel + " pl-8 w-56"} />
                  </div>
                </div>
                <div className="px-5 pb-3 flex flex-wrap items-center gap-1.5">
                  {d.reasons.filter((r) => r.count).map((r) => {
                    const t = TONE[r.key] || TONE.unspecified, on = pick === r.key;
                    return <button key={r.key} onClick={() => setPick(on ? null : r.key)} className="px-2.5 py-1 rounded-full text-[10px] font-extrabold border transition active:scale-95" style={on ? { background: t.c2, color: "#fff", borderColor: t.c2 } : { color: t.c2, borderColor: `color-mix(in srgb, ${t.c2} 35%, transparent)`, background: `color-mix(in srgb, ${t.c2} 9%, transparent)` }}>{r.label} · {r.count}</button>;
                  })}
                  {pick && <button onClick={() => setPick(null)} className="px-2 py-1 rounded-full text-[10px] font-bold text-[var(--muted)] hover:text-[var(--heading)] flex items-center gap-1"><X className="w-3 h-3" /> clear</button>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-[10px] uppercase tracking-wide text-[var(--muted)] border-y border-[var(--border)] bg-[var(--bg)]">
                      <th className="p-3 text-center w-10">#</th><th className="p-3 text-left">Date</th>{!branch && <th className="p-3 text-left">Branch</th>}<th className="p-3 text-left">Platform</th><th className="p-3 text-left">Order ID</th>
                      <th className="p-3 text-left">Rating</th><th className="p-3 text-left">Issue(s)</th><th className="p-3 text-left">Review text</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      <AnimatePresence initial={false}>
                        {listed.slice(0, shown).map((c, i) => {
                          const pt = PLATFORM_TONE[c.platform.toLowerCase()] || "#64748b";
                          return (
                            <motion.tr key={c.order_id + c.day + i} layout={false} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: Math.min(i, 12) * 0.03 }} className="hover:bg-[var(--surface-2)]/50 align-top">
                              <td className="p-3 text-center text-[var(--muted)] tabular-nums">{i + 1}</td>
                              <td className="p-3 whitespace-nowrap font-bold text-[var(--heading)]">{dmy(c.day)}</td>
                              {!branch && <td className="p-3 whitespace-nowrap text-[var(--text)]">{[c.brand, c.branch].filter(Boolean).join(" · ")}</td>}
                              <td className="p-3"><span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold" style={{ color: pt, background: `color-mix(in srgb, ${pt} 13%, transparent)` }}>{c.platform || "—"}</span></td>
                              <td className="p-3 font-mono text-[11px] text-[var(--muted)]">{c.order_id}</td>
                              <td className="p-3"><Stars n={c.rating} /></td>
                              <td className="p-3"><div className="flex flex-wrap gap-1">{keysOf(c).map((key) => { const t = TONE[key] || TONE.unspecified; return <span key={key} className="px-2 py-0.5 rounded-full text-[10px] font-extrabold whitespace-nowrap" style={{ color: t.c2, background: `color-mix(in srgb, ${t.c2} 13%, transparent)` }}>{key === "unspecified" ? "Unspecified" : c.reasons[c.reasons.findIndex((r) => KEY_OF_SHORT[r] === key)]}</span>; })}</div></td>
                              <td className="p-3 min-w-[18rem] text-[var(--text)] leading-relaxed" dir="auto">{c.text || <span className="text-[var(--muted)]">—</span>}</td>
                            </motion.tr>
                          );
                        })}
                      </AnimatePresence>
                      {!listed.length && <tr><td colSpan={8} className="p-8 text-center text-[var(--muted)]">No negative reviews match.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {listed.length > shown && (
                  <div className="p-4 text-center border-t border-[var(--border)]">
                    <button onClick={() => setShown((s) => s + 60)} className="px-5 py-2 rounded-xl text-xs font-extrabold border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--heading)] transition active:scale-95">Show more ({listed.length - shown} left)</button>
                  </div>
                )}
              </motion.div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The share of each named reason as a ring; hover or click a slice. The middle shows the negative reviews. */
function Donut({ reasons, total, complaints, reduce, pick, setPick }: { reasons: Reason[]; total: number; complaints: number; reduce: boolean; pick: string | null; setPick: (k: string | null) => void }) {
  const R = 62, C = 2 * Math.PI * R, GAP = 3;
  const [hover, setHover] = useState<string | null>(null);
  const live = reasons.filter((r) => r.count > 0);
  let acc = 0;
  const shownKey = hover || pick;
  const sel = live.find((r) => r.key === shownKey);
  const center = useCountUp(sel ? sel.count : complaints, 600);
  if (!total) return <div className="flex-1 flex items-center justify-center text-xs text-[var(--muted)] py-10">No named reasons yet — the negative reviews carry no comment.</div>;
  return (
    <div className="relative my-3">
      <svg viewBox="0 0 160 160" className="w-52 h-52 -rotate-90">
        <circle cx="80" cy="80" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="16" />
        {live.map((r, i) => {
          const len = Math.max(0, (r.count / total) * C - GAP), off = (acc / total) * C;
          acc += r.count;
          const t = TONE[r.key] || TONE.unspecified, dim = shownKey && shownKey !== r.key;
          return (
            <motion.circle key={r.key} cx="80" cy="80" r={R} fill="none" stroke={t.c2} strokeWidth={shownKey === r.key ? 20 : 16} strokeLinecap="butt"
              initial={reduce ? false : { strokeDasharray: `0 ${C}` }} animate={{ strokeDasharray: `${len} ${C - len}`, opacity: dim ? 0.3 : 1 }} transition={{ duration: 0.8, delay: 0.1 + i * 0.07, ease: "easeOut" }}
              strokeDashoffset={-off} style={{ cursor: "pointer", transition: "stroke-width .15s" }}
              onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)} onClick={() => setPick(pick === r.key ? null : r.key)} />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
        <span className="text-3xl font-extrabold text-[var(--heading)] tabular-nums">{center}</span>
        <span className="text-[10px] font-bold text-[var(--muted)] max-w-[7rem] leading-tight">{sel ? `${sel.label} · ${Math.round((sel.count / total) * 100)}% of named` : "negative reviews"}</span>
      </div>
    </div>
  );
}
