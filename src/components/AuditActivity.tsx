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
  survey_customer: string | null; survey_branch: string | null; survey_order_date: string | null; survey_item: string | null; survey_platform: string | null;
  rating_customer: string | null; rating_branch: string | null; rating_order_date: string | null; rating_text: string | null;
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
  [/^POST \/api\/do-not-call$/, "Added a customer to Do Not Call"],
  [/^DELETE \/api\/do-not-call\//, "Removed a customer from Do Not Call"],
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

// Which order / customer a row is about, as labelled lines (so "Order", "Customer", "Task" are never guessed).
const recordLines = (r: Row): string[] => {
  const kind = r.task_no != null || r.survey_phone || r.survey_order ? "survey" : r.rating_order || r.rating_phone ? "rating" : "";
  if (kind === "survey") {
    return [
      [r.survey_order ? `Order ${r.survey_order}` : "", r.survey_brand, r.survey_platform].filter(Boolean).join(" · "),
      [r.survey_customer ? `Customer: ${r.survey_customer}` : "Customer", r.survey_phone].filter(Boolean).join(" · "),
      [r.survey_branch ? `Branch: ${r.survey_branch}` : "", r.survey_order_date ? `Order date: ${String(r.survey_order_date).slice(0, 10)}` : ""].filter(Boolean).join(" · "),
      r.survey_item ? `Item: ${r.survey_item.length > 70 ? r.survey_item.slice(0, 70) + "…" : r.survey_item}` : "",
      [r.task_no != null ? `Survey task #${r.task_no}` : "", r.survey_status ? `status now: ${r.survey_status}` : ""].filter(Boolean).join(" · "),
    ].filter(Boolean);
  }
  if (kind === "rating") {
    return [
      [r.rating_order ? `Order ${r.rating_order}` : "", r.rating_brand, r.rating != null ? `rated ${r.rating}★` : ""].filter(Boolean).join(" · "),
      [r.rating_customer ? `Customer: ${r.rating_customer}` : "", r.rating_phone].filter(Boolean).join(" · "),
      [r.rating_branch ? `Branch: ${r.rating_branch}` : "", r.rating_order_date ? `Order date: ${String(r.rating_order_date).slice(0, 10)}` : ""].filter(Boolean).join(" · "),
    ].filter(Boolean);
  }
  return r.related_ref ? [`Record ${r.related_ref}`] : [];
};
const recordOf = (r: Row): string => recordLines(r).join(" | ");

// ---- Plain-language sentence for each action (the raw request text stays in the tooltip) ----
const pretty = (v: string) => { const t = v.replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const OUTCOME: Record<string, string> = { busy: "line busy", no_answer: "no answer", wrong_number: "wrong number", declined: "customer declined", answered: "customer answered", switched_off: "phone switched off", voicemail: "voicemail" };
const kv = (details: string | null, key: string): string => {
  const m = String(details || "").match(new RegExp("(?:^|, )" + key + "=([^,]*)"));
  return m ? m[1].trim() : "";
};

export function describe(r: Row, names: Record<string, string>): string {
  const d = r.details || "";
  const act = r.action;
  const nm = (v: string) => names[v] || v;
  if (/\/api\/do-not-call/.test(act)) return d ? `${d}.` : "Changed the Do Not Call list.";
  if (/^GET \/api\/surveys\/assignments\//.test(act)) return "Looked at the survey details.";
  if (/^GET \/api\/ratings\//.test(act)) return "Opened the review to look at it.";
  if (/\/work\/start$/.test(act)) return "Started working on this survey.";
  if (/\/surveys\/work\/[^/]+\/end$/.test(act)) {
    const reason = kv(d, "reason");
    return reason === "saved" ? "Survey saved — the timer stopped."
      : reason === "closed" ? "Left the survey screen."
      : reason === "idle" ? "Timer stopped — no activity for a while."
      : reason ? `Timer stopped (${reason.replace(/_/g, " ")}).` : "Timer stopped.";
  }
  if (/\/surveys\/work\/[^/]+\/beat$/.test(act)) return "Automatic timer signal while the survey was open.";
  if (/\/assignments\/[^/]+\/response$/.test(act)) {
    const reach = kv(d, "reachability"), outcome = kv(d, "outcome"), action = kv(d, "action_type");
    const dncNote = kv(d, "do_not_call") === "true" ? " The customer asked not to be called again — added to Do Not Call." : "";
    if (reach === "not_reached") return "Could not reach the customer — saved as not reached.";
    if (outcome === "refused") return "Reached the customer, who refused to take the survey." + dncNote;
    if (outcome === "not_interested") return "Reached the customer, who was not interested." + dncNote;
    return "Reached the customer and completed the survey" + (action === "complaint" ? " — the customer raised a complaint." : " — no complaint.") + dncNote;
  }
  if (/\/attempts?$/.test(act)) {
    const o = kv(d, "outcome"), note = kv(d, "note");
    return `Logged a call attempt: ${OUTCOME[o] || pretty(o || "no result")}` + (note ? ` (note: "${note}")` : "") + ".";
  }
  if (/\/assignments\/[^/]+\/assign$/.test(act)) {
    if (r.new_value || r.previous_value) return `Moved the survey from ${r.previous_value || "nobody"} to ${r.new_value || "nobody"}.`;
    const to = kv(d, "agent_id");
    return to ? `Assigned the survey to ${nm(to)}.` : "Removed the person assigned to the survey.";
  }
  if (/^PATCH \/api\/surveys\/assignments\//.test(act)) {
    const st = kv(d, "status"), ac = kv(d, "action_type"), re = kv(d, "reachability");
    const parts: string[] = [];
    if (st === "pending") parts.push("Sent the survey back to Pending so it can be done again");
    else if (st) parts.push(`Changed the survey result to "${pretty(st)}"`);
    if (ac === "complaint") parts.push("marked it as a complaint");
    if (ac === "no_action") parts.push("marked it as no complaint");
    if (re) parts.push(`set reachability to ${pretty(re).toLowerCase()}`);
    const s = parts.join(", ") || "Edited the survey";
    return s.charAt(0).toUpperCase() + s.slice(1) + ".";
  }
  if (/\/surveys\/campaigns\/[^/]+\/assign$/.test(act)) return `Gave ${kv(d, "count") || "some"} waiting numbers to ${nm(kv(d, "agent_id"))}.`;
  if (/^POST \/api\/survey-campaigns$/.test(act)) {
    const t = kv(d, "template_id"), days = kv(d, "duration_days");
    return `Created a campaign: ${pretty(kv(d, "survey_type") || "survey")}, ${kv(d, "requested_count")} numbers`
      + (kv(d, "brand_id") ? `, brand ${nm(kv(d, "brand_id"))}` : "") + (t ? `, template "${nm(t)}"` : "") + (days && days !== "0" ? `, ${days} days` : "") + ".";
  }
  if (/^PATCH \/api\/survey-campaigns\//.test(act)) return `Set the campaign to "${pretty(kv(d, "status") || "updated")}".`;
  if (/\/survey-campaigns\/[^/]+\/numbers$/.test(act)) return "Uploaded an Excel file of numbers to a campaign.";
  if (/^POST \/api\/survey-templates$/.test(act)) return "Created a survey template.";
  if (/^PUT \/api\/survey-templates\//.test(act)) return "Edited a survey template.";
  if (/\/survey-records\/.*upload$/.test(act)) return "Uploaded an Excel file of survey data.";
  if (/\/survey-records\/delete$/.test(act)) return "Deleted survey data.";
  if (/\/survey-records\/dedupe$/.test(act)) return "Removed duplicate survey data.";
  if (/call-verification\/run$/.test(act)) return "Started the call check against XonTel.";
  if (/call-verification\/probe$/.test(act)) return "Tested the XonTel connection.";
  if (/XonTel user/.test(act) || /call-verification\/links/.test(act)) {
    const un = /^Unlink/.test(act);
    const m = d.match(/^(.*) = (.*) \(\d+\)$/);
    return m ? `${un ? "Unlinked" : "Linked"} ${m[1]} ${un ? "from" : "to"} XonTel user "${m[2]}".` : (un ? "Removed a XonTel link." : "Changed a XonTel link.");
  }
  if (/^POST \/api\/ratings\/upload$/.test(act)) {
    const mode = kv(d, "mode");
    return "Uploaded an Excel file of reviews" + (mode === "overwrite" ? " (overwriting existing ones)." : mode === "skip" ? " (skipping ones already uploaded)." : ".");
  }
  if (/^PATCH \/api\/ratings\//.test(act)) {
    const st = kv(d, "action_status"), note = kv(d, "action_note");
    const parts: string[] = [];
    if (st) parts.push(`Set the review status to "${pretty(st)}"`);
    if (note) parts.push(`with the note "${note.length > 80 ? note.slice(0, 80) + "…" : note}"`);
    if (/customer_(phone|name)=/.test(d) && !st) parts.push("Edited the customer's name / phone");
    if (kv(d, "assigned_agent_id")) parts.push(`assigned it to ${nm(kv(d, "assigned_agent_id"))}`);
    return (parts.join(" ") || "Updated the review") + ".";
  }
  // "ids=[...]" is cut short in the log, so a long list is shown as "N+".
  const reviews = () => { const n = (d.match(/rat-[\d-]+/g) || []).length; return /…/.test(d.split(", ")[0] || "") ? `${n}+ reviews` : `${n} review${n === 1 ? "" : "s"}`; };
  if (/^POST \/api\/ratings\/assign$/.test(act)) { const to = kv(d, "assigned_agent_id"); return to && to !== "null" ? `Assigned ${reviews()} to ${nm(to)}.` : `Removed the assignee from ${reviews()}.`; }
  if (/^POST \/api\/ratings\/bulk-status$/.test(act)) return `Set ${reviews()} to "${pretty(kv(d, "action_status") || "a new status")}".`;
  if (/^POST \/api\/ratings\/delete$/.test(act)) return "Deleted reviews.";
  if (/backfill/.test(act)) return "Filled in missing customer phones from the order data.";
  return "";
}

export default function AuditActivity({ area }: { area: Area }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [operators, setOperators] = useState<{ operator_id: string; operator_name: string }[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
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
      setRows(d.rows); setTotal(d.total); setOperators(d.operators); setNames(d.names || {});
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [query]);
  useEffect(() => { load(); }, [load]);

  const more = async () => {
    try {
      setLoading(true);
      const res = await query(rows.length, PAGE);
      if (!res.ok) throw new Error("Failed to load more.");
      const d = await res.json();
      setRows((prev) => [...prev, ...d.rows]); setTotal(d.total); setNames((prev) => ({ ...prev, ...(d.names || {}) }));
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const exportCsv = async () => {
    try {
      setLoading(true);
      const res = await query(0, 5000);
      if (!res.ok) throw new Error("Export failed.");
      const d = await res.json();
      downloadCSV(
        ["Date & Time (Kuwait)", "Who", "Role", "Action", "Record", "What happened", "IP"],
        (d.rows as Row[]).map((r) => [fmt(r.timestamp), r.operator_name || "", r.operator_role || "", label(r.action), recordOf(r), describe(r, { ...names, ...(d.names || {}) }), r.ip_address || ""]),
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
                  <th className="text-left py-3 px-4">What happened</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)]/40 last:border-0 hover:bg-[var(--surface-2)]/30 align-top">
                    <td className="py-2.5 px-4 font-mono whitespace-nowrap">{fmt(r.timestamp)}</td>
                    <td className="py-2.5 px-4 whitespace-nowrap"><span className="font-bold text-[var(--heading)]">{r.operator_name || "—"}</span>{r.operator_role && <span className="text-[var(--muted)]"> · {r.operator_role}</span>}</td>
                    <td className="py-2.5 px-4 font-bold text-[var(--heading)]" title={r.action}>{label(r.action)}</td>
                    <td className="py-2.5 px-4 min-w-[16rem]">{(() => { const L = recordLines(r); return L.length ? L.map((t, i) => <div key={i} className={i === 0 ? "font-bold text-[var(--heading)]" : "text-[var(--muted)]"}>{t}</div>) : <span className="text-[var(--muted)]">—</span>; })()}</td>
                    <td className="py-2.5 px-4 text-[var(--text)] max-w-[34rem]" title={r.details || r.action}>{describe(r, names) || <span className="text-[var(--muted)]">—</span>}</td>
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
