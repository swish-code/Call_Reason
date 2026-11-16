import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { ShieldCheck, RefreshCw, CheckCircle2, Timer, PhoneOff, Ban, Hourglass, Users, PhoneMissed } from "lucide-react";

// Call verification for Ratings & Reviews and the Shakir Campaign: for every call an employee logged, is there a call
// from their own XonTel user to that customer's number? Team Leaders, Supervisors and Admins only — the server answers
// 403 to everyone else and this section then shows nothing.

type Sum = { reached: number; confirmed: number; short: number; unanswered: number; noCall: number; pending: number; unlinked: number; notReached: number; notReachedNoCall: number };
interface Flag { id: string; at: string; agent: string; phone: string; ref: string | null; outcome: string; kind: "no_call" | "unanswered" | "short" | "not_dialled"; talk: number; call_time: string | null; by: string | null }
interface Data {
  configured: boolean; minTalkSeconds: number; total: number;
  status: { lastRunAt: string | null; lastError: string | null; lastChecked: number; lastWritten: number; running: boolean; warnings: string[] };
  summary: Sum; agents: (Sum & { agent: string; linked: boolean; suspectPct: number | null })[]; flagged: Flag[];
}

const KW_MS = 3 * 60 * 60 * 1000;
const fmt = (ts?: string | null) => (ts ? new Date(new Date(ts).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16) : "");
const words = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const KIND: Record<Flag["kind"], { label: string; cls: string }> = {
  no_call: { label: "No call found", cls: "text-rose-500 bg-rose-500/10 border-rose-500/40" },
  unanswered: { label: "Dialled, not answered", cls: "text-amber-500 bg-amber-500/10 border-amber-500/40" },
  short: { label: "Short call", cls: "text-amber-500 bg-amber-500/10 border-amber-500/40" },
  not_dialled: { label: "Logged without dialling", cls: "text-rose-500 bg-rose-500/10 border-rose-500/40" },
};

export default function CallVerification({ source, from, to, campaignId, what }: { source: "ratings" | "offers"; from: string; to: string; campaignId?: string; what: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(true);
  // Which entries the list below shows: one kind and / or one employee (set by clicking a number in the table).
  const [pick, setPick] = useState<{ kind: Flag["kind"] | ""; agent: string }>({ kind: "", agent: "" });
  const listRef = useRef<HTMLDivElement>(null);
  const show = (kind: Flag["kind"] | "", agent = "") => { setPick({ kind, agent }); setOpen(true); setTimeout(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ from, to });
    if (campaignId) qs.set("campaign", campaignId);
    try {
      const res = await apiFetch(`/api/call-checks/${source}?${qs}`);
      if (!alive.current) return null;
      if (res.status === 403) { setHidden(true); return null; }
      if (!res.ok) return null;
      const x: Data = await res.json();
      if (alive.current) setD(x);
      return x;
    } catch { return null; }
  }, [source, from, to, campaignId]);
  useEffect(() => { load(); }, [load]);

  const verify = async () => {
    setBusy(true); setMsg("");
    try {
      const res = await apiFetch(`/api/call-checks/${source}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to }) });
      if (!res.ok) { setMsg((await res.json().catch(() => ({})))?.error || "Could not start the check."); return; }
      for (let i = 0; i < 60 && alive.current; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const x = await load();
        if (x && !x.status.running) break;
      }
    } finally { if (alive.current) setBusy(false); }
  };

  if (hidden || !d) return null;
  const s = d.summary;
  const Card = ({ label, value, icon: Icon, tone, hint }: { label: string; value: number; icon: any; tone: string; hint?: string }) => (
    <div className="bg-[var(--surface)] p-4 border border-[var(--border)] shadow-lg rounded-2xl flex items-center gap-3">
      <div className={`p-2.5 rounded-xl bg-current/10 ${tone} shrink-0`}><Icon className={`w-5 h-5 ${tone}`} /></div>
      <div className="min-w-0">
        <p className="text-[10px] text-[var(--muted)] font-bold uppercase leading-tight">{label}</p>
        <h3 className="text-xl font-bold text-[var(--heading)] tracking-tight tabular-nums">{value.toLocaleString()}</h3>
        {hint && <p className="text-[10px] text-[var(--muted)] leading-tight">{hint}</p>}
      </div>
    </div>
  );
  // A number in the table opens the entries behind it.
  const dash = (n: number, cls: string, kind?: Flag["kind"], agent?: string) => (!n ? <span className="text-[var(--muted)]">–</span>
    : kind ? <button onClick={() => show(kind, agent)} title="Show these entries" className={`font-bold underline decoration-dotted underline-offset-2 hover:opacity-70 ${cls}`}>{n}</button>
    : <span className={`font-bold ${cls}`}>{n}</span>);
  const shown = d.flagged.filter((f) => (!pick.kind || f.kind === pick.kind) && (!pick.agent || f.agent === pick.agent));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-extrabold text-[var(--heading)] flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-400" /> Call verification</h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">For every {what} an employee logged, the XonTel call records are searched for a call made by that employee's own XonTel user to the customer's number in the two hours before it was saved. A call by another employee does not count. Visible to Team Leaders, Supervisors and Admins only.</p>
        </div>
        {d.configured && (
          <button onClick={verify} disabled={busy || d.status.running}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"
            title="Look the calls up now for the period above (at most 7 days)">
            <RefreshCw className={`w-3.5 h-3.5 ${busy || d.status.running ? "animate-spin" : ""}`} /> {busy || d.status.running ? "Verifying…" : "Verify now"}
          </button>
        )}
      </div>

      {!d.configured ? (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-500 font-bold">XonTel is not connected to this system yet — no calls are checked and nothing is flagged.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Card label="Reached claims" value={s.reached} icon={Users} tone="text-[var(--heading)]" hint="logged as spoken to" />
            <Card label="Call confirmed" value={s.confirmed} icon={CheckCircle2} tone="text-emerald-400" />
            <Card label="Short call" value={s.short} icon={Timer} tone="text-amber-400" hint={`answered, under ${d.minTalkSeconds}s`} />
            <Card label="Not answered" value={s.unanswered} icon={PhoneOff} tone="text-amber-400" hint="dialled, nobody picked up" />
            <Card label="No call found" value={s.noCall} icon={Ban} tone="text-rose-400" hint="no call to that number" />
            <Card label="Logged, not dialled" value={s.notReachedNoCall} icon={PhoneMissed} tone="text-rose-400" hint={`of ${s.notReached} "no answer" entries`} />
            <Card label="Still checking" value={s.pending + s.unlinked} icon={Hourglass} tone="text-zinc-400" hint={s.unlinked ? `${s.unlinked} by employees with no XonTel link` : "checked every 10 min"} />
          </div>

          {(msg || d.status.lastError) && <div className="p-3 rounded-xl text-xs font-bold border border-rose-500/40 bg-rose-500/10 text-rose-500">{msg || `Last check could not finish: ${d.status.lastError}`}</div>}
          {d.status.warnings.map((w, i) => <div key={i} className="p-3 rounded-xl text-xs border border-amber-500/40 bg-amber-500/10 text-amber-500">⚠ {w}</div>)}

          <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl">
            <h4 className="text-sm font-bold text-[var(--heading)] mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-emerald-400" /> By employee</h4>
            {!d.agents.length ? <div className="text-xs text-[var(--muted)] py-4 text-center">No calls were logged in this period.</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                    <th className="text-left py-2 px-2">Employee</th><th className="text-center py-2 px-2">Reached claims</th><th className="text-center py-2 px-2">Confirmed</th>
                    <th className="text-center py-2 px-2">Short call</th><th className="text-center py-2 px-2">Not answered</th><th className="text-center py-2 px-2">No call found</th>
                    <th className="text-center py-2 px-2" title={'"No answer" entries with no call from their XonTel user'}>Logged, not dialled</th>
                    <th className="text-center py-2 px-2">Checking</th><th className="text-center py-2 px-2" title="Share of judged reached claims that are short, not answered or without a call">Suspect</th>
                  </tr></thead>
                  <tbody>
                    {d.agents.map((a) => (
                      <tr key={a.agent} className="border-b border-[var(--border)]">
                        <td className="py-2 px-2 font-bold text-[var(--heading)]">{a.agent}{!a.linked && <span className="ml-2 text-[10px] font-normal text-[var(--muted)]">no XonTel link</span>}</td>
                        <td className="py-2 px-2 text-center tabular-nums">{a.reached}</td>
                        <td className="py-2 px-2 text-center tabular-nums">{dash(a.confirmed, "text-emerald-500")}</td>
                        <td className="py-2 px-2 text-center tabular-nums">{dash(a.short, "text-amber-500", "short", a.agent)}</td>
                        <td className="py-2 px-2 text-center tabular-nums">{dash(a.unanswered, "text-amber-500", "unanswered", a.agent)}</td>
                        <td className="py-2 px-2 text-center tabular-nums">{dash(a.noCall, "text-rose-500", "no_call", a.agent)}</td>
                        <td className="py-2 px-2 text-center tabular-nums">{dash(a.notReachedNoCall, "text-rose-500", "not_dialled", a.agent)}</td>
                        <td className="py-2 px-2 text-center tabular-nums text-[var(--muted)]">{a.pending + a.unlinked || "–"}</td>
                        <td className={`py-2 px-2 text-center tabular-nums font-bold ${a.suspectPct ? (a.suspectPct >= 30 ? "text-rose-500" : "text-amber-500") : "text-emerald-500"}`}>{a.suspectPct == null ? "–" : `${a.suspectPct}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-[var(--muted)] mt-3">A flag is a reason to look, not a verdict: the call may have been made from another phone, or the record may be late. Employees with no XonTel link are not judged (link them in Surveys → Dashboard → XonTel users).</p>
          </div>

          {d.flagged.length > 0 && (
            <div ref={listRef} className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl scroll-mt-4">
              <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 text-sm font-bold text-[var(--heading)]">
                <Ban className="w-4 h-4 text-rose-400" /> Entries to look at <span className="text-xs font-normal text-[var(--muted)]">{shown.length}{shown.length !== d.flagged.length ? ` of ${d.flagged.length}` : ""}{d.flagged.length >= 300 ? "+" : ""}</span>
                <span className="ml-auto text-xs text-[var(--muted)]">{open ? "Hide" : "Show"}</span>
              </button>
              {open && (
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {([["", "All"], ["not_dialled", "Logged, not dialled"], ["no_call", "No call found"], ["unanswered", "Not answered"], ["short", "Short call"]] as const).map(([k, label]) => {
                    const n = d.flagged.filter((f) => (!k || f.kind === k) && (!pick.agent || f.agent === pick.agent)).length;
                    return (
                      <button key={k} onClick={() => setPick({ ...pick, kind: k })} disabled={!n && pick.kind !== k}
                        className={`px-3 py-1.5 rounded-full border text-[11px] font-bold transition disabled:opacity-40 ${pick.kind === k ? "bg-emerald-600 border-emerald-600 text-white" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--heading)]"}`}>
                        {label} · {n}
                      </button>
                    );
                  })}
                  {pick.agent && (
                    <button onClick={() => setPick({ ...pick, agent: "" })} className="px-3 py-1.5 rounded-full border border-emerald-500/50 bg-emerald-500/10 text-emerald-500 text-[11px] font-bold" title="Show every employee">
                      {pick.agent} ✕
                    </button>
                  )}
                </div>
              )}
              {open && (
                <div className="overflow-x-auto mt-3">
                  <table className="w-full text-xs">
                    <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                      <th className="text-left py-2 px-2">Saved (Kuwait)</th><th className="text-left py-2 px-2">Employee</th><th className="text-left py-2 px-2">Customer</th>
                      <th className="text-left py-2 px-2">Logged as</th><th className="text-left py-2 px-2">What XonTel shows</th>
                    </tr></thead>
                    <tbody>
                      {!shown.length && <tr><td colSpan={5} className="py-4 text-center text-[var(--muted)]">Nothing of this kind in the period.</td></tr>}
                      {shown.map((f) => (
                        <tr key={f.id} className="border-b border-[var(--border)]">
                          <td className="py-2 px-2 tabular-nums whitespace-nowrap">{fmt(f.at)}</td>
                          <td className="py-2 px-2 font-bold text-[var(--heading)]">{f.agent}</td>
                          <td className="py-2 px-2"><span className="font-mono">{f.phone}</span>{f.ref && <span className="ml-2 text-[10px] text-[var(--muted)]" dir="auto">{f.ref}</span>}</td>
                          <td className="py-2 px-2">{words(f.outcome)}</td>
                          <td className="py-2 px-2">
                            <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-extrabold whitespace-nowrap ${KIND[f.kind].cls}`}>{KIND[f.kind].label}{f.kind === "short" ? ` · ${f.talk}s` : ""}</span>
                            {f.by && <span className="ml-2 text-[10px] text-[var(--muted)]">called by {f.by}{f.call_time ? ` at ${fmt(f.call_time).slice(11)}` : ""}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
