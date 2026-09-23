import { useEffect, useState } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import { FileSearch, Filter, X, Download, AlertCircle, RefreshCw, UploadCloud, Star, PhoneCall, ClipboardList } from "lucide-react";

interface Props { currentUser: User; }

interface Batch {
  id: string;
  upload_type: "ratings" | "survey_numbers" | "survey_records";
  sub_type: string | null;
  ref_id: string | null;
  ref_label: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  total_rows: number; inserted: number; skipped: number; errors: number; tasks: number;
  reconstructed: boolean;
  completed: number;     // rows of this batch that reached a "done" state
  denominator: number;   // rows that could be completed (ratings: actionable rows only)
  successful: number | null; // survey numbers only: surveyed successfully
}

const KW_MS = 3 * 60 * 60 * 1000;
const fmt = (iso: string) => new Date(new Date(iso).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16);

const TYPE_LABEL: Record<Batch["upload_type"], string> = { ratings: "Reviews", survey_numbers: "Survey Numbers", survey_records: "Survey Data" };
const SUB_LABEL: Record<string, string> = { new_items: "New Items", complaints: "Complaints", survey_history: "Survey History", skip: "skip duplicates", overwrite: "overwrite" };
const typeIcon = (t: Batch["upload_type"]) => t === "ratings" ? Star : t === "survey_numbers" ? PhoneCall : ClipboardList;
const typeTone = (t: Batch["upload_type"]) => t === "ratings" ? "text-amber-400" : t === "survey_numbers" ? "text-blue-400" : "text-sky-400";

// What "completed" means per type — shown as a legend so the numbers aren't a mystery.
const COMPLETED_MEANING: Record<Batch["upload_type"], string> = {
  ratings: "actionable reviews that were closed (auto-closed rows were never open, so they don't count)",
  survey_numbers: "numbers with a final call outcome (surveyed, unreachable, declined, refused or not interested)",
  survey_records: "records marked answered at upload (this type has no follow-up work)",
};

export default function AuditUploads({ currentUser }: Props) {
  const [rows, setRows] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [type, setType] = useState("");
  const [uploader, setUploader] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async (t = type, u = uploader, f = from, tt = to) => {
    try {
      setLoading(true); setError("");
      const qs = new URLSearchParams();
      if (t) qs.set("type", t);
      if (u) qs.set("uploaded_by", u);
      if (f) qs.set("from", f);
      if (tt) qs.set("to", tt);
      const res = await apiFetch(`/api/audit/uploads${qs.toString() ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load uploads.");
      setRows(await res.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load("", "", "", ""); }, []);

  const clearFilter = () => { setType(""); setUploader(""); setFrom(""); setTo(""); load("", "", "", ""); };
  const hasFilter = !!(type || uploader || from || to);

  // Uploader dropdown is built from whatever is loaded, so it only ever lists real uploaders.
  const uploaderMap = new Map<string, string>();
  rows.forEach((r) => { if (r.uploaded_by) uploaderMap.set(r.uploaded_by, r.uploaded_by_name || r.uploaded_by); });
  const uploaders = Array.from(uploaderMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));

  const totals = rows.reduce((a, r) => ({ uploads: a.uploads + 1, rows: a.rows + r.total_rows, inserted: a.inserted + r.inserted, completed: a.completed + r.completed, denominator: a.denominator + r.denominator }),
    { uploads: 0, rows: 0, inserted: 0, completed: 0, denominator: 0 });

  const describe = (r: Batch) => {
    if (r.upload_type === "survey_numbers") return r.ref_label || "Campaign";
    if (r.sub_type) return SUB_LABEL[r.sub_type] || r.sub_type;
    return "";
  };

  const exportCsv = () => {
    downloadCSV(
      ["Date & Time (Kuwait)", "Uploaded By", "Type", "Detail", "Rows in file", "Inserted", "Skipped", "Errors", "Completed", "Of", "Reconstructed"],
      rows.map((r) => [fmt(r.uploaded_at), r.uploaded_by_name || "", TYPE_LABEL[r.upload_type], describe(r), String(r.total_rows), String(r.inserted), String(r.skipped), String(r.errors), String(r.completed), String(r.denominator), r.reconstructed ? "yes" : "no"]),
      `upload_audit_${new Date().toISOString().slice(0, 10)}`,
    );
  };

  const inputCls = "px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none";
  const selCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";

  return (
    <div className="space-y-8 animate-fade-in text-[var(--text)]">
      {/* Banner */}
      <div className="bg-gradient-to-r from-[var(--surface)] via-[var(--surface-2)] to-[var(--bg)] border border-[var(--border)] p-6 md:p-8 rounded-3xl shadow-xl">
        <span className="bg-blue-950/45 text-blue-400 text-xs font-bold px-3 py-1 rounded-full border border-blue-500/30">Audit</span>
        <h1 className="text-2xl md:text-3xl font-extrabold text-[var(--heading)] tracking-tight mt-2">Upload Audit</h1>
        <p className="text-[var(--muted)] text-sm mt-1 font-light">Every file uploaded to the system — who, when, what, how many rows, and how much of it has been completed since.</p>
      </div>

      {/* Filters */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-lg flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-[var(--heading)] font-bold text-sm mr-1"><Filter className="w-4 h-4 text-blue-400" /> Filter</div>
        <select value={type} onChange={(e) => setType(e.target.value)} className={selCls}>
          <option value="">All types</option>
          <option value="ratings">Reviews</option>
          <option value="survey_numbers">Survey Numbers</option>
          <option value="survey_records">Survey Data</option>
        </select>
        <select value={uploader} onChange={(e) => setUploader(e.target.value)} className={selCls}>
          <option value="">All uploaders</option>
          {uploaders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">From</label>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">To</label>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </div>
        <button onClick={() => load()} disabled={loading} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" /> Apply</button>
        <button onClick={exportCsv} disabled={loading || rows.length === 0} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Export CSV</button>
        {hasFilter && <button onClick={clearFilter} className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:text-rose-400 font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Clear</button>}
        <button onClick={() => load()} className="ml-auto p-2.5 text-[var(--muted)] hover:text-[var(--heading)] bg-[var(--bg)] border border-[var(--border)] rounded-xl transition" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {error && <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>}

      {/* Totals for the current filter */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Uploads", value: totals.uploads, icon: UploadCloud, tone: "text-blue-400" },
          { label: "Rows in files", value: totals.rows, icon: FileSearch, tone: "text-[var(--heading)]" },
          { label: "Rows inserted", value: totals.inserted, icon: ClipboardList, tone: "text-sky-400" },
          { label: "Completed", value: totals.denominator ? `${totals.completed} / ${totals.denominator}` : "—", icon: Star, tone: "text-emerald-400" },
        ].map((c) => (
          <div key={c.label} className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl flex items-center gap-4">
            <div className={`p-3 rounded-xl bg-current/10 ${c.tone}`}><c.icon className={`w-6 h-6 ${c.tone}`} /></div>
            <div>
              <p className="text-[10px] text-[var(--muted)] font-bold uppercase">{c.label}</p>
              <h3 className="text-2xl font-bold text-[var(--heading)] tracking-tight font-mono">{c.value}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-lg overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[200px]"><div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-[var(--muted)] text-sm">No uploads match this filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] bg-[var(--surface-2)]/40">
                  <th className="text-left py-3 px-4">Date &amp; Time</th>
                  <th className="text-left py-3 px-4">Uploaded By</th>
                  <th className="text-left py-3 px-4">Type</th>
                  <th className="text-center py-3 px-4">Rows in file</th>
                  <th className="text-center py-3 px-4">Inserted</th>
                  <th className="text-center py-3 px-4">Skipped</th>
                  <th className="text-center py-3 px-4">Errors</th>
                  <th className="text-left py-3 px-4 min-w-[200px]">Completed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const Icon = typeIcon(r.upload_type);
                  const pct = r.denominator ? Math.round((r.completed / r.denominator) * 100) : 0;
                  const detail = describe(r);
                  return (
                    <tr key={r.id} className="border-b border-[var(--border)]/40 last:border-0 hover:bg-[var(--surface-2)]/30 transition">
                      <td className="py-3 px-4 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">
                        {fmt(r.uploaded_at)}
                        {r.reconstructed && <span className="ml-2 px-1.5 py-0.5 bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 rounded-md text-[9px] font-bold" title="Rebuilt from the data itself — counts are the rows found, not the original file">Reconstructed</span>}
                      </td>
                      <td className="py-3 px-4 font-bold text-[var(--heading)]">{r.uploaded_by_name || "—"}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1.5 font-bold text-[var(--heading)]"><Icon className={`w-3.5 h-3.5 ${typeTone(r.upload_type)}`} /> {TYPE_LABEL[r.upload_type]}</span>
                        {detail && <div className="text-[10px] text-[var(--muted)] mt-0.5">{detail}</div>}
                      </td>
                      <td className="py-3 px-4 text-center font-mono">{r.total_rows}</td>
                      <td className="py-3 px-4 text-center font-mono text-emerald-400">{r.inserted}</td>
                      <td className="py-3 px-4 text-center font-mono text-[var(--muted)]">{r.skipped}</td>
                      <td className="py-3 px-4 text-center font-mono">{r.errors > 0 ? <span className="text-rose-400 font-bold">{r.errors}</span> : <span className="text-[var(--muted)]">0</span>}</td>
                      <td className="py-3 px-4">
                        {r.denominator === 0 ? (
                          <span className="text-[var(--muted)]">{r.upload_type === "ratings" && r.inserted > 0 ? "nothing to action" : "—"}</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-[var(--surface-2)] h-2 rounded-full overflow-hidden"><div className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                            <span className="font-mono text-[11px] text-[var(--heading)] whitespace-nowrap">{r.completed} / {r.denominator} · {pct}%</span>
                            {r.upload_type === "survey_numbers" && r.successful != null && <span className="text-[10px] text-[var(--muted)] whitespace-nowrap">({r.successful} surveyed)</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-[11px] text-[var(--muted)] space-y-1">
        <p className="font-bold text-[var(--text)]">What "Completed" counts</p>
        {(Object.keys(COMPLETED_MEANING) as Batch["upload_type"][]).map((t) => <p key={t}>· <span className="font-bold">{TYPE_LABEL[t]}</span>: {COMPLETED_MEANING[t]}.</p>)}
      </div>
    </div>
  );
}
