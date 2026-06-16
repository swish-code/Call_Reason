import { useState, useEffect } from "react";
import { AuditLog, User } from "../types.js";
import { Users, RefreshCw, Download, AlertCircle, MessageSquareWarning, Headset, Wrench, ShieldCheck, Search, Activity } from "lucide-react";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";

interface AgentLogsProps {
  currentUser: User;
}

// Spec categories map onto the stored team category
const CATEGORIES: { key: string; label: string; icon: any }[] = [
  { key: "Complain Team", label: "Complaint Logs", icon: MessageSquareWarning },
  { key: "Call Center", label: "Call Center Logs", icon: Headset },
  { key: "Technical Team", label: "Technical Support Logs", icon: Wrench },
  { key: "Team Leader", label: "Team Leaders Logs", icon: ShieldCheck },
];

export default function AgentLogs({ currentUser }: AgentLogsProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeCat, setActiveCat] = useState<string>("Complain Team");
  const [search, setSearch] = useState("");

  const fetchLogs = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch("/api/audit-logs");
      if (!res.ok) throw new Error("Failed to load activity logs.");
      setLogs(await res.json());
    } catch (err: any) {
      setError(err.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  const catLogs = logs.filter((l) => (l.category || "") === activeCat);
  const q = search.trim().toLowerCase();
  const filtered = q
    ? catLogs.filter((l) =>
        [l.operator_name, l.action, l.details, l.related_ref].some((v) => (v || "").toLowerCase().includes(q))
      )
    : catLogs;

  const fmt = (ts: string) => {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.toISOString().split("T")[0]} ${d.toTimeString().split(" ")[0].slice(0, 5)}`;
  };

  const handleExport = () => {
    const headers = ["User Name", "Role", "Action", "Date & Time", "Comments / Notes", "Related Reference"];
    const rows = filtered.map((l) => [l.operator_name, l.operator_role || "", l.action, fmt(l.timestamp), l.details || "", l.related_ref || ""]);
    const safeCat = (CATEGORIES.find((c) => c.key === activeCat)?.label || activeCat).replace(/\s+/g, "_");
    downloadCSV(headers, rows, `Agent_Logs_${safeCat}`);
  };

  const roleBadge = (r?: string) => {
    if (r === "admin") return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
    if (r === "leader") return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    return "bg-blue-500/10 text-blue-400 border border-blue-500/20";
  };

  return (
    <div className="space-y-6 animate-fade-in text-[#e4e4e7]">
      {/* Header */}
      <div className="bg-[#121214] p-5 border border-[#27272a] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl"><Users className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-white">Agent Logs — Activity Tracking</h2>
            <p className="text-xs text-[#71717a] font-light mt-0.5">User activities recorded across the four operational teams.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchLogs} className="p-3 text-zinc-300 hover:text-white bg-[#0a0a0b] hover:bg-zinc-800 border border-[#27272a] rounded-2xl active:scale-95 transition" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={handleExport} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 shadow shadow-emerald-500/10 transition"><Download className="w-4 h-4" /> Export to CSV</button>
        </div>
      </div>

      {/* Category tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          const count = logs.filter((l) => (l.category || "") === c.key).length;
          const active = activeCat === c.key;
          return (
            <button key={c.key} onClick={() => setActiveCat(c.key)}
              className={`p-4 rounded-2xl border text-left transition flex items-center gap-3 ${active ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-950/40" : "bg-[#121214] text-[#71717a] border-[#27272a] hover:text-white hover:border-blue-500/30"}`}>
              <Icon className="w-5 h-5 shrink-0" />
              <div>
                <div className="text-xs font-extrabold leading-tight">{c.label}</div>
                <div className={`text-[10px] font-bold ${active ? "text-blue-100" : "text-zinc-500"}`}>{count} entries</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user, action, reference..." className="w-full pl-10 pr-4 py-3 bg-[#121214] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition" />
      </div>

      {error && (
        <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[260px]">
          <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-3 text-xs text-zinc-400">Loading activity logs...</p>
        </div>
      ) : (
        <div className="bg-[#121214] border border-[#27272a] rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0a0a0b] text-[#71717a] font-bold border-b border-[#27272a]">
                <tr>
                  <th className="p-4">User Name</th>
                  <th className="p-4">Role</th>
                  <th className="p-4">Action Performed</th>
                  <th className="p-4">Date &amp; Time</th>
                  <th className="p-4">Comments / Notes</th>
                  <th className="p-4">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272a]">
                {filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-[#1c1c1f]/40 transition align-top">
                    <td className="p-4 font-bold text-white">{l.operator_name}</td>
                    <td className="p-4"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${roleBadge(l.operator_role)}`}>{l.operator_role || "—"}</span></td>
                    <td className="p-4"><span className="font-bold text-blue-400 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> {l.action}</span></td>
                    <td className="p-4 font-mono text-[11px] text-zinc-400 whitespace-nowrap">{fmt(l.timestamp)}</td>
                    <td className="p-4 text-zinc-300 max-w-xs">{l.details}</td>
                    <td className="p-4 font-mono text-[10px] text-zinc-500">{l.related_ref || "—"}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-zinc-500">No activity recorded for this category yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="p-4 bg-[#0a0a0b] text-[11px] text-[#71717a] border-t border-[#27272a]">
            {CATEGORIES.find((c) => c.key === activeCat)?.label}: <strong className="text-white">{filtered.length} entries</strong>
          </div>
        </div>
      )}
    </div>
  );
}
