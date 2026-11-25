import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { downloadXlsx } from "../lib/xlsx.ts";
import { Store, RefreshCw, Download, AlertCircle, Loader2, Star } from "lucide-react";

// Ratings & Reviews → Branch report: pick a period, a brand and a branch and get that branch's numbers, what its
// complaints are about (with a chart) and the latest complaints themselves, against all branches together.
// A complaint is a 1-2 star review (1-3 on request); the reasons are read from the review's words.

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
const inputCls = "px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs text-[var(--heading)] focus:outline-none focus:ring-2 focus:ring-blue-500";
const NAVY = "#1f3864";

export default function BranchReport() {
  const [opts, setOpts] = useState<Opts>({ brands: [] });
  const [from, setFrom] = useState(() => addDays(kwToday(), -29));
  const [to, setTo] = useState(kwToday);
  const [brandId, setBrandId] = useState("");
  const [branch, setBranch] = useState("");
  const [maxStars, setMaxStars] = useState<2 | 3>(2);
  const [d, setD] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/ratings/branch-options").then((r) => (r.ok ? r.json() : { brands: [] })).then(setOpts).catch(() => {});
  }, []);
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

  const preset = (days: number) => { setTo(kwToday()); setFrom(addDays(kwToday(), -(days - 1))); };
  const monthStart = () => { setTo(kwToday()); setFrom(kwToday().slice(0, 8) + "01"); };
  const scopeName = [opts.brands.find((b) => b.id === brandId)?.name, branch].filter(Boolean).join(" - ") || "All brands";

  const exportXlsx = async () => {
    if (!d) return;
    await downloadXlsx(["#", "Date", "Brand", "Branch", "Platform", "Order ID", "Rating", "Issue(s)", "Review text"],
      d.complaints.map((c, i) => [i + 1, dmy(c.day), c.brand, c.branch, c.platform, c.order_id, c.rating, c.reasons.join(", ") || "Unspecified", c.text]),
      `complaints-${scopeName.replace(/[^a-z0-9]+/gi, "-")}-${from}_${to}.xlsx`, "Complaints");
  };

  const maxBar = Math.max(1, ...(d?.reasons || []).map((r) => r.count));
  const k = d?.kpi;
  const cell = "px-4 py-3 text-center";

  return (
    <div className="space-y-5 text-[var(--text)]">
      {/* Filters */}
      <div className="bg-[var(--surface)] border border-[var(--border)] shadow-lg rounded-3xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-[var(--heading)] font-extrabold text-sm mr-2"><Store className="w-5 h-5 text-blue-400" /> Branch report</div>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">Brand
          <select value={brandId} onChange={(e) => { setBrandId(e.target.value); setBranch(""); }} className={inputCls + " min-w-[11rem]"}>
            <option value="">All brands</option>
            {opts.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">Branch
          <select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!brandId} className={inputCls + " min-w-[12rem] disabled:opacity-50"}>
            <option value="">{brandId ? "All branches of the brand" : "Pick a brand first"}</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">From
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">To
          <input type="date" value={to} min={from} max={kwToday()} onChange={(e) => e.target.value && setTo(e.target.value)} className={inputCls} />
        </label>
        <div className="flex rounded-xl bg-[var(--bg)] border border-[var(--border)] p-0.5 text-[11px] font-bold">
          {([["7 days", () => preset(7)], ["30 days", () => preset(30)], ["This month", monthStart]] as [string, () => void][]).map(([l, f]) => (
            <button key={l} onClick={f} className="px-3 py-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--heading)] transition">{l}</button>
          ))}
        </div>
        <div className="flex rounded-xl bg-[var(--bg)] border border-[var(--border)] p-0.5 text-[11px] font-bold" title="Which reviews count as a complaint">
          {([[2, "Complaint = 1–2 ★"], [3, "1–3 ★"]] as const).map(([n, l]) => (
            <button key={n} onClick={() => setMaxStars(n)} className={`px-3 py-1.5 rounded-lg transition ${maxStars === n ? "bg-blue-600 text-white" : "text-[var(--muted)] hover:text-[var(--heading)]"}`}>{l}</button>
          ))}
        </div>
        <span className="flex-1" />
        <button onClick={load} className="p-2.5 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--muted)]" title="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
        <button onClick={exportXlsx} disabled={!d || !d.complaints.length} className="px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white flex items-center gap-1.5"><Download className="w-4 h-4" /> Export complaints</button>
      </div>

      {error && <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-2xl text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>}
      {loading && !d && <div className="flex items-center justify-center h-40"><Loader2 className="w-7 h-7 animate-spin text-blue-400" /></div>}

      {d && k && (
        <div className={`space-y-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {/* Headline numbers, like the branch sheet */}
          <div className="rounded-2xl overflow-hidden border border-[var(--border)] shadow-lg">
            <div className="px-5 py-2.5 text-white text-sm font-extrabold" style={{ background: NAVY }}>{scopeName} <span className="font-normal opacity-80">· {dmy(d.range.from)} to {dmy(d.range.to)}</span></div>
            <div className="grid grid-cols-2 md:grid-cols-6 text-[10px] font-extrabold tracking-wide text-white text-center" style={{ background: NAVY }}>
              {["REVIEWS", "AVG RATING", "COMPLAINTS", "COMPLAINT RATE", "MAIN ISSUE", "STATUS"].map((h) => <div key={h} className="py-2.5 border-t border-white/10">{h}</div>)}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 bg-[var(--surface)] text-xl font-extrabold">
              <div className={cell} style={{ color: NAVY }}>{k.reviews.toLocaleString()}</div>
              <div className={cell} style={{ color: NAVY }}>{k.reviews ? k.avg.toFixed(2) : "—"}</div>
              <div className={cell} style={{ color: NAVY }}>{k.complaints.toLocaleString()}</div>
              <div className={cell} style={{ color: NAVY }}>{k.reviews ? `${k.complaint_rate.toFixed(1)}%` : "—"}</div>
              <div className={cell} style={{ color: NAVY }}>{k.main_issue}</div>
              <div className={cell + " tracking-wide"} style={{ background: k.status === "ACTION" ? "#f8cbad" : "#c6efce", color: k.status === "ACTION" ? "#c00000" : "#006100" }}>{k.reviews ? k.status : "—"}</div>
            </div>
            <div className="px-5 py-2 text-[11px] italic text-[var(--muted)] bg-[var(--surface)] border-t border-[var(--border)]">
              All branches, same period: average rating {d.company.avg.toFixed(2)} | complaint rate {d.company.complaint_rate.toFixed(1)}% ({d.company.complaints.toLocaleString()} of {d.company.reviews.toLocaleString()} reviews).
              A complaint is a 1–{d.max_stars} star review; <b>ACTION</b> = this branch's complaint rate is above the all-branch rate.
            </div>
          </div>

          {k.reviews === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--muted)] bg-[var(--surface)] border border-[var(--border)] rounded-2xl">No reviews for {scopeName} in these dates.</div>
          ) : (
            <>
              {/* Complaint reasons: table + chart */}
              <div>
                <h3 className="text-sm font-extrabold mb-2" style={{ color: NAVY }}>Complaint reasons</h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div className="rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--surface)]">
                    <table className="w-full text-xs">
                      <thead><tr className="text-white font-extrabold" style={{ background: NAVY }}>
                        <th className="text-left p-3">Issue</th><th className="p-3 text-center">Count</th><th className="p-3 text-center">% of branch complaints</th><th className="p-3 text-center">% of all-branch complaints</th>
                      </tr></thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {d.reasons.map((r) => (
                          <tr key={r.key}><td className="p-3 font-bold text-[var(--heading)]">{r.label}</td><td className="p-3 text-center font-mono">{r.count}</td><td className="p-3 text-center font-mono">{r.pct_branch}%</td><td className="p-3 text-center font-mono text-[var(--muted)]">{r.pct_all}%</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-xs font-extrabold text-center text-[var(--heading)] mb-3">Complaints by reason</p>
                    <div className="space-y-2">
                      {d.reasons.map((r) => (
                        <div key={r.key} className="flex items-center gap-3 text-[11px]">
                          <span className="w-40 text-right text-[var(--text)] shrink-0">{r.label}</span>
                          <div className="flex-1 h-5 border-l border-[var(--border)]">
                            <div className="h-full rounded-r-sm transition-all duration-700" style={{ width: `${(r.count / maxBar) * 100}%`, background: "#c00000", minWidth: r.count ? 3 : 0 }} />
                          </div>
                          <span className="w-8 font-bold text-[var(--heading)]">{r.count}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-[var(--muted)] mt-3">A review can name more than one reason, so the counts can add up to more than the complaints.</p>
                  </div>
                </div>
              </div>

              {/* Ratings split */}
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-bold text-[var(--muted)] mr-1">Ratings:</span>
                {[5, 4, 3, 2, 1].map((n) => (
                  <span key={n} className="px-2.5 py-1 rounded-full bg-[var(--surface-2)] flex items-center gap-1"><b className="text-[var(--heading)]">{d.stars[n - 1]}</b> <Star className="w-3 h-3" style={{ color: n <= d.max_stars ? "#e11d48" : "#f59e0b", fill: n <= d.max_stars ? "#e11d48" : "#f59e0b" }} />{n}</span>
                ))}
              </div>

              {/* Latest complaints */}
              <div>
                <h3 className="text-sm font-extrabold mb-2" style={{ color: NAVY }}>Latest complaints (showing {d.complaints.length} of {d.complaints_total})</h3>
                <div className="rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-white font-extrabold" style={{ background: NAVY }}>
                      <th className="p-3 text-center w-10">#</th><th className="p-3 text-left">Date</th>{!branch && <th className="p-3 text-left">Branch</th>}<th className="p-3 text-left">Platform</th><th className="p-3 text-left">Order ID</th>
                      <th className="p-3 text-center">Rating</th><th className="p-3 text-left">Issue(s)</th><th className="p-3 text-left">Review text</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {d.complaints.map((c, i) => (
                        <tr key={c.order_id + i} className="hover:bg-[var(--surface-2)]/40 align-top">
                          <td className="p-3 text-center text-[var(--muted)]">{i + 1}</td>
                          <td className="p-3 whitespace-nowrap">{dmy(c.day)}</td>
                          {!branch && <td className="p-3 whitespace-nowrap">{[c.brand, c.branch].filter(Boolean).join(" · ")}</td>}
                          <td className="p-3">{c.platform}</td>
                          <td className="p-3 font-mono text-[11px]">{c.order_id}</td>
                          <td className="p-3 text-center font-bold">{c.rating}</td>
                          <td className="p-3">{c.reasons.length ? c.reasons.join(", ") : <span className="text-[var(--muted)]">Unspecified</span>}</td>
                          <td className="p-3 min-w-[16rem]" dir="auto">{c.text || <span className="text-[var(--muted)]">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.complaints_total > d.complaints.length && <p className="text-[11px] text-[var(--muted)] mt-2">Showing the latest {d.cap}. Export complaints gives the same list; pick a shorter period to see the rest.</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
