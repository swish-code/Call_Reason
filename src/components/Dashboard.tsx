import { useEffect, useState } from "react";
import { DashboardStats } from "../types.js";
import { Phone, CheckSquare, PhoneIncoming, PhoneOutgoing, ShieldAlert, Award, Calendar, BarChart2, Star, TrendingUp } from "lucide-react";
import { apiFetch } from "../lib/api.ts";

interface DashboardProps {
  onNavigateToForm: () => void;
}

export default function Dashboard({ onNavigateToForm }: DashboardProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await apiFetch("/api/dashboard/stats");
      if (!res.ok) throw new Error("Failed to load dashboard statistics");
      const data = await res.json();
      setStats(data);
    } catch (err: any) {
      setError(err.message || "Failed to connect to primary server");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-[#71717a] font-medium">Updating dashboard data and statistics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-rose-950/20 border border-rose-500/30 rounded-2xl text-center">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto" />
        <h3 className="mt-2 text-lg font-bold text-rose-200">Load Alert</h3>
        <p className="text-rose-400 mt-1 text-xs">{error}</p>
        <button
          onClick={fetchStats}
          className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!stats) return null;

  // Render SVG charts safely
  const maxBrandCount = Math.max(...stats.brandPerformance.map((b) => b.count), 1);
  const brandColors: Record<string, string> = {
    Talabat: "fill-orange-500 bg-orange-500",
    Noon: "fill-yellow-500 bg-yellow-500",
    Amazon: "fill-amber-600 bg-amber-600",
    Carrefour: "fill-blue-600 bg-blue-600",
    Custom: "fill-purple-600 bg-purple-600",
  };

  const getBrandColor = (name: string) => {
    return brandColors[name] || "fill-indigo-500 bg-indigo-500";
  };

  // Pre-calculate line chart points
  const maxDailyValue = Math.max(
    ...stats.dailyReports.map((d) => Math.max(d.calls, d.srs, d.tasks)),
    10
  );

  const padding = 40;
  const graphWidth = 500;
  const graphHeight = 200;

  const getXPoint = (index: number, total: number) => {
    if (total <= 1) return padding;
    return padding + (index * (graphWidth - padding * 2)) / (total - 1);
  };

  const getYPoint = (value: number) => {
    return graphHeight - padding - (value * (graphHeight - padding * 2)) / maxDailyValue;
  };

  // Generate SVG paths for multi-line graph
  const getLinePath = (field: "calls" | "srs" | "tasks") => {
    return stats.dailyReports
      .map((d, idx) => {
        const x = getXPoint(idx, stats.dailyReports.length);
        const y = getYPoint(d[field]);
        return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  };

  const totalInteractionsCount = stats.brandPerformance.reduce((acc, cur) => acc + cur.count, 0);

  return (
    <div className="space-y-8 animate-fade-in text-[#e4e4e7]">
      {/* Top Welcome Title Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-gradient-to-r from-[#121214] via-[#1c1c1f] to-[#0a0a0b] border border-[#27272a] p-6 md:p-8 rounded-3xl shadow-xl relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-blue-600 rounded-full opacity-5 blur-xl"></div>
        <div className="absolute -left-10 -top-10 w-40 h-40 bg-blue-500 rounded-full opacity-5 blur-xl"></div>
        
        <div className="relative z-10 space-y-2">
          <span className="bg-blue-950/45 text-blue-400 text-xs font-bold px-3 py-1 rounded-full border border-blue-500/30">
            Interactions & Real-Time Indicators Dashboard
          </span>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">Welcome back to the Advanced Dashboard</h1>
          <p className="text-[#e4e4e7] max-w-xl text-sm md:text-base font-light">
            Monitor brand performance, track inbound/outbound calls, tech tasks, and Service Requests (SRs).
          </p>
        </div>

        <button
          onClick={onNavigateToForm}
          className="relative z-10 self-start md:self-center mt-4 md:mt-0 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white active:scale-95 font-bold rounded-2xl shadow-lg shadow-blue-950/40 transition flex items-center gap-2 text-sm"
        >
          <Phone className="w-4 h-4" />
          New Interaction
        </button>
      </div>

      {/* Grid Counters */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 md:gap-6">
        <div className="bg-[#121214] p-5 border border-[#27272a] shadow-lg rounded-2xl flex items-center gap-4 hover:border-blue-500/30 hover:bg-[#1a1a1d] transition">
          <div className="p-3 bg-blue-950/40 text-blue-400 border border-blue-500/20 rounded-xl">
            <Phone className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-[#71717a] font-medium">Today's Calls</p>
            <h3 className="text-2xl font-bold text-white tracking-tight">{stats.totalCallsToday}</h3>
            <span className="text-[10px] text-emerald-500 font-bold">● Live Interactions</span>
          </div>
        </div>

        <div className="bg-[#121214] p-5 border border-[#27272a] shadow-lg rounded-2xl flex items-center gap-4 hover:border-blue-500/30 hover:bg-[#1a1a1d] transition">
          <div className="p-3 bg-amber-950/40 text-amber-400 border border-amber-500/20 rounded-xl">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-[#71717a] font-medium">Service Requests (SR)</p>
            <h3 className="text-2xl font-bold text-white tracking-tight">{stats.totalSRs}</h3>
            <span className="text-[10px] text-amber-500 font-bold">Pending Resolution</span>
          </div>
        </div>

        <div className="bg-[#121214] p-5 border border-[#27272a] shadow-lg rounded-2xl flex items-center gap-4 hover:border-blue-500/30 hover:bg-[#1a1a1d] transition">
          <div className="p-3 bg-emerald-950/40 text-emerald-400 border border-emerald-500/20 rounded-xl">
            <CheckSquare className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-[#71717a] font-medium">Daily Tech Tasks</p>
            <h3 className="text-2xl font-bold text-white tracking-tight">{stats.totalTasks}</h3>
            <span className="text-[10px] text-blue-400 font-bold">Created for Customers</span>
          </div>
        </div>

        <div className="bg-[#121214] p-5 border border-[#27272a] shadow-lg rounded-2xl flex items-center gap-4 hover:border-blue-500/30 hover:bg-[#1a1a1d] transition">
          <div className="p-3 bg-sky-950/40 text-sky-400 border border-sky-500/20 rounded-xl">
            <PhoneIncoming className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-[#71717a] font-medium">Inbound Calls</p>
            <h3 className="text-2xl font-bold text-white tracking-tight">{stats.totalInbound}</h3>
            <span className="text-[10px] text-[#71717a]">From system users</span>
          </div>
        </div>

        <div className="bg-[#121214] p-5 border border-[#27272a] shadow-lg rounded-2xl flex items-center gap-4 hover:border-blue-500/30 hover:bg-[#1a1a1d] transition">
          <div className="p-3 bg-pink-950/40 text-pink-400 border border-pink-500/20 rounded-xl">
            <PhoneOutgoing className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-[#71717a] font-medium">Outbound Calls</p>
            <h3 className="text-2xl font-bold text-white tracking-tight">{stats.totalOutbound}</h3>
            <span className="text-[10px] text-[#71717a]">For follow-ups & complaints</span>
          </div>
        </div>
      </div>

      {/* Call-center KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Total Calls", value: stats.totalCalls, tone: "text-white" },
          { label: "Total Complaints", value: stats.totalComplaints, tone: "text-rose-400" },
          { label: "Solved (FCR)", value: stats.solvedCases, tone: "text-emerald-400" },
          { label: "Unsolved (FCR)", value: stats.unsolvedCases, tone: "text-amber-400" },
          { label: "FCR Rate", value: `${stats.fcrRate}%`, tone: "text-blue-400" },
        ].map((c) => (
          <div key={c.label} className="bg-[#121214] p-5 border border-[#27272a] shadow-lg rounded-2xl">
            <span className="text-[10px] text-[#71717a] font-bold block uppercase">{c.label}</span>
            <p className={`text-2xl font-bold tracking-tight font-mono mt-1 ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Calls by Type / Calls by Branch */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {([
          { title: "Calls by Type", data: stats.callsByType, color: "bg-blue-500" },
          { title: "Calls by Branch", data: stats.callsByBranch, color: "bg-amber-500" },
        ] as const).map((sec) => {
          const total = sec.data.reduce((a, c) => a + c.count, 0) || 1;
          return (
            <div key={sec.title} className="bg-[#121214] p-6 border border-[#27272a] shadow-lg rounded-2xl">
              <h2 className="text-md font-bold text-white mb-4">{sec.title}</h2>
              <div className="space-y-3">
                {sec.data.map((d) => {
                  const pct = Math.round((d.count / total) * 100);
                  return (
                    <div key={d.name} className="space-y-1">
                      <div className="flex justify-between items-center text-xs font-bold">
                        <span className="text-white truncate pr-2">{d.name}</span>
                        <span className="text-[#71717a] font-mono shrink-0">{d.count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-[#1c1c1f] border border-[#27272a]/60 h-2.5 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${sec.color}`} style={{ width: `${pct}%` }}></div>
                      </div>
                    </div>
                  );
                })}
                {sec.data.length === 0 && <div className="text-center py-6 text-[#71717a] text-xs">No data yet.</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Complaint Trends (last 7 days) */}
      <div className="bg-[#121214] p-6 border border-[#27272a] shadow-lg rounded-2xl">
        <h2 className="text-md font-bold text-white mb-4">Complaint Trends (last 7 days)</h2>
        <div className="flex items-end justify-between gap-2 h-40">
          {(() => {
            const maxT = Math.max(...stats.complaintTrends.map((t) => t.count), 1);
            return stats.complaintTrends.map((t) => {
              const parts = t.date.split("-");
              const label = parts[2] && parts[1] ? `${parts[2]}/${parts[1]}` : t.date;
              return (
                <div key={t.date} className="flex-1 flex flex-col items-center justify-end gap-2 h-full">
                  <span className="text-[10px] font-mono text-rose-300">{t.count}</span>
                  <div className="w-full bg-gradient-to-t from-rose-600 to-rose-400 rounded-t-lg transition-all" style={{ height: `${Math.max((t.count / maxT) * 100, 3)}%` }}></div>
                  <span className="text-[9px] font-mono text-zinc-500">{label}</span>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Main Analytical Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* Daily Reports Trend Line Chart */}
        <div className="bg-[#121214] p-6 border border-[#27272a] shadow-lg rounded-2xl lg:col-span-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-400" />
                <h2 className="text-md font-bold text-white">Interactions in last 7 days</h2>
              </div>
              <span className="text-xs text-[#71717a] font-medium flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                Auto-updated
              </span>
            </div>

            {/* SVG line graph */}
            <div className="relative w-full overflow-hidden flex justify-center py-2 bg-[#0a0a0b] rounded-2xl border border-[#27272a]">
              <svg viewBox={`0 0 ${graphWidth} ${graphHeight}`} className="w-full max-w-2xl h-auto" dir="ltr">
                {/* Horizontal grid lines */}
                {Array.from({ length: 5 }).map((_, idx) => {
                  const y = padding + (idx * (graphHeight - padding * 2)) / 4;
                  const label = Math.round(maxDailyValue - (idx * maxDailyValue) / 4);
                  return (
                    <g key={idx}>
                      <line
                        x1={padding}
                        y1={y}
                        x2={graphWidth - padding}
                        y2={y}
                        stroke="#27272a"
                        strokeDasharray="4 4"
                      />
                      <text x={padding - 10} y={y + 4} textAnchor="end" className="text-[9px] fill-zinc-500 font-mono">
                        {label}
                      </text>
                    </g>
                  );
                })}

                {/* X labels */}
                {stats.dailyReports.map((d, idx) => {
                  const x = getXPoint(idx, stats.dailyReports.length);
                  // Grab day/month from YYYY-MM-DD
                  const parts = d.date.split("-");
                  const labelStr = parts[1] && parts[2] ? `${parts[2]}/${parts[1]}` : d.date;
                  return (
                    <g key={idx}>
                      <text
                        x={x}
                        y={graphHeight - padding + 15}
                        textAnchor="middle"
                        className="text-[8px] fill-zinc-500 font-mono"
                      >
                        {labelStr}
                      </text>
                      <line
                        x1={x}
                        y1={graphHeight - padding}
                        x2={x}
                        y2={graphHeight - padding + 5}
                        stroke="#27272a"
                      />
                    </g>
                  );
                })}

                {/* Lines paths with smooth coordinates */}
                <path d={getLinePath("calls")} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" />
                <path d={getLinePath("srs")} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
                <path d={getLinePath("tasks")} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />

                {/* Circles for points */}
                {stats.dailyReports.map((d, idx) => {
                  const x = getXPoint(idx, stats.dailyReports.length);
                  return (
                    <g key={idx}>
                      <circle cx={x} cy={getYPoint(d.calls)} r="3.5" fill="#2563eb" stroke="#0a0a0b" strokeWidth="1" />
                      <circle cx={x} cy={getYPoint(d.srs)} r="3.5" fill="#f59e0b" stroke="#0a0a0b" strokeWidth="1" />
                      <circle cx={x} cy={getYPoint(d.tasks)} r="3.5" fill="#10b981" stroke="#0a0a0b" strokeWidth="1" />
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          <div className="flex justify-center items-center gap-6 mt-4 pt-4 border-t border-[#27272a]/80 text-xs font-semibold">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-blue-600 rounded-full"></span>
              <span className="text-zinc-300">Calls</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-amber-500 rounded-full"></span>
              <span className="text-zinc-300">Service Requests (SR)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-emerald-500 rounded-full"></span>
              <span className="text-zinc-300">Technical Tasks</span>
            </div>
          </div>
        </div>

        {/* Brand Performance Bar Chart */}
        <div className="bg-[#121214] p-6 border border-[#27272a] shadow-lg rounded-2xl lg:col-span-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-blue-400" />
                <h2 className="text-md font-bold text-white">Volume by Brand</h2>
              </div>
            </div>

            <p className="text-xs text-[#71717a] mb-4 font-light">
              Total volume across registered brands: <strong className="text-blue-400 font-bold">{totalInteractionsCount} interactions</strong>.
            </p>

            <div className="space-y-4">
              {stats.brandPerformance.map((bp) => {
                const percent = totalInteractionsCount > 0 ? Math.round((bp.count / totalInteractionsCount) * 100) : 0;
                return (
                  <div key={bp.name} className="space-y-1">
                    <div className="flex justify-between items-center text-xs font-bold">
                       <span className="text-white flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${getBrandColor(bp.name).split(" ")[1]}`}></span>
                        {bp.name}
                      </span>
                      <span className="text-[#71717a] font-mono">
                        {bp.count} interactions ({percent}%)
                      </span>
                    </div>
                    <div className="w-full bg-[#1c1c1f] border border-[#27272a]/60 h-2.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${getBrandColor(bp.name).split(" ")[1]}`}
                        style={{ width: `${percent}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
              {stats.brandPerformance.length === 0 && (
                <div className="text-center py-6 text-[#71717a] text-xs">No active brand interactions logged yet.</div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#27272a] text-[11px] text-[#71717a] bg-[#1c1c1f] p-2.5 rounded-xl flex items-center justify-between">
            <span>Highest volume manufacturer:</span>
            <span className="font-bold text-blue-400">
              {stats.brandPerformance.length > 0
                ? stats.brandPerformance.reduce((prev, current) => (prev.count > current.count ? prev : current)).name
                : "Unavailable"}
            </span>
          </div>
        </div>
      </div>

      {/* Agents Productivity Progress Meter */}
      <div className="bg-[#121214] p-6 border border-[#27272a] shadow-lg rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-blue-400" />
            <h2 className="text-md font-bold text-white">Support Representatives Productivity</h2>
          </div>
          <span className="text-xs bg-emerald-900/20 text-emerald-400 border border-emerald-500/20 px-3 py-1 rounded-full font-bold">
            Active Today
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          {stats.agentPerformance.map((agent) => {
            const performanceValue = agent.count;
            const maxValPercentage = Math.min((performanceValue / 15) * 100, 100); // 15 calls is full scale today
            return (
              <div
                key={agent.name}
                className="p-4 bg-[#1c1c1f] rounded-2xl border border-[#27272a] flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 w-1/2">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500 to-blue-600 text-white flex items-center justify-center font-bold text-sm shadow shadow-blue-900/20 shrink-0">
                    {agent.name.substring(0, 2)}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white truncate">{agent.name}</h4>
                    <p className="text-[11px] text-[#71717a]">Support Representative</p>
                  </div>
                </div>

                <div className="w-1/2 space-y-1.5">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-blue-400 font-mono">
                      {agent.count} <small className="text-[#71717a] font-light font-sans">interactions</small>
                    </span>
                    <span className="text-[#71717a] font-mono">{Math.round(maxValPercentage)}%</span>
                  </div>
                  <div className="w-full bg-[#121214] border border-[#27272a]/60 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full rounded-full transition-all duration-700"
                      style={{ width: `${maxValPercentage}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            );
          })}
          {stats.agentPerformance.length === 0 && (
            <div className="col-span-2 text-center text-[#71717a] text-xs py-8">No active agents logged today.</div>
          )}
        </div>
      </div>
    </div>
  );
}
