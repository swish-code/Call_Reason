import { useState, useEffect, useCallback } from "react";
import { User, OpsTask } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { Building2, Plus, X, AlertCircle, RefreshCw } from "lucide-react";

interface OpsTasksProps { currentUser: User; }

interface BranchOption { id: string; branch_name: string; area_name?: string | null; }
interface AgentOption { id: string; full_name: string; role: string; }

const inputCls = "px-3 py-2.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none";
const selCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";

const statusColor = (s: string) =>
  s === "Completed" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
  : s === "In Progress" ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
  : "bg-amber-500/10 text-amber-400 border-amber-500/20";

const KW_MS = 3 * 60 * 60 * 1000;
const fmtDate = (ts?: string | null) => {
  if (!ts) return "—";
  const t = new Date(ts).getTime();
  if (isNaN(t)) return String(ts);
  return new Date(t + KW_MS).toISOString().replace("T", " ").slice(0, 16);
};

export default function OpsTasks({ currentUser }: OpsTasksProps) {
  const canCreate = currentUser.role === "admin" || currentUser.role === "ops_manager";
  const canReassign = currentUser.role === "admin" || currentUser.role === "ops_manager" || currentUser.role === "area_manager";

  const [tasks, setTasks] = useState<OpsTask[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  // Create modal
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [branchId, setBranchId] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const fetchTasks = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await apiFetch("/api/ops-tasks");
      if (!res.ok) throw new Error("Failed to load tasks.");
      setTasks(await res.json());
    } catch (e: any) {
      setError(e.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    apiFetch("/api/ops-tasks/agents").then(r => r.ok ? r.json() : []).then(setAgents).catch(() => {});
    if (canCreate) apiFetch("/api/branches").then(r => r.ok ? r.json() : []).then(setBranches).catch(() => {});
  }, [canCreate]);

  const resetModal = () => {
    setTitle(""); setDescription(""); setBranchId(""); setAssignTo("");
    setPriority("Medium"); setDueDate(""); setModalError("");
  };

  const openNew = () => { resetModal(); setShowModal(true); };

  const handleCreate = async () => {
    setModalError("");
    if (!title.trim()) { setModalError("Title is required."); return; }
    if (!branchId) { setModalError("Select a branch."); return; }
    setSaving(true);
    try {
      const res = await apiFetch("/api/ops-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(), description: description.trim() || null, branch_id: branchId,
          assigned_to: assignTo || null, priority, due_date: dueDate || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setModalError(data.error || "Failed to create task."); return; }
      setShowModal(false);
      fetchTasks();
    } catch (e: any) {
      setModalError(e.message || "Error creating task.");
    } finally {
      setSaving(false);
    }
  };

  const patchTask = async (id: string, body: Record<string, any>) => {
    setSavingId(id);
    try {
      const res = await apiFetch(`/api/ops-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Update failed."); return; }
      await fetchTasks();
    } catch (e: any) {
      setError(e.message || "Update error.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl"><Building2 className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">Operations Tasks</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">{tasks.length} task(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchTasks} className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          {canCreate && (
            <button onClick={openNew} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 transition">
              <Plus className="w-4 h-4" /> New Task
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center min-h-[240px]">
          <div className="w-10 h-10 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg)] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                <tr>
                  <th className="p-4">Title</th>
                  <th className="p-4">Branch</th>
                  <th className="p-4">Area</th>
                  <th className="p-4">Assigned To</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Priority</th>
                  <th className="p-4">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {tasks.map(t => (
                  <tr key={t.id} className="hover:bg-[var(--surface-2)]/40 transition align-middle">
                    <td className="p-4 font-bold text-[var(--heading)]">
                      {t.title}
                      {t.description && <div className="text-[11px] text-[var(--muted)] font-normal mt-0.5 max-w-[220px] truncate" title={t.description}>{t.description}</div>}
                    </td>
                    <td className="p-4 text-[var(--text)]">{t.branch_name || "—"}</td>
                    <td className="p-4 text-[var(--muted)]">{t.area_name || "—"}</td>
                    <td className="p-4">
                      {canReassign ? (
                        <select
                          value={t.assigned_to || ""}
                          disabled={savingId === t.id}
                          onChange={e => patchTask(t.id, { assigned_to: e.target.value || null })}
                          className={selCls + " min-w-[9rem]"}
                        >
                          <option value="">— Unassigned —</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                          {t.assigned_to && !agents.some(a => a.id === t.assigned_to) && (
                            <option value={t.assigned_to}>{t.assigned_to_name}</option>
                          )}
                        </select>
                      ) : (
                        t.assigned_to_name || <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="p-4">
                      <select
                        value={t.status}
                        disabled={savingId === t.id}
                        onChange={e => patchTask(t.id, { status: e.target.value })}
                        className={`${selCls} min-w-[8rem] border ${statusColor(t.status)}`}
                      >
                        <option value="New">New</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </td>
                    <td className="p-4 text-[var(--muted)]">{t.priority || "—"}</td>
                    <td className="p-4 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">{t.due_date || "—"}</td>
                  </tr>
                ))}
                {tasks.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-[var(--muted)]">No tasks found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-y-auto p-4">
          <div className="min-h-full flex items-start justify-center">
            <div className="w-full max-w-lg my-6 bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg)]">
                <h3 className="text-sm font-extrabold text-[var(--heading)] flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-indigo-400" /> New Operations Task
                </h3>
                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--heading)] rounded-xl transition">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--text)]">Title</label>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title" className={`w-full ${inputCls}`} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--text)]">Description</label>
                  <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={`w-full resize-none ${inputCls}`} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--text)]">Branch</label>
                    <select value={branchId} onChange={e => setBranchId(e.target.value)} className={`w-full ${selCls}`}>
                      <option value="">— Select —</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.branch_name}{b.area_name ? ` (${b.area_name})` : ""}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--text)]">Assign To</label>
                    <select value={assignTo} onChange={e => setAssignTo(e.target.value)} className={`w-full ${selCls}`}>
                      <option value="">— Unassigned —</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.full_name} ({a.role})</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--text)]">Priority</label>
                    <select value={priority} onChange={e => setPriority(e.target.value)} className={`w-full ${selCls}`}>
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                      <option value="Critical">Critical</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--text)]">Due Date</label>
                    <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={`w-full ${inputCls}`} />
                  </div>
                </div>

                {modalError && (
                  <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {modalError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setShowModal(false)} className="px-4 py-2 bg-[var(--surface-2)] text-[var(--text)] rounded-xl text-xs font-bold transition">
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={saving}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition"
                  >
                    {saving ? "Saving…" : "Create Task"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
