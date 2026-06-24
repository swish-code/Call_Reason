import { useState, useEffect } from "react";
import { User, OpsLog, LogType, LOG_TYPE_CONFIG } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import { ClipboardList, RefreshCw, Download, Search, Pencil, Trash2, X, AlertCircle, Timer } from "lucide-react";
import OpsLogForm from "./OpsLogForm.tsx";

interface OpsLogsListProps {
  currentUser: User;
}

export default function OpsLogsList({ currentUser }: OpsLogsListProps) {
  const [logs, setLogs] = useState<OpsLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [editLog, setEditLog] = useState<OpsLog | null>(null);

  const isAgent = currentUser.role === "agent";

  const elapsedSeconds = (l: OpsLog) => Number(l.duration_seconds || 0);
  const fmtDur = (s: number) => {
    if (!s) return "—";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const fetchLogs = async () => {
    try {
      setLoading(true); setError("");
      const res = await apiFetch("/api/logs");
      if (!res.ok) throw new Error("Failed to load logs.");
      setLogs(await res.json());
    } catch (err: any) {
      setError(err.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  const q = search.trim().toLowerCase();
  const filtered = logs.filter((l) => {
    if (typeFilter && l.log_type !== typeFilter) return false;
    if (statusFilter && l.status !== statusFilter) return false;
    if (q) {
      const hay = [l.activity_type, l.agent_name, l.branch, l.brand, l.order_number, l.customer_name, l.complaint_id, l.target_agent_name, l.notes].map((x) => (x || "").toLowerCase()).join(" ");
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Editing/deleting logs is restricted to Admin only
  const canModify = (_l: OpsLog) => currentUser.role === "admin";

  const remove = async (l: OpsLog) => {
    if (!confirm(`Delete this ${LOG_TYPE_CONFIG[l.log_type as LogType]?.title || "log"}?`)) return;
    const res = await apiFetch(`/api/logs/${l.id}`, { method: "DELETE" });
    if (res.ok) fetchLogs(); else alert("Failed to delete.");
  };

  const exportCsv = () => {
    const headers = ["Date & Time", "Type", "Department", "Activity", "Status", "Time Spent", "Agent", "Branch", "Brand", "Order #", "Customer", "Complaint ID", "Target Agent", "Notes"];
    const rows = filtered.map((l) => [
      (l.created_at || "").replace("T", " ").slice(0, 16), l.log_type, l.department || "", l.activity_type || "", l.status || "", fmtDur(elapsedSeconds(l)),
      l.agent_name || "", l.branch || "", l.brand || "", l.order_number || "", l.customer_name || "", l.complaint_id || "", l.target_agent_name || "", l.notes || l.action_taken || "",
    ]);
    downloadCSV(headers, rows, `Logs_${new Date().toISOString().split("T")[0]}`);
  };

  const title = isAgent ? "My Logs" : currentUser.role === "admin" ? "All Logs" : "Team Logs";
  const statusBadge = (s?: string) => {
    if (s === "Completed" || s === "Solved") return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    if (s === "In Progress" || s === "Waiting Feedback") return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    if (s === "Not Solved") return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
    return "bg-blue-500/10 text-blue-400 border border-blue-500/20";
  };
  const fmt = (ts?: string) => (ts ? ts.replace("T", " ").slice(0, 16) : "");

  return (
    <div className="space-y-6 animate-fade-in text-[#e4e4e7]">
      <div className="bg-[#121214] p-5 border border-[#27272a] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl"><ClipboardList className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-white">{title}</h2>
            <p className="text-xs text-[#71717a] font-light mt-0.5">{currentUser.department ? currentUser.department + " · " : ""}{filtered.length} record(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchLogs} className="p-3 text-zinc-300 hover:text-white bg-[#0a0a0b] hover:bg-zinc-800 border border-[#27272a] rounded-2xl active:scale-95 transition" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={exportCsv} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 transition"><Download className="w-4 h-4" /> Export CSV</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search activity, agent, branch, order..." className="w-full pl-10 pr-4 py-3 bg-[#121214] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition" />
        </div>
        {!isAgent && (
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-3 bg-[#121214] text-zinc-300 border border-[#27272a] rounded-2xl text-xs font-bold [&>option]:bg-[#121214]">
            <option value="">All Types</option>
            {(Object.keys(LOG_TYPE_CONFIG) as LogType[]).map((t) => <option key={t} value={t}>{LOG_TYPE_CONFIG[t].title}</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-3 bg-[#121214] text-zinc-300 border border-[#27272a] rounded-2xl text-xs font-bold [&>option]:bg-[#121214]">
          <option value="">All Statuses</option>
          {["Open", "In Progress", "Completed", "Solved", "Not Solved", "Waiting Feedback"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {error && (<div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>)}

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[240px]"><div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div>
      ) : (
        <div className="bg-[#121214] border border-[#27272a] rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0a0a0b] text-[#71717a] font-bold border-b border-[#27272a]">
                <tr>
                  <th className="p-4">Date &amp; Time</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Activity</th>
                  <th className="p-4">Details</th>
                  <th className="p-4">Agent</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Time</th>
                  <th className="p-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272a]">
                {filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-[#1c1c1f]/40 transition align-top">
                    <td className="p-4 font-mono text-[11px] text-zinc-400 whitespace-nowrap">{fmt(l.created_at)}</td>
                    <td className="p-4"><span className="text-[10px] font-bold text-zinc-400">{LOG_TYPE_CONFIG[l.log_type as LogType]?.title || l.log_type}</span></td>
                    <td className="p-4 font-bold text-blue-400">{l.activity_type}</td>
                    <td className="p-4 text-zinc-300">
                      <div className="space-y-0.5">
                        {l.branch && <div>🏠 {l.branch}{l.brand ? " · " + l.brand : ""}</div>}
                        {l.order_number && <div className="font-mono text-[10px] text-zinc-500">Order #{l.order_number}</div>}
                        {l.customer_name && <div>👤 {l.customer_name}</div>}
                        {l.complaint_id && <div className="font-mono text-[10px] text-zinc-500">CID {l.complaint_id}</div>}
                        {l.target_agent_name && <div>🎯 {l.target_agent_name}</div>}
                        {l.aggregator && <div className="text-[10px] text-zinc-500">{l.aggregator}</div>}
                        {(l.notes || l.action_taken) && <div className="text-[10px] text-zinc-500 line-clamp-2 max-w-xs">{l.notes || l.action_taken}</div>}
                      </div>
                    </td>
                    <td className="p-4 text-zinc-400">{l.agent_name}</td>
                    <td className="p-4">{l.status ? <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold ${statusBadge(l.status)}`}>{l.status}</span> : <span className="text-zinc-600">—</span>}</td>
                    <td className="p-4">
                      <span className="font-mono text-[11px] font-bold flex items-center gap-1 text-zinc-300">
                        <Timer className="w-3.5 h-3.5" />{fmtDur(elapsedSeconds(l))}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-1.5">
                        {canModify(l) && <button onClick={() => setEditLog(l)} className="p-1.5 bg-zinc-800 hover:bg-blue-500/10 hover:text-blue-400 text-zinc-300 border border-zinc-700 rounded-lg transition" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>}
                        {canModify(l) && <button onClick={() => remove(l)} className="p-1.5 bg-zinc-800 hover:bg-rose-500/10 hover:text-rose-400 text-zinc-300 border border-zinc-700 rounded-lg transition" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (<tr><td colSpan={8} className="p-8 text-center text-zinc-500">No logs found.</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editLog && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl my-8 relative">
            <button onClick={() => setEditLog(null)} className="absolute -top-2 -right-2 z-10 p-2 bg-[#1c1c1f] text-zinc-300 hover:text-white border border-[#27272a] rounded-full"><X className="w-4 h-4" /></button>
            <OpsLogForm currentUser={currentUser} editLog={editLog} onDone={() => { setEditLog(null); fetchLogs(); }} />
          </div>
        </div>
      )}
    </div>
  );
}
