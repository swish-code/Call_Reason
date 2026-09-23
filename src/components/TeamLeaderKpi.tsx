import React, { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { Crown, ListChecks, Hourglass, Timer, Users2, ChevronRight, Filter, X, Download, AlertCircle, UserCog } from "lucide-react";

interface Props { currentUser: User; }

interface MemberStat { id: string; full_name: string; assigned: number; completed: number; pending: number; avgDurationSeconds: number; }
interface LeaderStat extends MemberStat { department: string | null; team: MemberStat[]; }
interface KpiData {
  summary: { totalLeaders: number; totalAssigned: number; totalCompleted: number; totalPending: number; avgDurationSeconds: number };
  leaders: LeaderStat[];
}

export default function TeamLeaderKpi({ currentUser }: Props) {
  const [d, setD] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [activePeriod, setActivePeriod] = useState<"today" | "week" | "month" | "">("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const kwToday = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const kwWeekStart = () => { const kw = new Date(Date.now() + 3 * 60 * 60 * 1000); kw.setUTCDate(kw.getUTCDate() - kw.getUTCDay()); return kw.toISOString().slice(0, 10); };
  const kwMonthStart = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 7) + "-01";

  const load = async (f = from, t = to) => {
    try {
      setLoading(true); setError("");
      const qs = new URLSearchParams();
      if (f) qs.set("from", f);
      if (t) qs.set("to", t);
      const res = await apiFetch(`/api/reports/team-leader-kpi${qs.toString() ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to load Team Leader KPIs.");
      setD(await res.json());
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  useEffect(() => { load("", ""); }, []);

  const applyPeriod = (p: "today" | "week" | "month") => {
    const today = kwToday();
    const f = p === "today" ? today : p === "week" ? kwWeekStart() : kwMonthStart();
    setFrom(f); setTo(today); setActivePeriod(p);
    load(f, today);
  };
  const clearFilter = () => { setFrom(""); setTo(""); setActivePeriod(""); load("", ""); };

  const fmtDur = (s: number) => {
    if (!s) return "—";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : `${s}s`;
  };

  const exportExcel = () => {
    if (!d) return;
    const wb = XLSX.utils.book_new();
    const rangeLabel = (from || to) ? `${from || "start"} -> ${to || "today"}` : "All time";
    const summary = [
      ["Team Leader KPI Export"],
      ["Filter range", rangeLabel],
      ["Generated", new Date().toLocaleString()],
      [],
      ["Metric", "Value"],
      ["Team Leaders", d.summary.totalLeaders],
      ["Tasks Assigned", d.summary.totalAssigned],
      ["Tasks Completed", d.summary.totalCompleted],
      ["Tasks Pending", d.summary.totalPending],
      ["Avg Completion Time", fmtDur(d.summary.avgDurationSeconds)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

    const header = ["Team Leader", "Department", "Assigned", "Completed", "Pending", "Avg Time", "Agent", "Agent Assigned", "Agent Completed", "Agent Pending", "Agent Avg Time"];
    const rows: any[][] = [];
    d.leaders.forEach((l) => {
      if (l.team.length === 0) {
        rows.push([l.full_name, l.department || "", l.assigned, l.completed, l.pending, fmtDur(l.avgDurationSeconds), "", "", "", "", ""]);
      } else {
        l.team.forEach((m, i) => {
          rows.push([
            i === 0 ? l.full_name : "", i === 0 ? (l.department || "") : "", i === 0 ? l.assigned : "", i === 0 ? l.completed : "", i === 0 ? l.pending : "", i === 0 ? fmtDur(l.avgDurationSeconds) : "",
            m.full_name, m.assigned, m.completed, m.pending, fmtDur(m.avgDurationSeconds),
          ]);
        });
      }
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), "Team Leaders");
    XLSX.writeFile(wb, `team_leader_kpi_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (loading && !d) return <div className="flex flex-col items-center justify-center min-h-[400px]"><div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div><p className="mt-4 text-[var(--muted)]">Loading Team Leader KPIs...</p></div>;
  if (error) return <div className="p-6 bg-rose-950/20 border border-rose-500/30 rounded-2xl text-center text-rose-300"><AlertCircle className="w-10 h-10 mx-auto text-rose-500" /><p className="mt-2 text-sm">{error}</p></div>;
  if (!d) return null;

  const s = d.summary;
  const ranked = [...d.leaders].sort((a, b) => b.completed - a.completed);
  const maxCompleted = Math.max(...ranked.map((l) => l.completed), 1);

  const Card = ({ label, value, icon: Icon, tone }: { label: string; value: any; icon: any; tone: string }) => (
    <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl flex items-center gap-4">
      <div className={`p-3 rounded-xl bg-opacity-10 ${tone} bg-current/10`}><Icon className={`w-6 h-6 ${tone}`} /></div>
      <div>
        <p className="text-[10px] text-[var(--muted)] font-bold uppercase">{label}</p>
        <h3 className="text-2xl font-bold text-[var(--heading)] tracking-tight font-mono">{value}</h3>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 animate-fade-in text-[var(--text)]">
      {/* Banner */}
      <div className="bg-gradient-to-r from-[var(--surface)] via-[var(--surface-2)] to-[var(--bg)] border border-[var(--border)] p-6 md:p-8 rounded-3xl shadow-xl">
        <span className="bg-amber-950/40 text-amber-400 text-xs font-bold px-3 py-1 rounded-full border border-amber-500/30">Leadership</span>
        <h1 className="text-2xl md:text-3xl font-extrabold text-[var(--heading)] tracking-tight mt-2">Team Leader KPI</h1>
        <p className="text-[var(--muted)] text-sm mt-1 font-light">How much every Team Leader has executed, and who's on their team.</p>
      </div>

      {/* Date-range filter */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-lg flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-[var(--heading)] font-bold text-sm mr-1"><Filter className="w-4 h-4 text-amber-400" /> Filter by date</div>
        {(["today", "week", "month"] as const).map((p) => (
          <button key={p} onClick={() => applyPeriod(p)}
            className={`px-3 py-2 text-xs font-bold rounded-xl border transition active:scale-95 ${activePeriod === p ? "bg-amber-600 text-white border-amber-600" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)] hover:border-amber-500/40"}`}>
            {p === "today" ? "Today" : p === "week" ? "This Week" : "This Month"}
          </button>
        ))}
        <div className="w-px h-6 bg-[var(--border)] mx-1 self-center" />
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">From</label>
          <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setActivePeriod(""); }} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none" />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">To</label>
          <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setActivePeriod(""); }} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none" />
        </div>
        <button onClick={() => load()} disabled={loading} className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" /> Apply</button>
        <button onClick={exportExcel} disabled={loading} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Export Excel</button>
        {(from || to) && <button onClick={clearFilter} className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:text-rose-400 font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Clear</button>}
        {(from || to) && <span className="text-[11px] text-[var(--muted)] font-medium ml-auto">Showing {from || "start"} → {to || "today"}</span>}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="Team Leaders" value={s.totalLeaders} icon={Crown} tone="text-amber-400" />
        <Card label="Tasks Completed" value={s.totalCompleted} icon={ListChecks} tone="text-emerald-400" />
        <Card label="Tasks Pending" value={s.totalPending} icon={Hourglass} tone="text-blue-400" />
        <Card label="Avg Completion Time" value={fmtDur(s.avgDurationSeconds)} icon={Timer} tone="text-sky-400" />
      </div>

      {/* Ranked list */}
      <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
        <h2 className="text-md font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><Crown className="w-5 h-5 text-amber-400" /> Tasks Completed by Team Leader</h2>
        <div className="space-y-3">
          {ranked.map((l, i) => (
            <div key={l.id} className="flex items-center gap-3">
              <span className="w-5 text-[11px] font-mono text-[var(--muted)] text-right shrink-0">{i + 1}</span>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between items-center text-xs font-bold"><span className="text-[var(--heading)] truncate pr-2">{l.full_name}</span><span className="text-[var(--muted)] font-mono shrink-0">{l.completed}</span></div>
                <div className="w-full bg-[var(--surface-2)] border border-[var(--border)]/60 h-2 rounded-full overflow-hidden"><div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.round((l.completed / maxCompleted) * 100)}%` }}></div></div>
              </div>
            </div>
          ))}
          {ranked.length === 0 && <div className="text-center py-6 text-[var(--muted)] text-xs">No Team Leaders yet.</div>}
        </div>
      </div>

      {/* Team Leaders table — click a row to reveal their team */}
      <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
        <h2 className="text-md font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><Users2 className="w-5 h-5 text-amber-400" /> Team Leaders</h2>
        {ranked.length === 0 ? (
          <div className="text-center py-6 text-[var(--muted)] text-xs">No Team Leaders yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                  <th className="text-left py-2 px-2">Name</th>
                  <th className="text-center py-2 px-2">Assigned</th>
                  <th className="text-center py-2 px-2">Completed</th>
                  <th className="text-center py-2 px-2">Pending</th>
                  <th className="text-center py-2 px-2">Avg Time</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((l) => {
                  const open = expanded === l.id;
                  const hasTeam = l.team.length > 0;
                  return (
                    <React.Fragment key={l.id}>
                      <tr
                        className={`border-b border-[var(--border)]/40 ${hasTeam ? "cursor-pointer hover:bg-[var(--surface-2)]/40" : ""} transition`}
                        onClick={hasTeam ? () => setExpanded(open ? null : l.id) : undefined}
                        title={hasTeam ? (open ? "Hide team" : "Show team") : "No agents linked to this Team Leader yet"}
                      >
                        <td className="py-2.5 px-2 font-bold text-[var(--heading)]">
                          <span className="inline-flex items-center gap-1.5">
                            {hasTeam && <ChevronRight className={`w-3.5 h-3.5 text-[var(--muted)] shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />}
                            {l.full_name}
                            {l.department && <span className="text-[10px] font-normal text-[var(--muted)]">· {l.department}</span>}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-blue-400">{l.assigned}</td>
                        <td className="py-2.5 px-2 text-center font-mono text-emerald-400">{l.completed}</td>
                        <td className="py-2.5 px-2 text-center font-mono text-amber-400">{l.pending}</td>
                        <td className="py-2.5 px-2 text-center font-mono text-[var(--muted)]">{fmtDur(l.avgDurationSeconds)}</td>
                      </tr>
                      {open && l.team.map((m) => (
                        <tr key={m.id} className="border-b border-[var(--border)]/30 bg-[var(--surface-2)]/30">
                          <td className="py-2 pl-8 text-[var(--text)]">↳ {m.full_name}</td>
                          <td className="py-2 text-center font-mono text-[var(--muted)]">{m.assigned}</td>
                          <td className="py-2 text-center font-mono text-[var(--muted)]">{m.completed}</td>
                          <td className="py-2 text-center font-mono text-[var(--muted)]">{m.pending}</td>
                          <td className="py-2 text-center font-mono text-[var(--muted)]">{fmtDur(m.avgDurationSeconds)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {ranked.some((l) => l.team.length === 0) && (
          <p className="mt-4 text-[11px] text-[var(--muted)] flex items-center gap-1.5"><UserCog className="w-3.5 h-3.5 shrink-0" /> A Team Leader with no team yet: link their Agents to them from Users Management to see them here.</p>
        )}
      </div>
    </div>
  );
}
