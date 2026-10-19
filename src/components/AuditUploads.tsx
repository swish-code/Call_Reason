import { useEffect, useState } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import { FileSearch, Filter, X, Download, AlertCircle, RefreshCw, UploadCloud, Star, PhoneCall, ClipboardList, Trash2, CheckCircle2 } from "lucide-react";

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
  skip_breakdown: Record<string, number> | null; // why rows were skipped/rejected (null on older uploads)
  issue_count: number;   // skipped + rejected rows saved for the download list
}

// Why a row was skipped — short labels for the table, full ones are in the downloaded file.
const SKIP_LABEL: Record<string, string> = {
  dup_file: "duplicate in file",
  dup_10day: "surveyed in last 10 days",
  already_queued: "already in queue",
  do_not_call: "do not call",
  already_uploaded: "already uploaded",
  empty_row: "empty row",
};
const SKIP_HELP: Record<string, string> = {
  dup_file: "The same number (for the same brand) appears more than once in this file — only the first one was added.",
  dup_10day: "This customer was already surveyed for this brand in the last 10 days, so they are not called again yet.",
  already_queued: "This number is already waiting in the survey queue for this brand from an earlier upload.",
  do_not_call: "This customer asked us not to call them again (Surveys → Do Not Call), so they are not queued.",
  already_uploaded: "This order's review was uploaded before; in \"skip duplicates\" mode the existing review is kept.",
  empty_row: "The row had no order ID, phone, item, brand or rate.",
};
const skipParts = (b: Record<string, number> | null) =>
  b ? Object.entries(b).filter(([k, n]) => k !== "error" && Number(n) > 0).map(([k, n]) => ({ key: k, n: Number(n) })) : [];

const downloadBase64 = (b64: string, filename: string) => {
  const a = document.createElement("a");
  a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + b64;
  a.download = filename;
  a.click();
};

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
      setAppliedFilter(!!(t || u || f || tt));
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load("", "", "", ""); }, []);

  const clearFilter = () => { setType(""); setUploader(""); setFrom(""); setTo(""); load("", "", "", ""); };
  const hasFilter = !!(type || uploader || from || to);

  // ---- Delete (admin only) ----
  const isAdmin = currentUser.role === "admin";
  const [appliedFilter, setAppliedFilter] = useState(false); // is the LIST on screen filtered (not just the inputs)?
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState("");

  const deleteUploads = async (targets: Batch[]) => {
    if (!targets.length) return;
    setError(""); setDeleteMsg(""); setDeleting(true);
    try {
      const post = async (dry: boolean) => {
        const res = await apiFetch("/api/audit/uploads/delete", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: targets.map((t) => t.id), dry_run: dry }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "Delete failed.");
        return d.results as { upload_type: Batch["upload_type"]; reconstructed: boolean; sub_type: string | null; total: number; deletable: number; protected: number; deleted: number }[];
      };
      // Dry run first, so the confirmation shows exactly what will happen.
      const preview = await post(true);
      const del = preview.reduce((a, r) => a + r.deletable, 0);
      const kept = preview.reduce((a, r) => a + r.protected, 0);
      const overwrite = preview.some((r) => r.upload_type === "ratings" && r.sub_type === "overwrite");
      const rebuilt = preview.some((r) => r.reconstructed);
      if (del === 0 && kept === 0) { setDeleteMsg("Nothing left to delete in the selected upload(s)."); load(); return; }
      const msg = [
        `Delete ${targets.length} upload(s)?`,
        ``,
        `• ${del} row(s) will be deleted`,
        kept ? `• ${kept} row(s) will be KEPT because someone already worked on them` : `• No worked-on rows — nothing is protected`,
        ``,
        `Deleted rows are backed up and can be restored by a developer.`,
        overwrite ? `\nWarning: an "overwrite" review upload replaced older versions of its rows — deleting it deletes those reviews entirely.` : ``,
        rebuilt ? `\nWarning: this includes a historical upload that was rebuilt from existing data (marked Reconstructed).` : ``,
      ].filter((l) => l !== undefined).join("\n");
      if (del === 0) { window.alert(`Nothing can be deleted: all ${kept} row(s) were already worked on, so they're protected.`); return; }
      if (!window.confirm(msg)) return;
      const done = await post(false);
      const n = done.reduce((a, r) => a + r.deleted, 0);
      setDeleteMsg(`Deleted ${n} row(s) from ${done.length} upload(s).${kept ? ` ${kept} worked-on row(s) were kept.` : ""}`);
      await load();
    } catch (e: any) { setError(e.message); } finally { setDeleting(false); }
  };

  // ---- Skipped / rejected rows of one upload, as an Excel file ----
  const [downloadingId, setDownloadingId] = useState("");
  const downloadIssues = async (r: Batch) => {
    setError(""); setDownloadingId(r.id);
    try {
      const res = await apiFetch(`/api/audit/uploads/${encodeURIComponent(r.id)}/issues`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Download failed.");
      downloadBase64(d.file, d.filename);
    } catch (e: any) { setError(e.message); } finally { setDownloadingId(""); }
  };

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
      ["Date & Time (Kuwait)", "Uploaded By", "Type", "Detail", "Rows in file", "Inserted", "Skipped", "Skip reasons", "Errors", "Completed", "Of", "Reconstructed"],
      rows.map((r) => [fmt(r.uploaded_at), r.uploaded_by_name || "", TYPE_LABEL[r.upload_type], describe(r), String(r.total_rows), String(r.inserted), String(r.skipped),
        r.skip_breakdown ? skipParts(r.skip_breakdown).map((p) => `${p.n} ${SKIP_LABEL[p.key] || p.key}`).join("; ") : "",
        String(r.errors), String(r.completed), String(r.denominator), r.reconstructed ? "yes" : "no"]),
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
        {isAdmin && appliedFilter && rows.length > 0 && (
          <button onClick={() => deleteUploads(rows)} disabled={deleting || loading} className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5" title="Delete every upload currently listed">
            <Trash2 className="w-3.5 h-3.5" /> Delete all {rows.length} shown
          </button>
        )}
        {hasFilter && <button onClick={clearFilter} className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:text-rose-400 font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Clear</button>}
        <button onClick={() => load()} className="ml-auto p-2.5 text-[var(--muted)] hover:text-[var(--heading)] bg-[var(--bg)] border border-[var(--border)] rounded-xl transition" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {deleteMsg && <div className="p-4 bg-emerald-950/20 border border-emerald-500/20 rounded-3xl text-sm text-emerald-400 flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> {deleteMsg}</div>}
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
                  {isAdmin && <th className="py-3 px-4"></th>}
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
                      <td className="py-3 px-4 text-center">
                        <div className="font-mono text-[var(--muted)]">{r.skipped}</div>
                        {r.skipped > 0 && (r.skip_breakdown ? (
                          <div className="mt-1 space-y-0.5">
                            {skipParts(r.skip_breakdown).map((p) => (
                              <div key={p.key} title={SKIP_HELP[p.key] || ""} className="text-[10px] text-amber-400/90 whitespace-nowrap cursor-help">
                                <span className="font-mono font-bold">{p.n}</span> {SKIP_LABEL[p.key] || p.key}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-1 text-[9px] text-[var(--muted)] whitespace-nowrap" title="Uploaded before the system started recording skip reasons">no reasons recorded</div>
                        ))}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="font-mono">{r.errors > 0 ? <span className="text-rose-400 font-bold">{r.errors}</span> : <span className="text-[var(--muted)]">0</span>}</div>
                        {r.issue_count > 0 && (
                          <button onClick={() => downloadIssues(r)} disabled={downloadingId === r.id}
                            title="Download every skipped and rejected row of this upload, with the reason for each"
                            className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-md transition disabled:opacity-50 whitespace-nowrap">
                            <Download className="w-3 h-3" /> {downloadingId === r.id ? "…" : `List (${r.issue_count})`}
                          </button>
                        )}
                      </td>
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
                      {isAdmin && (
                        <td className="py-3 px-4 text-center">
                          <button onClick={() => deleteUploads([r])} disabled={deleting} title="Delete this upload's rows"
                            className="p-1.5 text-[var(--muted)] hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      )}
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
        <p className="font-bold text-[var(--text)] pt-2">Why rows are skipped</p>
        {Object.keys(SKIP_HELP).map((k) => <p key={k}>· <span className="font-bold">{SKIP_LABEL[k]}</span>: {SKIP_HELP[k]}</p>)}
        <p>· The <span className="font-bold">List</span> button downloads every skipped and rejected row of an upload with its reason. Uploads made before this was added show "no reasons recorded".</p>
      </div>
    </div>
  );
}
