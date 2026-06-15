import { useState, useEffect } from "react";
import { Interaction, User, Team, TEAMS } from "../types.js";
import { Users, Phone, MessageSquareWarning, CheckCircle2, Clock, RefreshCw, Download, AlertCircle, MessagesSquare, Wrench, ShieldCheck, Headset } from "lucide-react";
import { apiFetch } from "../lib/api.ts";
import { exportInteractionsToCSV } from "../utils.js";

interface AgentLogsProps {
  currentUser: User;
}

const TEAM_META: Record<Team, { icon: any; color: string }> = {
  "Complain Team": { icon: MessageSquareWarning, color: "rose" },
  "Call Center": { icon: Headset, color: "blue" },
  "Technical Team": { icon: Wrench, color: "amber" },
  "Team Leader": { icon: ShieldCheck, color: "emerald" },
};

export default function AgentLogs({ currentUser }: AgentLogsProps) {
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTeam, setActiveTeam] = useState<Team>("Complain Team");

  const fetchLogs = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch("/api/interactions");
      if (!res.ok) throw new Error("Failed to load agent logs.");
      setInteractions(await res.json());
    } catch (err: any) {
      setError(err.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const teamLogs = interactions.filter((i) => (i.team || "Call Center") === activeTeam);

  const stats = {
    total: teamLogs.length,
    calls: teamLogs.filter((i) => i.communication_type === "Call").length,
    complaints: teamLogs.filter((i) => i.interaction_type === "Complaint" || i.call_reason === "Complaint").length,
    resolved: teamLogs.filter((i) => i.status === "Resolved" || i.status === "Closed").length,
    open: teamLogs.filter((i) => i.status === "Open" || i.status === "Pending").length,
  };

  // Per-agent breakdown within the team
  const agentMap: Record<string, number> = {};
  teamLogs.forEach((i) => { agentMap[i.agent_name] = (agentMap[i.agent_name] || 0) + 1; });
  const agentBreakdown = Object.keys(agentMap).map((name) => ({ name, count: agentMap[name] })).sort((a, b) => b.count - a.count);

  const statusBadge = (s: string) => {
    if (s === "Resolved" || s === "Closed") return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    if (s === "Pending") return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    return "bg-blue-500/10 text-blue-400 border border-blue-500/20";
  };

  return (
    <div className="space-y-6 animate-fade-in text-[#e4e4e7]">
      {/* Header */}
      <div className="bg-[#121214] p-5 border border-[#27272a] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl"><Users className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-white">Agent Logs by Team</h2>
            <p className="text-xs text-[#71717a] font-light mt-0.5">Interactions logged grouped across the four operational teams.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchLogs} className="p-3 text-zinc-300 hover:text-white bg-[#0a0a0b] hover:bg-zinc-800 border border-[#27272a] rounded-2xl active:scale-95 transition" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => exportInteractionsToCSV(teamLogs)} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 shadow shadow-emerald-500/10 transition">
            <Download className="w-4 h-4" /> Export Team to CSV
          </button>
        </div>
      </div>

      {/* Team tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {TEAMS.map((t) => {
          const Icon = TEAM_META[t].icon;
          const count = interactions.filter((i) => (i.team || "Call Center") === t).length;
          const active = activeTeam === t;
          return (
            <button
              key={t}
              onClick={() => setActiveTeam(t)}
              className={`p-4 rounded-2xl border text-left transition flex items-center gap-3 ${
                active ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-950/40" : "bg-[#121214] text-[#71717a] border-[#27272a] hover:text-white hover:border-blue-500/30"
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <div>
                <div className="text-xs font-extrabold leading-tight">{t}</div>
                <div className={`text-[10px] font-bold ${active ? "text-blue-100" : "text-zinc-500"}`}>{count} logs</div>
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[260px]">
          <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-3 text-xs text-zinc-400">Loading team logs...</p>
        </div>
      ) : (
        <>
          {/* KPI summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: "Total Logs", value: stats.total, icon: MessagesSquare, tone: "text-white" },
              { label: "Calls", value: stats.calls, icon: Phone, tone: "text-blue-400" },
              { label: "Complaints", value: stats.complaints, icon: MessageSquareWarning, tone: "text-rose-400" },
              { label: "Resolved / Closed", value: stats.resolved, icon: CheckCircle2, tone: "text-emerald-400" },
              { label: "Open / Pending", value: stats.open, icon: Clock, tone: "text-amber-400" },
            ].map((c) => (
              <div key={c.label} className="bg-[#121214] p-5 border border-[#27272a] shadow-lg rounded-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#71717a] font-bold block uppercase">{c.label}</span>
                  <c.icon className={`w-4 h-4 ${c.tone}`} />
                </div>
                <p className={`text-2xl font-bold tracking-tight font-mono mt-1 ${c.tone}`}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* Per-agent breakdown */}
          {agentBreakdown.length > 0 && (
            <div className="bg-[#121214] border border-[#27272a] rounded-3xl p-5 shadow-lg">
              <h3 className="text-xs font-extrabold text-white mb-3">Agents in {activeTeam}</h3>
              <div className="flex flex-wrap gap-2">
                {agentBreakdown.map((a) => (
                  <span key={a.name} className="px-3 py-1.5 bg-[#0a0a0b] border border-[#27272a] rounded-xl text-[11px] font-bold text-zinc-300">
                    {a.name} <span className="text-blue-400 font-mono">· {a.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Detailed table */}
          <div className="bg-[#121214] border border-[#27272a] rounded-3xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0a0a0b] text-[#71717a] font-bold border-b border-[#27272a]">
                  <tr>
                    <th className="p-4">Date & Time</th>
                    <th className="p-4">Customer</th>
                    <th className="p-4">Call Reason</th>
                    <th className="p-4">Brand / Branch</th>
                    <th className="p-4">Agent</th>
                    <th className="p-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#27272a]">
                  {teamLogs.map((i) => (
                    <tr key={i.id} className="hover:bg-[#1c1c1f]/40 transition">
                      <td className="p-4 font-mono text-[11px] text-zinc-400">{i.interaction_date} {i.interaction_time}</td>
                      <td className="p-4">
                        <div className="font-bold text-white">{i.customer_name}</div>
                        <div className="font-mono text-[10px] text-zinc-500" dir="ltr">{i.customer_phone}</div>
                      </td>
                      <td className="p-4"><span className="font-bold text-blue-400">{i.call_reason || i.interaction_type}</span></td>
                      <td className="p-4">
                        <div className="font-bold text-zinc-300">{i.brand}</div>
                        {i.branch && <div className="text-[10px] text-amber-400">{i.branch}</div>}
                      </td>
                      <td className="p-4 text-zinc-400">{i.agent_name}</td>
                      <td className="p-4"><span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold ${statusBadge(i.status)}`}>{i.status}</span></td>
                    </tr>
                  ))}
                  {teamLogs.length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-zinc-500">No logs for the {activeTeam} yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-4 bg-[#0a0a0b] text-[11px] text-[#71717a] border-t border-[#27272a]">
              {activeTeam}: <strong className="text-white">{teamLogs.length} records</strong>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
