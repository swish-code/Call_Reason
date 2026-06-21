import { useEffect, useState } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { ClipboardList, CheckCircle2, Clock, FolderOpen, CalendarDays, TrendingUp, Users, Award, MessageSquareWarning, Wrench, GraduationCap, AlertCircle } from "lucide-react";

interface OpsDashboardProps {
  currentUser: User;
}

interface DashData {
  role: string;
  department: string | null;
  totalLogs: number;
  open: number;
  pending: number;
  completed: number;
  daily: number;
  weekly: number;
  monthly: number;
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

  if (loading) return <div className="flex flex-col items-center justify-center min-h-[400px]"><div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div><p className="mt-4 text-[#71717a]">Loading dashboard...</p></div>;
  if (error) return <div className="p-6 bg-rose-950/20 border border-rose-500/30 rounded-2xl text-center text-rose-300"><AlertCircle className="w-10 h-10 mx-auto text-rose-500" /><p className="mt-2 text-sm">{error}</p></div>;
  if (!d) return null;

  const isAgent = currentUser.role === "agent";
  const Card = ({ label, value, icon: Icon, tone }: { label: string; value: any; icon: any; tone: string }) => (
    <div className="bg-[#121214] p-5 border border-[#27272a] shadow-lg rounded-2xl flex items-center gap-4">
      <div className={`p-3 rounded-xl bg-opacity-10 ${tone} bg-current/10`}><Icon className={`w-6 h-6 ${tone}`} /></div>
      <div>
        <p className="text-[10px] text-[#71717a] font-bold uppercase">{label}</p>
        <h3 className="text-2xl font-bold text-white tracking-tight font-mono">{value}</h3>
      </div>
    </div>
  );

  const BarList = ({ title, data, color, icon: Icon }: { title: string; data: { name: string; count: number }[]; color: string; icon: any }) => {
    const total = data.reduce((a, c) => a + c.count, 0) || 1;
    return (
      <div className="bg-[#121214] p-6 border border-[#27272a] shadow-lg rounded-2xl">
        <h2 className="text-md font-bold text-white mb-4 flex items-center gap-2"><Icon className="w-5 h-5 text-blue-400" /> {title}</h2>
        <div className="space-y-3">
          {data.map((x) => {
            const pct = Math.round((x.count / total) * 100);
            return (
              <div key={x.name} className="space-y-1">
                <div className="flex justify-between items-center text-xs font-bold"><span className="text-white truncate pr-2">{x.name}</span><span className="text-[#71717a] font-mono shrink-0">{x.count}</span></div>
                <div className="w-full bg-[#1c1c1f] border border-[#27272a]/60 h-2 rounded-full overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }}></div></div>
              </div>
            );
          })}
          {data.length === 0 && <div className="text-center py-6 text-[#71717a] text-xs">No data yet.</div>}
        </div>
      </div>
    );
  };

  const Trend = () => {
    const max = Math.max(...d.trend.map((t) => t.count), 1);
    return (
      <div className="bg-[#121214] p-6 border border-[#27272a] shadow-lg rounded-2xl">
        <h2 className="text-md font-bold text-white mb-4 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-blue-400" /> Activity — last 7 days</h2>
        <div className="flex items-end justify-between gap-2 h-40">
          {d.trend.map((t) => {
            const p = t.date.split("-");
            return (
              <div key={t.date} className="flex-1 flex flex-col items-center justify-end gap-2 h-full">
                <span className="text-[10px] font-mono text-blue-300">{t.count}</span>
                <div className="w-full bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-lg" style={{ height: `${Math.max((t.count / max) * 100, 3)}%` }}></div>
                <span className="text-[9px] font-mono text-zinc-500">{p[2]}/{p[1]}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-fade-in text-[#e4e4e7]">
      {/* Banner */}
      <div className="bg-gradient-to-r from-[#121214] via-[#1c1c1f] to-[#0a0a0b] border border-[#27272a] p-6 md:p-8 rounded-3xl shadow-xl">
        <span className="bg-blue-950/45 text-blue-400 text-xs font-bold px-3 py-1 rounded-full border border-blue-500/30">{isAgent ? "Agent Dashboard" : currentUser.role === "leader" ? "Team Leader Dashboard" : "Admin Dashboard"}</span>
        <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight mt-2">Welcome, {currentUser.name || currentUser.full_name}</h1>
        <p className="text-[#71717a] text-sm mt-1 font-light">{d.department ? `Department: ${d.department}` : "All departments"}</p>
      </div>

      {isAgent ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            <Card label="My Open Tasks" value={d.open} icon={FolderOpen} tone="text-blue-400" />
            <Card label="My Pending Tasks" value={d.pending} icon={Clock} tone="text-amber-400" />
            <Card label="My Completed Tasks" value={d.completed} icon={CheckCircle2} tone="text-emerald-400" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            <Card label="Daily Activities" value={d.daily} icon={CalendarDays} tone="text-blue-400" />
            <Card label="Weekly Activities" value={d.weekly} icon={CalendarDays} tone="text-purple-400" />
            <Card label="Monthly Activities" value={d.monthly} icon={CalendarDays} tone="text-sky-400" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Trend />
            <BarList title="My Activities by Type" data={d.byActivity} color="bg-blue-500" icon={ClipboardList} />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card label="Total Logs" value={d.totalLogs} icon={ClipboardList} tone="text-white" />
            <Card label="Open Tasks" value={d.open} icon={FolderOpen} tone="text-blue-400" />
            <Card label="Pending" value={d.pending} icon={Clock} tone="text-amber-400" />
            <Card label="Closed Tasks" value={d.completed} icon={CheckCircle2} tone="text-emerald-400" />
            <Card label="Complaint Resolution" value={`${d.complaintResolutionRate}%`} icon={MessageSquareWarning} tone="text-rose-400" />
            <Card label="Coaching Sessions" value={d.coachingSessions} icon={GraduationCap} tone="text-purple-400" />
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
