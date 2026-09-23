import { useEffect, useState } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { ClipboardList, CheckCircle2, AlertCircle, Users, Filter, X, PhoneCall, Megaphone, ThumbsUp } from "lucide-react";

interface Props { currentUser: User; }
type NC = { name: string; count: number };

interface SurveysData {
  campaigns: { total: number; byStatus: NC[] };
  assignments: { total: number; successful: number; successRate: number; byStatus: NC[] };
  records: { total: number; answered: number; noAnswer: number; byType: NC[]; byBrand: NC[];
    byAgent: { name: string; count: number; answered: number; avg: number }[] };
  topAgents: { name: string; successful: number }[];
}

const surveyStatusLabel = (s: string) =>
  s === 'successful' ? 'Successful' : s === 'in_progress' ? 'In Progress' : s === 'no_answer' ? 'No Answer'
  : s === 'unreachable' ? 'Unreachable' : s === 'declined' ? 'Declined' : s === 'full_today' ? 'Full Today'
  : s === 'active' ? 'Active' : s === 'completed' ? 'Completed' : s === 'cancelled' ? 'Cancelled' : 'Pending';

export default function SurveysDashboard({ currentUser }: Props) {
  const [s, setS] = useState<SurveysData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [activePeriod, setActivePeriod] = useState<"today" | "week" | "month" | "">("");

  const kwToday = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const kwWeekStart = () => { const k = new Date(Date.now() + 3 * 3600 * 1000); k.setUTCDate(k.getUTCDate() - k.getUTCDay()); return k.toISOString().slice(0, 10); };
  const kwMonthStart = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 7) + "-01";

  const load = async (f = from, t = to) => {
    try {
      setLoading(true); setError("");
      const qs = new URLSearchParams();
      if (f) qs.set("from", f);
      if (t) qs.set("to", t);
      const res = await apiFetch(`/api/feedback/dashboard${qs.toString() ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to load dashboard.");
      const data = await res.json();
      setS(data.surveys);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load("", ""); }, []);

  const applyPeriod = (p: "today" | "week" | "month") => {
    const today = kwToday();
    const f = p === "today" ? today : p === "week" ? kwWeekStart() : kwMonthStart();
    setFrom(f); setTo(today); setActivePeriod(p); load(f, today);
  };
  const clearFilter = () => { setFrom(""); setTo(""); setActivePeriod(""); load("", ""); };

  if (loading && !s) return <div className="flex flex-col items-center justify-center min-h-[400px]"><div className="w-12 h-12 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" /><p className="mt-4 text-[var(--muted)]">Loading dashboard…</p></div>;
  if (error) return <div className="p-6 bg-rose-950/20 border border-rose-500/30 rounded-2xl text-center text-rose-300"><AlertCircle className="w-10 h-10 mx-auto text-rose-500" /><p className="mt-2 text-sm">{error}</p></div>;
  if (!s) return null;

  const Card = ({ label, value, icon: Icon, tone }: { label: string; value: any; icon: any; tone: string }) => (
    <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl flex items-center gap-4">
      <div className={`p-3 rounded-xl bg-current/10 ${tone}`}><Icon className={`w-6 h-6 ${tone}`} /></div>
      <div>
        <p className="text-[10px] text-[var(--muted)] font-bold uppercase">{label}</p>
        <h3 className="text-2xl font-bold text-[var(--heading)] tracking-tight font-mono">{value}</h3>
      </div>
    </div>
  );

  const Bar = ({ title, data, color, icon: Icon, label }: { title: string; data: NC[]; color: string; icon: any; label?: (s: string) => string }) => {
    const total = data.reduce((a, c) => a + c.count, 0) || 1;
    return (
      <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
        <h3 className="text-sm font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><Icon className="w-4 h-4 text-violet-400" /> {title}</h3>
        <div className="space-y-3">
          {data.map((x) => {
            const pct = Math.round((x.count / total) * 100);
            return (
              <div key={x.name} className="space-y-1">
                <div className="flex justify-between items-center text-xs font-bold"><span className="text-[var(--heading)] truncate pr-2">{label ? label(x.name) : x.name}</span><span className="text-[var(--muted)] font-mono shrink-0">{x.count}</span></div>
                <div className="w-full bg-[var(--surface-2)] border border-[var(--border)]/60 h-2 rounded-full overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
          {data.length === 0 && <div className="text-center py-6 text-[var(--muted)] text-xs">No data yet.</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-fade-in text-[var(--text)]">
      {/* Banner */}
      <div className="bg-gradient-to-r from-[var(--surface)] via-[var(--surface-2)] to-[var(--bg)] border border-[var(--border)] p-6 md:p-8 rounded-3xl shadow-xl">
        <span className="bg-violet-950/45 text-violet-400 text-xs font-bold px-3 py-1 rounded-full border border-violet-500/30">Survey Analytics</span>
        <h1 className="text-2xl md:text-3xl font-extrabold text-[var(--heading)] tracking-tight mt-2">Surveys Dashboard</h1>
        <p className="text-[var(--muted)] text-sm mt-1 font-light">Campaign, call and record performance across all surveys</p>
      </div>

      {/* Date filter */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-lg flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-[var(--heading)] font-bold text-sm mr-1"><Filter className="w-4 h-4 text-violet-400" /> Filter by date</div>
        {(["today", "week", "month"] as const).map((p) => (
          <button key={p} onClick={() => applyPeriod(p)}
            className={`px-3 py-2 text-xs font-bold rounded-xl border transition active:scale-95 ${activePeriod === p ? "bg-violet-600 text-white border-violet-600" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)] hover:border-violet-500/40"}`}>
            {p === "today" ? "Today" : p === "week" ? "This Week" : "This Month"}
          </button>
        ))}
        <div className="w-px h-6 bg-[var(--border)] mx-1 self-center" />
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">From</label>
          <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setActivePeriod(""); }} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-violet-500 focus:outline-none" />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">To</label>
          <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setActivePeriod(""); }} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-violet-500 focus:outline-none" />
        </div>
        <button onClick={() => load()} disabled={loading} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" /> Apply</button>
        {(from || to) && <button onClick={clearFilter} className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:text-rose-400 font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Clear</button>}
        {(from || to) && <span className="text-[11px] text-[var(--muted)] font-medium ml-auto">Showing {from || "start"} → {to || "today"}</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card label="Campaigns" value={s.campaigns.total} icon={Megaphone} tone="text-violet-400" />
        <Card label="Numbers" value={s.assignments.total} icon={PhoneCall} tone="text-blue-400" />
        <Card label="Successful" value={s.assignments.successful} icon={CheckCircle2} tone="text-emerald-400" />
        <Card label="Success Rate" value={`${s.assignments.successRate}%`} icon={ThumbsUp} tone="text-emerald-400" />
        <Card label="Records" value={s.records.total} icon={ClipboardList} tone="text-sky-400" />
        <Card label="Answered" value={s.records.answered} icon={CheckCircle2} tone="text-emerald-400" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Bar title="Campaigns by Status" data={s.campaigns.byStatus} color="bg-violet-500" icon={Megaphone} label={surveyStatusLabel} />
        <Bar title="Call Numbers by Status" data={s.assignments.byStatus} color="bg-blue-500" icon={PhoneCall} label={surveyStatusLabel} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Bar title="Survey Records by Type" data={s.records.byType} color="bg-sky-500" icon={ClipboardList} />
        <Bar title="Survey Records by Brand" data={s.records.byBrand} color="bg-emerald-500" icon={Megaphone} />
      </div>
      <Bar title="Top Survey Agents (successful calls)" data={s.topAgents.map((a) => ({ name: a.name, count: a.successful }))} color="bg-violet-500" icon={Users} />

      {/* Survey records per employee (Served By) — includes historical imports */}
      <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
        <h3 className="text-sm font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><Users className="w-4 h-4 text-violet-400" /> Survey Records by Employee (Served By)</h3>
        {(!s.records.byAgent || s.records.byAgent.length === 0) ? <div className="text-center py-6 text-[var(--muted)] text-xs">No survey records yet.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                <th className="text-left py-2 px-2">Employee</th>
                <th className="text-center py-2 px-2">Records</th>
                <th className="text-center py-2 px-2">Answered</th>
                <th className="text-center py-2 px-2">Avg Rate</th>
              </tr></thead>
              <tbody>
                {s.records.byAgent.map((a) => (
                  <tr key={a.name} className="border-b border-[var(--border)]/40 last:border-0 hover:bg-[var(--surface-2)]/30 transition">
                    <td className="py-2 px-2 font-bold text-[var(--heading)]">{a.name}</td>
                    <td className="py-2 px-2 text-center font-mono text-blue-400">{a.count}</td>
                    <td className="py-2 px-2 text-center font-mono text-emerald-400">{a.answered}</td>
                    <td className="py-2 px-2 text-center font-mono text-amber-400">{a.avg ? a.avg.toFixed(1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
