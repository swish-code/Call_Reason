import { useEffect, useState } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { ClipboardList, CheckCircle2, Clock, FolderOpen, CalendarDays, TrendingUp, Users, Award, MessageSquareWarning, Wrench, GraduationCap, AlertCircle, Timer } from "lucide-react";

interface OpsDashboardProps {
  currentUser: User;
}

interface DashData {
  role: string;
  department: string | null;
  totalLogs: number;
  avgHandlingSeconds: number;
  totalHandlingSeconds: number;
  open: number;
  pending: number;
  completed: number;
  daily: number;
  weekly: number;
  monthly: number;
  todayTasks: number;
  weekTasks: number;
  todaySeconds: number;
  weekSeconds: number;
  byActivity: { name: string; count: number }[];
  byDepartment: { name: string; count: number }[];
  agentProductivity: { name: string; count: number }[];
  complaintResolutionRate: number;
  technicalStatus: { name: string; count: number }[];
  coachingSessions: number;
  trend: { date: string; count: number }[];
}

export default function OpsDashboard({ currentUser }: OpsDashboardProps) {
  const [d, setD] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true); setError("");
        const res = await apiFetch("/api/logs/dashboard");
        if (!res.ok) throw new Error("Failed to load dashboard.");
        setD(await res.json());
      } catch (err: any) { setError(err.message); } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="flex flex-col items-center justify-center min-h-[400px]"><div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div><p className="mt-4 text-[var(--muted)]">Loading dashboard...</p></div>;
  if (error) return <div className="p-6 bg-rose-950/20 border border-rose-500/30 rounded-2xl text-center text-rose-300"><AlertCircle className="w-10 h-10 mx-auto text-rose-500" /><p className="mt-2 text-sm">{error}</p></div>;
  if (!d) return null;

  const isAgent = currentUser.role === "agent";
  const fmtDur = (s: number) => {
    if (!s) return "0m";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : `${s}s`;
  };
  const Card = ({ label, value, icon: Icon, tone }: { label: string; value: any; icon: any; tone: string }) => (
    <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl flex items-center gap-4">
      <div className={`p-3 rounded-xl bg-opacity-10 ${tone} bg-current/10`}><Icon className={`w-6 h-6 ${tone}`} /></div>
      <div>
        <p className="text-[10px] text-[var(--muted)] font-bold uppercase">{label}</p>
        <h3 className="text-2xl font-bold text-[var(--heading)] tracking-tight font-mono">{value}</h3>
      </div>
    </div>
  );

  const BarList = ({ title, data, color, icon: Icon }: { title: string; data: { name: string; count: number }[]; color: string; icon: any }) => {
    const total = data.reduce((a, c) => a + c.count, 0) || 1;
    return (
      <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
        <h2 className="text-md font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><Icon className="w-5 h-5 text-blue-400" /> {title}</h2>
        <div className="space-y-3">
          {data.map((x) => {
            const pct = Math.round((x.count / total) * 100);
            return (
              <div key={x.name} className="space-y-1">
                <div className="flex justify-between items-center text-xs font-bold"><span className="text-[var(--heading)] truncate pr-2">{x.name}</span><span className="text-[var(--muted)] font-mono shrink-0">{x.count}</span></div>
                <div className="w-full bg-[var(--surface-2)] border border-[var(--border)]/60 h-2 rounded-full overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }}></div></div>
              </div>
            );
          })}
          {data.length === 0 && <div className="text-center py-6 text-[var(--muted)] text-xs">No data yet.</div>}
        </div>
      </div>
    );
  };

  const Trend = () => {
    const max = Math.max(...d.trend.map((t) => t.count), 1);
    return (
      <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
        <h2 className="text-md font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-blue-400" /> Activity — last 7 days</h2>
        <div className="flex items-end justify-between gap-2 h-40">
          {d.trend.map((t) => {
            const p = t.date.split("-");
            return (
              <div key={t.date} className="flex-1 flex flex-col items-center justify-end gap-2 h-full">
                <span className="text-[10px] font-mono text-blue-300">{t.count}</span>
                <div className="w-full bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-lg" style={{ height: `${Math.max((t.count / max) * 100, 3)}%` }}></div>
                <span className="text-[9px] font-mono text-[var(--muted)]">{p[2]}/{p[1]}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const ProductivityBar = ({ seconds, capacity, label }: { seconds: number; capacity: number; label: string }) => {
    const pct = capacity ? Math.round((seconds / capacity) * 100) : 0;
    const tone = pct >= 85 ? "from-emerald-500 to-emerald-400" : pct >= 50 ? "from-blue-600 to-blue-400" : "from-amber-500 to-amber-400";
    return (
      <div className="space-y-2">
        <div className="flex justify-between items-baseline text-xs font-bold">
          <span className="text-[var(--text)]">{label}</span>
          <span className="text-[var(--heading)] font-mono">{fmtDur(seconds)} / {fmtDur(capacity)} · {pct}%</span>
        </div>
        <div className="w-full bg-[var(--surface-2)] border border-[var(--border)] h-3 rounded-full overflow-hidden">
          <div className={`h-full rounded-full bg-gradient-to-r ${tone}`} style={{ width: `${Math.min(pct, 100)}%` }}></div>
        </div>
      </div>
    );
  };

  const DAY_CAP = 8 * 3600; // 8 working hours/day
  const WEEK_CAP = 6 * 8 * 3600; // 6 working days/week

  return (
    <div className="space-y-8 animate-fade-in text-[var(--text)]">
      {/* Banner */}
      <div className="bg-gradient-to-r from-[var(--surface)] via-[var(--surface-2)] to-[var(--bg)] border border-[var(--border)] p-6 md:p-8 rounded-3xl shadow-xl">
        <span className="bg-blue-950/45 text-blue-400 text-xs font-bold px-3 py-1 rounded-full border border-blue-500/30">{isAgent ? "Agent Dashboard" : currentUser.role === "leader" ? "Team Leader Dashboard" : currentUser.role === "supervisor" ? "Supervisor Dashboard" : "Admin Dashboard"}</span>
        <h1 className="text-2xl md:text-3xl font-extrabold text-[var(--heading)] tracking-tight mt-2">Welcome, {currentUser.name || currentUser.full_name}</h1>
        <p className="text-[var(--muted)] text-sm mt-1 font-light">{d.department ? `Department: ${d.department}` : "All departments"}</p>
      </div>

      {isAgent ? (
        <>
          {/* Today */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-lg space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-md font-extrabold text-[var(--heading)] flex items-center gap-2"><CalendarDays className="w-5 h-5 text-blue-400" /> Today</h2>
              <span className="text-[11px] text-[var(--muted)] font-bold">Working day · 8h</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Card label="Tasks" value={d.todayTasks} icon={CheckCircle2} tone="text-blue-400" />
              <Card label="Time Worked" value={fmtDur(d.todaySeconds)} icon={Clock} tone="text-emerald-400" />
            </div>
            <ProductivityBar seconds={d.todaySeconds} capacity={DAY_CAP} label="Productivity (worked / 8h)" />
          </div>

          {/* This week */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-lg space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-md font-extrabold text-[var(--heading)] flex items-center gap-2"><CalendarDays className="w-5 h-5 text-purple-400" /> This Week</h2>
              <span className="text-[11px] text-[var(--muted)] font-bold">6 working days · 48h</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Card label="Tasks" value={d.weekTasks} icon={CheckCircle2} tone="text-blue-400" />
              <Card label="Time Worked" value={fmtDur(d.weekSeconds)} icon={Clock} tone="text-emerald-400" />
            </div>
            <ProductivityBar seconds={d.weekSeconds} capacity={WEEK_CAP} label="Productivity (worked / 48h)" />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card label="Total Logs" value={d.totalLogs} icon={ClipboardList} tone="text-[var(--heading)]" />
            <Card label="Open Tasks" value={d.open} icon={FolderOpen} tone="text-blue-400" />
            <Card label="Pending" value={d.pending} icon={Clock} tone="text-amber-400" />
            <Card label="Closed Tasks" value={d.completed} icon={CheckCircle2} tone="text-emerald-400" />
            <Card label="Complaint Resolution" value={`${d.complaintResolutionRate}%`} icon={MessageSquareWarning} tone="text-rose-400" />
            <Card label="Coaching Sessions" value={d.coachingSessions} icon={GraduationCap} tone="text-purple-400" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <Card label="Avg Handling Time / Task" value={fmtDur(d.avgHandlingSeconds)} icon={Timer} tone="text-emerald-400" />
            <Card label="Total Time Logged" value={fmtDur(d.totalHandlingSeconds)} icon={Clock} tone="text-sky-400" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <BarList title="Agent Productivity" data={d.agentProductivity} color="bg-blue-500" icon={Users} />
            <BarList title="Department Performance" data={d.byDepartment} color="bg-emerald-500" icon={Award} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Trend />
            <BarList title="Technical Tasks Status" data={d.technicalStatus} color="bg-amber-500" icon={Wrench} />
          </div>
          <BarList title="Logs by Activity Type" data={d.byActivity} color="bg-purple-500" icon={ClipboardList} />
        </>
      )}
    </div>
  );
}
