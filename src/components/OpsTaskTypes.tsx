import React, { useState, useEffect, useCallback } from "react";
import { User, DropdownOption } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { ListChecks, Plus, X, AlertCircle, RefreshCw } from "lucide-react";

interface OpsTaskTypesProps { currentUser: User; }

export default function OpsTaskTypes({ currentUser }: OpsTaskTypesProps) {
  const [items, setItems] = useState<DropdownOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await apiFetch("/api/options/ops_task_type");
      if (!res.ok) throw new Error("Failed to load task types.");
      setItems(await res.json());
    } catch (e: any) {
      setError(e.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/ops-task-types", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Failed to add."); return; }
      setLabel("");
      fetchAll();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete task type "${name}"?`)) return;
    const res = await apiFetch(`/api/ops-task-types/${id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Failed to delete."); return; }
    fetchAll();
  };

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl"><ListChecks className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">Task Types</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">The list every Operations Task's title is picked from.</p>
          </div>
        </div>
        <button onClick={fetchAll} className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl space-y-4">
        {loading ? (
          <div className="flex items-center justify-center min-h-[120px]">
            <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {items.map((it) => (
              <span key={it.id} className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 bg-[var(--bg)] border border-[var(--border)]/70 rounded-xl text-xs font-bold text-[var(--heading)]">
                {it.label}
                <button type="button" onClick={() => remove(it.id, it.label)} className="p-0.5 text-[var(--muted)] hover:text-rose-400 rounded"><X className="w-3.5 h-3.5" /></button>
              </span>
            ))}
            {items.length === 0 && <span className="text-[var(--muted)] text-xs">No task types yet — add one below.</span>}
          </div>
        )}
        <form onSubmit={add} className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Add new task type…"
            className="flex-1 px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs font-bold text-[var(--heading)] placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button type="submit" disabled={saving} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 active:scale-95 transition">
            <Plus className="w-4 h-4" /> Add
          </button>
        </form>
      </div>
    </div>
  );
}
