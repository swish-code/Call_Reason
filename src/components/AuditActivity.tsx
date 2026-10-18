import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import { Filter, X, Download, RefreshCw, AlertCircle } from "lucide-react";

// Full action log of one area (surveys / ratings & reviews): every click that saved or opened something,
// who did it, when, on which record, and — for assignments — from whom to whom.

type Area = "surveys" | "ratings";

interface Row {
  id: string; timestamp: string; operator_id: string | null; operator_name: string | null; operator_role: string | null;
  action: string; details: string | null; related_ref: string | null; previous_value: string | null; new_value: string | null; ip_address: string | null;
  task_no: number | null; survey_phone: string | null; survey_order: string | null; survey_status: string | null; survey_brand: string | null;
  rating_order: string | null; rating_phone: string | null; rating: number | null; rating_brand: string | null;
}

const KW_MS = 3 * 3600_000;
const fmt = (ts: string) => new Date(new Date(ts).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 19);
const PAGE = 200;

// "POST /api/surveys/assignments/sasg-1/response" -> a plain-language label. First match wins.
const LABELS: [RegExp, string][] = [
  [/^GET \/api\/surveys\/assignments\//, "Viewed a survey"],
  [/\/assignments\/[^/]+\/work\/start$/, "Opened a survey"],
  [/\/assignments\/[^/]+\/response$/, "Saved the survey result"],
  [/\/assignments\/[^/]+\/attempt$/, "Logged a call attempt"],
  [/\/assignments\/[^/]+\/assign$/, "Assigned / reassigned a survey"],
  [/^PATCH \/api\/surveys\/assignments\//, "Edited a survey's outcome"],
  [/\/surveys\/work\/[^/]+\/end$/, "Closed the survey timer"],
  [/\/surveys\/work\/[^/]+\/beat$/, "Timer heartbeat (automatic)"],
  [/\/surveys\/campaigns\/[^/]+\/assign$/, "Bulk-assigned campaign numbers"],
  [/call-verification\/run$/, "Ran call verification"],
  [/call-verification\/probe$/, "Tested XonTel"],
  [/call-verification\/links/, "Changed a XonTel link"],
  [/XonTel user/, "Changed a XonTel link"],
  [/^POST \/api\/survey-campaigns\/[^/]+\/numbers$/, "Uploaded numbers to a campaign"],
  [/^POST \/api\/survey-campaigns$/, "Created a campaign"],
  [/^PATCH \/api\/survey-campaigns\//, "Edited a campaign"],
  [/^POST \/api\/survey-templates$/, "Created a survey template"],
  [/^PUT \/api\/survey-templates\//, "Edited a survey template"],
  [/^POST \/api\/survey-records\/.*upload$/, "Uploaded survey data"],
  [/^POST \/api\/survey-records\/delete$/, "Deleted survey data"],
  [/^POST \/api\/survey-records\/dedupe$/, "Removed duplicate survey data"],
  [/^GET \/api\/ratings\//, "Opened a review"],
  [/^PATCH \/api\/ratings\//, "Updated a review"],
  [/^POST \/api\/ratings\/[^/]+\/attempts$/, "Logged a call attempt"],
  [/^POST \/api\/ratings\/upload$/, "Uploaded reviews"],
  [/^POST \/api\/ratings\/assign$/, "Assigned reviews"],
  [/^POST \/api\/ratings\/bulk-status$/, "Changed status of several reviews"],
  [/^POST \/api\/ratings\/delete$/, "Deleted reviews"],
  [/backfill/, "Filled missing phones"],
];
const label = (action: string) => LABELS.find(([re]) => re.test(action))?.[1] || action;

const recordOf = (r: Row): string => {
  if (r.task_no != null || r.survey_phone) {
    return [r.task_no != null ? `Task #${r.task_no}` : "", r.survey_phone, r.survey_order, r.survey_brand, r.survey_status ? `(${r.survey_status})` : ""].filter(Boolean).join(" · ");
  }
  if (r.rating_order || r.rating_phone) {
    return [r.rating_order, r.rating_phone, r.rating_brand, r.rating != null ? `${r.rating}★` : ""].filter(Boolean).join(" · ");
  }
  return r.related_ref || "";
};

const changeOf = (r: Row): string => {
  if (r.previous_value || r.new_value) return `${r.previous_value || "—"}  →  ${r.new_value || "—"}`;
  return "";
};

export default function AuditActivity({ area }: { area: Area }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [operators, setOperators] = useState<{ operator_id: string; operator_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [operator, setOperator] = useState("");
  const [search, setSearch] = useState("");
  const [heartbeats, setHeartbeats] = useState(false);

  const query = useCallback((offset: number, limit: number) => {
    const qs = new URLSearchParams({ area, limit: String(limit), offset: String(offset) });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (operator) qs.set("operator", operator);
    if (search.trim()) qs.set("search", search.trim());
    if (heartbeats) qs.set("heartbeats", "1");
    return apiFetch(`/api/audit/activity?${qs}`);
  }, [area, from, to, operator, search, heartbeats]);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError("");
      const res = await query(0, PAGE);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load the log.");
      const d = await res.json();
      setRows(d.rows); setTotal(d.total); setOperators(d.operators);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [query]);
  useEffect(() => { load(); }, [load]);

  const more = async () => {
    try {
      setLoading(true);
      const res = await query(rows.length, PAGE);
      if (!res.ok) throw new Error("Failed to load more.");
      const d = await res.json();
      setRows((prev) => [...prev, ...d.rows]); setTotal(d.total);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const exportCsv = async () => {
    try {
      setLoading(true);
      const res = await query(0, 5000);
      if (!res.ok) throw new Error("Export failed.");
      const d = await res.json();
      downloadCSV(
        ["Date & Time (Kuwait)", "Who", "Role", "Action", "Record", "Change", "Details", "IP"],
        (d.rows as Row[]).map((r) => [fmt(r.timestamp), r.operator_name || "", r.operator_role || "", label(r.action), recordOf(r), changeOf(r), r.details || "", r.ip_address || ""]),
        `${area}_activity_${new Date().toISOString().slice(0, 10)}`,
      );
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const hasFilter = !!(from || to || operator || search || heartbeats);
  const clear = () => { setFrom(""); setTo(""); setOperator(""); setSearch(""); setHeartbeats(false); };
  const inputCls = "px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none";
  const selCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";
  const what = area === "surveys" ? "survey" : "review";

  return (
    <div className="space-y-6 text-[var(--text)]">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-lg flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-[var(--heading)] font-bold text-sm mr-1"><Filter className="w-4 h-4 text-blue-400" /> Filter</div>
        <select value={operator} onChange={(e) => setOperator(e.target.value)} className={selCls}>
          <option value="">Everyone</option>
          {operators.map((o) => <option key={o.operator_id} value={o.operator_id}>{o.operator_name}</option>)}
        </select>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">From
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">To
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </label>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Phone, order ID${area === "surveys" ? ", task #" : ""}…`} className={inputCls + " w-56"} />
        {area === "surveys" && (
          <label className="flex items-center gap-2 text-[11px] text-[var(--muted)] pb-2">
            <input type="checkbox" checked={heartbeats} onChange={(e) => setHeartbeats(e.target.checked)} />
            include the timer's automatic heartbeats
          </label>
        )}
        {hasFilter && <button onClick={clear} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-[var(--muted)] hover:text-[var(--heading)]"><X className="w-3.5 h-3.5" /> Clear</button>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} disabled={loading} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--bg)] disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
          <button onClick={exportCsv} disabled={loading || !total} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> CSV (up to 5,000)</button>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>}

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg overflow-hidden">
        <div className="px-4 py-3 text-xs text-[var(--muted)] border-b border-[var(--border)]">
          {loading && !rows.length ? "Loading…" : `${total.toLocaleString()} action(s)${hasFilter ? " match the filter" : ""} — newest first, Kuwait time. Every save, assignment and ${what} opened is recorded; nothing here can be edited or deleted.`}
        </div>
        {!rows.length && !loading ? (
          <div className="text-center py-10 text-[var(--muted)] text-xs">No actions recorded for this filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] bg-[var(--surface-2)]/40">
                  <th className="text-left py-3 px-4">Date &amp; Time</th>
                  <th className="text-left py-3 px-4">Who</th>
                  <th className="text-left py-3 px-4">Action</th>
                  <th className="text-left py-3 px-4">Record</th>
                  <th className="text-left py-3 px-4">Change</th>
                  <th className="text-left py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)]/40 last:border-0 hover:bg-[var(--surface-2)]/30 align-top">
                    <td className="py-2.5 px-4 font-mono whitespace-nowrap">{fmt(r.timestamp)}</td>
                    <td className="py-2.5 px-4 whitespace-nowrap"><span className="font-bold text-[var(--heading)]">{r.operator_name || "—"}</span>{r.operator_role && <span className="text-[var(--muted)]"> · {r.operator_role}</span>}</td>
                    <td className="py-2.5 px-4 font-bold text-[var(--heading)]" title={r.action}>{label(r.action)}</td>
                    <td className="py-2.5 px-4">{recordOf(r) || <span className="text-[var(--muted)]">—</span>}</td>
                    <td className="py-2.5 px-4 whitespace-nowrap text-amber-400">{changeOf(r)}</td>
                    <td className="py-2.5 px-4 text-[var(--muted)] break-words max-w-[28rem]">{r.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length < total && (
          <div className="p-3 text-center border-t border-[var(--border)]">
            <button onClick={more} disabled={loading} className="px-4 py-2 rounded-xl text-xs font-bold bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--bg)] disabled:opacity-50">
              {loading ? "Loading…" : `Show ${Math.min(PAGE, total - rows.length)} more (${rows.length} of ${total.toLocaleString()} shown)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
