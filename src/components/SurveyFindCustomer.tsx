import { useState } from "react";
import { Search, PhoneOff, ChevronDown } from "lucide-react";
import { apiFetch } from "../lib/api.ts";

// Find customer (agents and up): type a phone number and see every survey that was ever made for it — who handled it,
// how it ended, the call attempts and the answers. Read-only; working a survey stays in Survey Queue.

const KW_MS = 3 * 60 * 60 * 1000;
const fmt = (ts?: string | null) => {
  if (!ts) return "—";
  const t = new Date(ts).getTime();
  return isNaN(t) ? String(ts) : new Date(t + KW_MS).toISOString().replace("T", " ").slice(0, 16);
};

const statusView = (s: string): { label: string; cls: string } => {
  if (s === "successful") return { label: "Completed", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
  if (s === "unreachable" || s === "declined") return { label: "Not Reached", cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" };
  if (s === "refused") return { label: "Refused to Complete", cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" };
  if (s === "not_interested") return { label: "Not Interested", cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" };
  if (s === "cancelled") return { label: "Order Cancelled", cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" };
  if (s === "in_progress") return { label: "In Progress", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" };
  return { label: "Pending", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" };
};
const typeLabel = (t?: string) => t === "daily_normal" ? "Daily / Normal" : t === "marketing_general" ? "Marketing (General)" : t === "marketing_item" ? "Marketing (Item)" : "";
const outcomeLabel = (o: string) => ({ answered: "Answered", no_answer: "No answer", busy: "Busy", switched_off: "Switched off", wrong_number: "Wrong number", no_phone: "No phone" } as Record<string, string>)[o] || o.replace(/_/g, " ");

const box = "bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-lg";
const inputCls = "px-3 py-2.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none";

export default function SurveyFindCustomer() {
  const [phone, setPhone] = useState("");
  const [res, setRes] = useState<{ rows: any[]; dnc: any } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const search = async () => {
    setError(""); setBusy(true); setOpenId(null);
    try {
      const r = await apiFetch(`/api/surveys/lookup?phone=${encodeURIComponent(phone.trim())}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Search failed.");
      setRes(d);
    } catch (e: any) { setError(e.message || "Search failed."); setRes(null); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className={box + " p-4 flex flex-wrap items-end gap-3"}>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">The customer's phone number
          <input value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} dir="ltr" inputMode="numeric"
            placeholder="e.g. 99999999" className={inputCls + " w-56 font-mono text-sm"} autoFocus />
        </label>
        <button onClick={search} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
          <Search className="w-4 h-4" /> {busy ? "Searching…" : "Search"}
        </button>
        <p className="text-[11px] text-[var(--muted)] basis-full">When a customer calls back: search the number to see the surveys made for it, who called, how each ended and what the customer answered.</p>
      </div>

      {error && <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 text-xs">{error}</div>}

      {res && (
        <div className="space-y-3">
          {res.dnc && (
            <div className="p-3 rounded-xl border-2 border-rose-500 bg-rose-600/15 text-rose-300 text-xs flex items-center gap-2">
              <PhoneOff className="w-4 h-4 shrink-0" /> <span><b>This number is on the Do Not Call list.</b> Help them if they called us, but never call them.</span>
            </div>
          )}
          {!res.rows.length ? (
            <div className={box + " p-8 text-center text-xs text-[var(--muted)]"}>No survey was made for this number.</div>
          ) : res.rows.map((r) => {
            const sv = statusView(r.status), open = openId === r.id;
            return (
              <div key={r.id} className={box + " p-4 space-y-3"}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-400">{r.template_name || "Survey"}{typeLabel(r.survey_type) ? ` · ${typeLabel(r.survey_type)}` : ""}</div>
                    <div className="text-sm font-extrabold text-[var(--heading)]">
                      {r.customer_name || "—"} <span className="font-mono text-xs text-[var(--muted)]" dir="ltr">{r.customer_phone}</span>
                    </div>
                    <div className="text-[11px] text-[var(--muted)]">
                      {[r.brand_name, r.order_id ? `Order ${r.order_id}` : "", r.item_name].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <div className="text-right space-y-1">
                    <span className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-bold border ${sv.cls}`}>{sv.label}</span>
                    {r.status === "successful" && r.action_type === "complaint" && <div className="text-[11px] font-bold text-rose-400">Complaint</div>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[var(--muted)]">
                  <span>Agent: <b className="text-[var(--text)]">{r.agent_name || "Unassigned"}</b>{r.mine ? " (you)" : ""}</span>
                  <span>Uploaded: <b className="text-[var(--text)]">{fmt(r.created_at)}</b></span>
                  <span>Finished: <b className="text-[var(--text)]">{fmt(r.completed_at)}</b></span>
                  <span>Call attempts: <b className="text-[var(--text)]">{r.attempt_count || 0}</b></span>
                </div>
                {(r.attempts.length > 0 || r.answers.length > 0) && (
                  <button onClick={() => setOpenId(open ? null : r.id)} className="flex items-center gap-1 text-[11px] font-bold text-blue-400 hover:text-blue-300">
                    <ChevronDown className={`w-3.5 h-3.5 transition ${open ? "rotate-180" : ""}`} /> {open ? "Hide details" : "Calls & answers"}
                  </button>
                )}
                {open && (
                  <div className="grid md:grid-cols-2 gap-4 border-t border-[var(--border)] pt-3">
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Calls</div>
                      {r.attempts.length ? r.attempts.map((a: any, i: number) => (
                        <div key={i} className="text-[11px] text-[var(--text)]">
                          <b>{a.attempt_number ? `#${a.attempt_number} ` : ""}{outcomeLabel(a.outcome)}</b> · {a.agent_name || "—"} · <span className="text-[var(--muted)]">{fmt(a.created_at)}</span>
                          {a.note && <div className="text-[var(--muted)]">{a.note}</div>}
                        </div>
                      )) : <div className="text-[11px] text-[var(--muted)]">No calls logged.</div>}
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Answers</div>
                      {r.answers.length ? r.answers.map((a: any, i: number) => (
                        <div key={i} className="text-[11px]">
                          <div className="text-[var(--muted)]">{a.question}</div>
                          <div className="font-bold text-[var(--heading)]">{a.answer}</div>
                        </div>
                      )) : <div className="text-[11px] text-[var(--muted)]">No answers recorded.</div>}
                    </div>
                  </div>
                )}
                {r.mine && (r.status === "pending" || r.status === "in_progress") && (
                  <div className="text-[11px] text-amber-400">This survey is in your queue — work it from Survey Queue.</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
