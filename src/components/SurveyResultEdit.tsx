import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { X, Pencil, AlertCircle, Loader2 } from "lucide-react";

// A leader corrects the result of a FINISHED survey: the customer called back, an answer was wrong. The surveyor, the
// completion time and the call attempts stay; the answers and the outcome are replaced. Leaders only (the server checks).

interface Question { id: string; text: string; answer_type: string; options?: string[] | null }
type Outcome = "completed" | "refused" | "not_interested" | "not_reached";

const inputCls = "w-full px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-violet-500 focus:outline-none";

export default function SurveyResultEdit({ assignmentId, onClose, onSaved }: { assignmentId: string; onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<Outcome>("completed");
  const [action, setAction] = useState<"no_action" | "complaint">("no_action");

  useEffect(() => {
    let alive = true;
    apiFetch(`/api/surveys/assignments/${assignmentId}/result`)
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Could not open this survey."); return r.json(); })
      .then((d) => {
        if (!alive) return;
        const a = d.assignment;
        setInfo(a); setQuestions(d.questions || []); setAnswers(d.answers || {});
        setOutcome(a.status === "successful" ? "completed" : a.status === "refused" ? "refused" : a.status === "not_interested" ? "not_interested" : "not_reached");
        setAction(a.action_type === "complaint" ? "complaint" : "no_action");
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [assignmentId]);

  const save = async () => {
    setError(""); setBusy(true);
    try {
      const body = {
        outcome: outcome === "refused" || outcome === "not_interested" ? outcome : "completed",
        reachability: outcome === "not_reached" ? "not_reached" : "reached",
        action_type: outcome === "not_reached" ? "no_action" : action,
        answers: outcome === "completed" ? questions.map((q) => ({ question_id: q.id, answer_value: answers[q.id] ?? "", answered: String(answers[q.id] ?? "").trim() !== "" })) : [],
      };
      const res = await apiFetch(`/api/surveys/assignments/${assignmentId}/edit-result`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Could not save."); return; }
      onSaved(); onClose();
    } finally { setBusy(false); }
  };

  const set = (id: string, v: string) => setAnswers((p) => ({ ...p, [id]: v }));
  const chip = (on: boolean) => `px-3 py-2 rounded-xl text-xs font-extrabold border transition ${on ? "bg-violet-600 text-white border-violet-600" : "bg-[var(--surface)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--surface-2)]"}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 overflow-y-auto" onClick={onClose}>
      <div className="min-h-full flex items-start justify-center p-4">
        <div className="w-full max-w-2xl my-6 bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg)]">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-violet-500/10 text-violet-400 rounded-xl"><Pencil className="w-5 h-5" /></div>
              <div>
                <h3 className="text-sm font-extrabold text-[var(--heading)]">Edit survey result</h3>
                <p className="text-[11px] text-[var(--muted)]">{info ? [info.customer_phone, info.customer_name, info.template_name].filter(Boolean).join(" · ") : "…"}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--heading)] rounded-xl"><X className="w-5 h-5" /></button>
          </div>

          {loading ? <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div> : (
            <div className="p-6 space-y-5">
              <div className="space-y-2">
                <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wide">Result</p>
                <div className="flex flex-wrap gap-2">
                  {([["completed", "Completed — reached"], ["not_reached", "Not reached"], ["refused", "Refused to complete"], ["not_interested", "Not interested"]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setOutcome(k)} className={chip(outcome === k)}>{l}</button>
                  ))}
                </div>
              </div>

              {outcome !== "not_reached" && (
                <div className="space-y-2">
                  <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wide">Action</p>
                  <div className="flex gap-2">
                    {([["no_action", "No action"], ["complaint", "Complaint"]] as const).map(([k, l]) => (
                      <button key={k} onClick={() => setAction(k)} className={chip(action === k)}>{l}</button>
                    ))}
                  </div>
                </div>
              )}

              {outcome === "completed" && (
                <div className="space-y-4">
                  <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wide">Answers</p>
                  {questions.length === 0 && <p className="text-xs text-[var(--muted)]">This survey has no questions.</p>}
                  {questions.map((q, i) => {
                    const val = answers[q.id] ?? "";
                    return (
                      <div key={q.id} className="space-y-1.5">
                        <p className="text-xs font-bold text-[var(--heading)]"><span className="text-[var(--muted)]">Q{i + 1}.</span> {q.text}</p>
                        {(q.answer_type === "rating_1_5" || q.answer_type === "rating_1_10") && (
                          <div className="flex flex-wrap gap-1.5">
                            {Array.from({ length: q.answer_type === "rating_1_10" ? 10 : 5 }, (_, n) => String(n + 1)).map((n) => (
                              <button key={n} onClick={() => set(q.id, val === n ? "" : n)} className={chip(val === n) + " w-9 !px-0"}>{n}</button>
                            ))}
                          </div>
                        )}
                        {q.answer_type === "yes_no" && (
                          <div className="flex gap-2">{["Yes", "No"].map((o) => <button key={o} onClick={() => set(q.id, val === o ? "" : o)} className={chip(val === o)}>{o}</button>)}</div>
                        )}
                        {q.answer_type === "multiple_choice" && (
                          <select value={val} onChange={(e) => set(q.id, e.target.value)} className={inputCls}>
                            <option value="">— Select —</option>
                            {[...new Set([...(q.options || []), ...(val && !(q.options || []).includes(val) ? [val] : [])])].map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        )}
                        {!["rating_1_5", "rating_1_10", "yes_no", "multiple_choice"].includes(q.answer_type) && (
                          <textarea value={val} onChange={(e) => set(q.id, e.target.value)} rows={2} placeholder="Answer…" className={inputCls + " resize-none"} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {error && <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}
              <p className="text-[11px] text-[var(--muted)]">The surveyor, the completion time and the call attempts stay as they are. The change is kept in the audit log and replaces this survey's line in Survey Data.</p>
              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2 bg-[var(--surface-2)] text-[var(--text)] rounded-xl text-xs font-bold">Cancel</button>
                <button onClick={save} disabled={busy} className="px-5 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold">{busy ? "Saving…" : "Save result"}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
