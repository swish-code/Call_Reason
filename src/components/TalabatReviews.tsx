import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import { Search, X, Download, Star, MessageSquareText, ThumbsDown, Loader2, Info, ChevronLeft, ChevronRight } from "lucide-react";

// Ratings & Reviews: Talabat's own "Ratings and reviews" report (one row per review), pulled every morning by the
// talabat-export tool for the day before and once more three days later. Read-only here — it does not create tasks
// in Ratings & Reviews.

interface Row { day: string; date: string; store: string; brand: string; vendor_id: string; order_id: string; rating: number; text: string }
interface DayInfo { report_day: string; review_count: number; uploaded_at: string }
interface Data { days: DayInfo[]; rows: Row[]; first_day: string | null; last_day: string | null }

const KW_MS = 3 * 3600_000;
const kwTime = (ts: string) => new Date(new Date(ts).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16);
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
const PAGE = 50;
const STAR_COLOR = ["", "#e11d48", "#f97316", "#f59e0b", "#84cc16", "#10b981"];
const inputCls = "px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs text-[var(--heading)] focus:outline-none focus:ring-2 focus:ring-[var(--t-orange)]";

const Stars = ({ n }: { n: number }) => (
  <span className="inline-flex items-center gap-0.5" title={`${n} of 5`} aria-label={`${n} of 5`}>
    {[1, 2, 3, 4, 5].map((i) => <Star key={i} className="w-3.5 h-3.5" style={{ color: i <= n ? STAR_COLOR[n] : "var(--border)", fill: i <= n ? STAR_COLOR[n] : "none" }} />)}
  </span>
);

export default function TalabatReviews({ initialDay }: { initialDay: string }) {
  const [from, setFrom] = useState(addDays(initialDay, -6));
  const [to, setTo] = useState(initialDay);
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [stars, setStars] = useState(0);        // 0 = all, 1..5 = that rating, -1 = 1 to 3
  const [textOnly, setTextOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(""); setGrown(false);
    apiFetch(`/api/talabat-reports/reviews?from=${from}&to=${to}`)
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Could not load the reviews."); return r.json(); })
      .then((x) => { if (alive) { setD(x); setTimeout(() => alive && setGrown(true), 60); } })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [from, to]);
  useEffect(() => { setPage(1); }, [q, brand, stars, textOnly, from, to]);

  const rows = d?.rows || [];
  const brands = useMemo(() => [...new Set(rows.map((r) => r.brand))].sort(), [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => (!brand || r.brand === brand)
      && (stars === 0 || (stars === -1 ? r.rating <= 3 : r.rating === stars))
      && (!textOnly || !!r.text)
      && (!needle || r.order_id.includes(needle) || r.store.toLowerCase().includes(needle) || r.text.toLowerCase().includes(needle)));
  }, [rows, q, brand, stars, textOnly]);

  // The totals follow the brand filter only, so the cards and the bars describe the brand being looked at.
  const base = useMemo(() => rows.filter((r) => !brand || r.brand === brand), [rows, brand]);
  const byRating = [1, 2, 3, 4, 5].map((n) => base.filter((r) => r.rating === n).length);
  const avg = base.length ? base.reduce((s, r) => s + r.rating, 0) / base.length : 0;
  const low = byRating[0] + byRating[1] + byRating[2];
  const withText = base.filter((r) => r.text).length;
  const maxBar = Math.max(1, ...byRating);
  const byBrand = useMemo(() => {
    const m = new Map<string, { brand: string; n: number; sum: number; low: number }>();
    for (const r of rows) { const g = m.get(r.brand) || { brand: r.brand, n: 0, sum: 0, low: 0 }; g.n++; g.sum += r.rating; if (r.rating <= 3) g.low++; m.set(r.brand, g); }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [rows]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const paged = shown.slice((page - 1) * PAGE, page * PAGE);
  const lastUpload = d?.days.length ? d.days.map((x) => x.uploaded_at).sort().slice(-1)[0] : null;
  const missing = useMemo(() => {
    if (!d) return [];
    const have = new Set(d.days.map((x) => x.report_day));
    const out: string[] = [];
    for (let day = from; day <= to && out.length < 40; day = addDays(day, 1)) if (!have.has(day)) out.push(day);
    return out;
  }, [d, from, to]);

  const exportRows = () => downloadCSV(
    ["Date", "Restaurant name", "Brand", "Vendor ID", "Order ID", "Rating", "Review text"], shown.map((r) => [r.date, r.store, r.brand, r.vendor_id, r.order_id, String(r.rating), r.text]),
    `talabat-ratings-reviews_${from}_${to}.csv`);

  const Card = ({ label, value, sub, icon: Icon, color, i }: { label: string; value: string; sub?: string; icon: any; color: string; i: number }) => (
    <div className="bg-[var(--surface)] p-4 border border-[var(--border)] shadow-lg rounded-2xl flex items-center gap-3 transition-all duration-500"
      style={{ opacity: grown ? 1 : 0, transform: grown ? "none" : "translateY(8px)", transitionDelay: `${i * 60}ms` }}>
      <div className="p-2.5 rounded-xl shrink-0" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}><Icon className="w-5 h-5" style={{ color }} /></div>
      <div className="min-w-0">
        <p className="text-[10px] text-[var(--muted)] font-bold uppercase leading-tight">{label}</p>
        <h3 className="text-xl font-extrabold text-[var(--heading)] tracking-tight tabular-nums">{value}</h3>
        {sub && <p className="text-[10px] text-[var(--muted)] leading-tight">{sub}</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="bg-[var(--surface)] p-4 border border-[var(--border)] shadow-lg rounded-2xl flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">From<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={inputCls} /></label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">To<input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={inputCls} /></label>
        <div className="flex gap-1">
          {([["Day", 0], ["7 days", 6], ["30 days", 29]] as const).map(([label, back]) => (
            <button key={label} onClick={() => setFrom(addDays(to, -back))}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition ${from === addDays(to, -back) ? "text-white border-transparent" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--heading)]"}`}
              style={from === addDays(to, -back) ? { background: "var(--t-orange)" } : undefined}>{label}</button>
          ))}
        </div>
        <p className="ml-auto text-[10px] text-[var(--muted)] flex items-center gap-1.5 max-w-md">
          <Info className="w-3.5 h-3.5 shrink-0" />
          Talabat's own Ratings and reviews report, by the date Talabat gives each review. {lastUpload ? `Last pulled ${kwTime(lastUpload)} (Kuwait).` : ""} Talabat gives no customer phone number in it.
        </p>
      </div>

      {loading ? (
        <div className="py-16 flex items-center justify-center text-xs text-[var(--muted)] gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading the reviews…</div>
      ) : error ? (
        <div className="p-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 text-rose-500 text-xs font-bold">{error}</div>
      ) : !d || !d.days.length ? (
        <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--muted)] text-center">
          No Ratings and reviews report has arrived for these days yet.
          {d?.last_day ? <> The newest day received is <span className="font-bold text-[var(--heading)]">{d.last_day}</span>.</> : <> The daily pull on the office PC sends it every morning once it has been updated.</>}
        </div>
      ) : (
        <>
          {missing.length > 0 && (
            <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-500 text-xs">
              ⚠ No report received for {missing.length} day{missing.length > 1 ? "s" : ""} of this period: {missing.slice(0, 8).join(", ")}{missing.length > 8 ? "…" : ""}. The numbers below cover the other days only.
            </div>
          )}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <Card i={0} label="Reviews" value={base.length.toLocaleString()} sub={`${d.days.length} day${d.days.length > 1 ? "s" : ""}${brand ? ` · ${brand}` : ""}`} icon={Star} color="var(--t-orange)" />
            <Card i={1} label="Average rating" value={base.length ? avg.toFixed(2) : "–"} sub="out of 5" icon={Star} color="#f59e0b" />
            <Card i={2} label="1 to 3 stars" value={low.toLocaleString()} sub={base.length ? `${Math.round((low / base.length) * 100)}% of the reviews` : undefined} icon={ThumbsDown} color="#e11d48" />
            <Card i={3} label="With a comment" value={withText.toLocaleString()} sub={base.length ? `${Math.round((withText / base.length) * 100)}% of the reviews` : undefined} icon={MessageSquareText} color="#0ea5e9" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl">
              <h3 className="text-sm font-bold text-[var(--heading)] mb-3">Ratings{brand ? ` — ${brand}` : ""}</h3>
              <div className="space-y-2">
                {[5, 4, 3, 2, 1].map((n) => (
                  <button key={n} onClick={() => setStars(stars === n ? 0 : n)} title="Show these reviews"
                    className={`w-full grid grid-cols-[5.5rem_1fr_3rem] items-center gap-3 px-2 py-1 rounded-lg transition ${stars === n ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]"}`}>
                    <Stars n={n} />
                    <span className="h-3 rounded-full bg-[var(--surface-2)] overflow-hidden">
                      <span className="block h-full rounded-full transition-all duration-700 ease-out" style={{ width: grown ? `${(byRating[n - 1] / maxBar) * 100}%` : "0%", background: STAR_COLOR[n] }} />
                    </span>
                    <span className="text-xs font-bold tabular-nums text-right text-[var(--heading)]">{byRating[n - 1]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl">
              <h3 className="text-sm font-bold text-[var(--heading)] mb-3">By brand</h3>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]"><th className="text-left py-2 px-2">Brand</th><th className="text-center py-2 px-2">Reviews</th><th className="text-center py-2 px-2">Average</th><th className="text-center py-2 px-2">1 to 3 stars</th></tr></thead>
                  <tbody>
                    {byBrand.map((b) => (
                      <tr key={b.brand} onClick={() => setBrand(brand === b.brand ? "" : b.brand)} className={`border-b border-[var(--border)] cursor-pointer transition ${brand === b.brand ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]"}`}>
                        <td className="py-2 px-2 font-bold text-[var(--heading)]">{b.brand}</td>
                        <td className="py-2 px-2 text-center tabular-nums">{b.n}</td>
                        <td className="py-2 px-2 text-center tabular-nums font-bold" style={{ color: STAR_COLOR[Math.max(1, Math.round(b.sum / b.n))] }}>{(b.sum / b.n).toFixed(2)}</td>
                        <td className="py-2 px-2 text-center tabular-nums text-rose-500">{b.low || "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order ID, restaurant or words in the review" className={`${inputCls} pl-8 w-72`} />
                {q && <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-label="Clear"><X className="w-3.5 h-3.5" /></button>}
              </div>
              <select value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls}><option value="">All brands</option>{brands.map((b) => <option key={b}>{b}</option>)}</select>
              <select value={stars} onChange={(e) => setStars(Number(e.target.value))} className={inputCls}>
                <option value={0}>All ratings</option><option value={-1}>1 to 3 stars</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} star{n > 1 ? "s" : ""}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-[var(--muted)] font-bold cursor-pointer"><input type="checkbox" checked={textOnly} onChange={(e) => setTextOnly(e.target.checked)} /> With a comment only</label>
              <span className="text-xs text-[var(--muted)] ml-auto tabular-nums">{shown.length.toLocaleString()} of {rows.length.toLocaleString()}</span>
              <button onClick={exportRows} disabled={!shown.length} className="px-3 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40 flex items-center gap-1.5 transition active:scale-95" style={{ background: "var(--t-orange)" }}>
                <Download className="w-3.5 h-3.5" /> Export listed
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                  <th className="text-left py-2 px-2">Date</th><th className="text-left py-2 px-2">Restaurant</th><th className="text-left py-2 px-2">Order ID</th><th className="text-left py-2 px-2">Rating</th><th className="text-left py-2 px-2">Review</th>
                </tr></thead>
                <tbody>
                  {!paged.length && <tr><td colSpan={5} className="py-6 text-center text-[var(--muted)]">No reviews match.</td></tr>}
                  {paged.map((r, i) => (
                    <tr key={`${r.order_id}-${r.day}-${i}`} className="border-b border-[var(--border)] align-top hover:bg-[var(--surface-2)] transition">
                      <td className="py-2 px-2 tabular-nums whitespace-nowrap">{r.date}</td>
                      <td className="py-2 px-2"><div className="font-bold text-[var(--heading)]">{r.store}</div><div className="text-[10px] text-[var(--muted)]">{r.brand}</div></td>
                      <td className="py-2 px-2 font-mono">{r.order_id}</td>
                      <td className="py-2 px-2 whitespace-nowrap"><Stars n={r.rating} /></td>
                      <td className="py-2 px-2 max-w-xl" dir="auto">{r.text || <span className="text-[var(--muted)]">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 mt-3 text-xs text-[var(--muted)]">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="p-1.5 rounded-lg border border-[var(--border)] disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
                <span className="tabular-nums">Page {page} of {pages}</span>
                <button onClick={() => setPage(Math.min(pages, page + 1))} disabled={page === pages} className="p-1.5 rounded-lg border border-[var(--border)] disabled:opacity-40" aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
