import { useCallback, useEffect, useMemo, useState } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import { dncKey } from "../lib/dnc.ts";
import { PhoneOff, Search, Download, Trash2, AlertCircle, CheckCircle2, Plus } from "lucide-react";

// Customers who asked us not to contact them again. Survey uploads skip them, the Survey Queue hides them, and
// every screen where an agent sees the number (queue, survey, reviews, All Surveys) shows a red DO NOT CALL label.

interface Entry { phone_key: string; phone: string; reason: string | null; source: string | null; assignment_id: string | null; added_by: string | null; added_by_name: string | null; added_at: string }
const KW_MS = 3 * 3600_000;
const fmt = (ts: string) => new Date(new Date(ts).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16);
const SOURCE: Record<string, string> = { survey: "Survey call", review: "Review follow-up", manual: "Added by hand" };

export default function DoNotCall({ currentUser }: { currentUser: User }) {
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError("");
      const res = await apiFetch("/api/do-not-call");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load the list.");
      setRows(await res.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setError(""); setMsg("");
    if (!dncKey(phone)) { setError("Enter the customer's phone number (at least 8 digits)."); return; }
    setSaving(true);
    try {
      const res = await apiFetch("/api/do-not-call", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), reason: reason.trim(), source: "manual" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not add the number.");
      setMsg(d.added ? `Added ${phone.trim()}.${d.closed ? ` ${d.closed} waiting survey(s) of this number were closed.` : ""}` : `${phone.trim()} was already on the list.`);
      setPhone(""); setReason("");
      load();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  const remove = async (r: Entry) => {
    if (!window.confirm(`Take ${r.phone} off the Do Not Call list?\nThis customer asked not to be contacted — only do this if they agreed to be called again.`)) return;
    setError(""); setMsg("");
    const res = await apiFetch(`/api/do-not-call/${encodeURIComponent(r.phone_key)}`, { method: "DELETE" });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Could not remove it."); return; }
    setMsg(`${r.phone} was taken off the list.`);
    load();
  };

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => rows.filter((r) => !q || [r.phone, r.phone_key, r.reason, r.added_by_name].some((x) => (x || "").toLowerCase().includes(q))), [rows, q]);
  const exportCsv = () => downloadCSV(
    ["Phone", "Reason", "Source", "Added by", "Added at (Kuwait)"],
    shown.map((r) => [r.phone, r.reason || "", SOURCE[r.source || ""] || r.source || "", r.added_by_name || "", fmt(r.added_at)]),
    `do_not_call_${new Date().toISOString().slice(0, 10)}`,
  );
  const inputCls = "px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-rose-500 focus:outline-none";

  return (
    <div className="space-y-6 text-[var(--text)]">
      <div className="bg-gradient-to-r from-[var(--surface)] via-[var(--surface-2)] to-[var(--bg)] border border-[var(--border)] p-6 rounded-3xl shadow-xl">
        <span className="bg-rose-950/45 text-rose-400 text-xs font-bold px-3 py-1 rounded-full border border-rose-500/30">Do Not Call</span>
        <h1 className="text-2xl font-extrabold text-[var(--heading)] tracking-tight mt-2 flex items-center gap-2"><PhoneOff className="w-6 h-6 text-rose-400" /> Customers who asked not to be called</h1>
        <p className="text-[var(--muted)] text-sm mt-1 font-light">These numbers are skipped when numbers are uploaded, hidden from the Survey Queue, and marked with a red <b className="text-rose-400">DO NOT CALL</b> label wherever an agent sees them. Agents add a customer by ticking "The customer asked not to be called again" while closing a survey.</p>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-lg flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">Phone number
          <input value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="e.g. 94449544" dir="ltr" className={inputCls + " w-44 font-mono"} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)] flex-1 min-w-[220px]">Reason (optional)
          <input value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="e.g. called us and asked to stop the survey calls" className={inputCls + " w-full"} />
        </label>
        <button onClick={add} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"><Plus className="w-4 h-4" /> {saving ? "Adding…" : "Add to the list"}</button>
      </div>

      {error && <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>}
      {msg && <div className="p-3 rounded-xl text-xs border bg-emerald-950/20 border-emerald-500/20 text-emerald-400 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> {msg}</div>}

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg overflow-hidden">
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-[var(--border)]">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-2.5" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a number, reason or person…" className={inputCls + " w-full pl-9"} />
          </div>
          <span className="text-xs text-[var(--muted)]">{loading ? "Loading…" : `${shown.length} of ${rows.length} number(s)`}</span>
          <button onClick={exportCsv} disabled={!shown.length} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> CSV</button>
        </div>
        {!shown.length && !loading ? <div className="text-center py-10 text-[var(--muted)] text-xs">{rows.length ? "No number matches the search." : "No customer is on the list yet."}</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] bg-[var(--surface-2)]/40">
                  <th className="text-left py-3 px-4">Phone</th><th className="text-left py-3 px-4">Reason</th><th className="text-left py-3 px-4">Source</th>
                  <th className="text-left py-3 px-4">Added by</th><th className="text-left py-3 px-4">Added (Kuwait)</th><th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.phone_key} className="border-b border-[var(--border)]/40 last:border-0 hover:bg-[var(--surface-2)]/30">
                    <td className="py-2.5 px-4 font-mono font-bold text-[var(--heading)]" dir="ltr">{r.phone}</td>
                    <td className="py-2.5 px-4 max-w-[26rem]">{r.reason || <span className="text-[var(--muted)]">—</span>}</td>
                    <td className="py-2.5 px-4">{SOURCE[r.source || ""] || r.source || "—"}</td>
                    <td className="py-2.5 px-4">{r.added_by_name || "—"}</td>
                    <td className="py-2.5 px-4 font-mono whitespace-nowrap">{fmt(r.added_at)}</td>
                    <td className="py-2.5 px-4 text-right"><button onClick={() => remove(r)} title="Take off the list" className="p-1.5 rounded-lg text-[var(--muted)] hover:text-rose-400 hover:bg-rose-500/10"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px] text-[var(--muted)]">Signed in as {currentUser.full_name}. Every add and removal is recorded in the Audit page (Surveys tab).</p>
    </div>
  );
}
