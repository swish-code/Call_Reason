import { useEffect, useMemo, useState, Fragment } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import {
  AlertCircle, Filter, X, PhoneCall, Hourglass, CalendarClock, PauseCircle, CheckCircle2, PhoneOff, Ban,
  MessageSquareWarning, Users, Megaphone, ClipboardList, Download, Search, ChevronRight, Upload,
} from "lucide-react";

interface Props { currentUser: User; }

interface Answer { q: string | null; type: string | null; v: string }
interface Result {
  id: string; task_no?: number; customer_phone: string; customer_name?: string | null; order_id?: string | null; branch?: string | null;
  item_name?: string | null; item_kind?: string | null; status: string; reachability?: string | null; action_type?: string | null;
  attempt_count?: number; completed_at: string; segment?: string | null; brand_name?: string | null; agent_name?: string | null;
  template_name?: string | null; answers: Answer[] | null;
}
interface LiveData {
  queue: { due_now: number; later: number; in_progress: number; on_hold: number };
  finished: { total: number; successful: number; not_reached: number; refused: number; complaints: number };
  byAgent: { agent: string; finished: number; successful: number; not_reached: number; refused: number; complaints: number }[];
  byCampaign: { id: string; brand_name: string | null; template_name: string | null; status: string; total: number; open: number; finished: number; successful: number; finished_in_period: number }[];
  results: Result[];
  resultsCap: number;
  uploaded: { record_type: string; rows: number; answered: number }[];
}

const KW_MS = 3 * 60 * 60 * 1000;
const kwToday = () => new Date(Date.now() + KW_MS).toISOString().slice(0, 10);
const kwWeekStart = () => { const k = new Date(Date.now() + KW_MS); k.setUTCDate(k.getUTCDate() - k.getUTCDay()); return k.toISOString().slice(0, 10); };
const kwMonthStart = () => new Date(Date.now() + KW_MS).toISOString().slice(0, 7) + "-01";
const fmtTime = (ts: string) => new Date(new Date(ts).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16);

const outcomeView = (s: string): { label: string; cls: string } =>
  s === "successful" ? { label: "Surveyed", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" }
  : s === "unreachable" ? { label: "Not reached", cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" }
  : s === "declined" ? { label: "Not reached (declined)", cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" }
  : s === "refused" ? { label: "Refused", cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" }
  : s === "not_interested" ? { label: "Not interested", cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" }
  : { label: s, cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" };
const bucketOf = (s: string) => s === "successful" ? "surveyed" : s === "unreachable" || s === "declined" ? "not_reached" : "refused";
const UPLOAD_LABEL: Record<string, string> = { new_items: "New Items Survey", complaints: "Complaints Survey", survey_history: "Survey (History)" };
const campaignLabel = (c: { brand_name: string | null; template_name: string | null }) => [c.brand_name || "General", c.template_name].filter(Boolean).join(" · ");
const isRating = (a: Answer) => !!a.type && a.type.startsWith("rating");

const inputCls = "px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-violet-500 focus:outline-none";
const selCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";

export default function SurveysDashboard({ currentUser: _currentUser }: Props) {
  const [d, setD] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Default to today: "how much did the team finish today" is the question this page answers first.
  const [from, setFrom] = useState(kwToday());
  const [to, setTo] = useState(kwToday());
  const [activePeriod, setActivePeriod] = useState<"today" | "week" | "month" | "">("today");

  // Results-table filters (client-side over the loaded period)
  const [outcome, setOutcome] = useState("");
  const [agent, setAgent] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async (f = from, t = to) => {
    try {
      setLoading(true); setError("");
      const qs = new URLSearchParams();
      if (f) qs.set("from", f);
      if (t) qs.set("to", t);
      const res = await apiFetch(`/api/surveys/live-dashboard${qs.toString() ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load dashboard.");
      setD(await res.json());
      setExpanded(null);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const applyPeriod = (p: "today" | "week" | "month") => {
    const today = kwToday();
    const f = p === "today" ? today : p === "week" ? kwWeekStart() : kwMonthStart();
    setFrom(f); setTo(today); setActivePeriod(p); load(f, today);
  };
  const allTime = () => { setFrom(""); setTo(""); setActivePeriod(""); load("", ""); };
  const periodLabel = activePeriod === "today" ? "today" : activePeriod === "week" ? "this week" : activePeriod === "month" ? "this month"
    : from || to ? `${from || "start"} → ${to || "today"}` : "all time";

  const results = useMemo(() => {
    if (!d) return [];
    const s = search.trim().toLowerCase();
    return d.results.filter((r) => {
      if (outcome === "complaint" ? r.action_type !== "complaint" : outcome && bucketOf(r.status) !== outcome) return false;
      if (agent && (r.agent_name || "(unassigned)") !== agent) return false;
      if (s && ![r.customer_phone, r.customer_name, r.order_id, r.item_name].some((x) => (x || "").toLowerCase().includes(s))) return false;
      return true;
    });
  }, [d, outcome, agent, search]);

  const exportCsv = () => {
    if (!results.length) return;
    const questions = Array.from(new Set(results.flatMap((r) => (r.answers || []).map((a) => a.q || "Answer"))));
    const header = ["Finished at (Kuwait)", "Agent", "Phone", "Customer", "Order ID", "Brand", "Branch", "Item", "Item type", "Outcome", "Complaint", "Attempts", "Campaign", ...questions];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [header.map(esc).join(",")];
    for (const r of results) {
      const byQ = new Map((r.answers || []).map((a) => [a.q || "Answer", a.v]));
      lines.push([fmtTime(r.completed_at), r.agent_name, r.customer_phone, r.customer_name, r.order_id, r.brand_name, r.branch, r.item_name, r.item_kind,
        outcomeView(r.status).label, r.action_type === "complaint" ? "Yes" : "", r.attempt_count, r.template_name, ...questions.map((q) => byQ.get(q) ?? "")].map(esc).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `survey-results-${from || "all"}${to && to !== from ? "_to_" + to : ""}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !d) return <div className="flex flex-col items-center justify-center min-h-[400px]"><div className="w-12 h-12 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" /><p className="mt-4 text-[var(--muted)]">Loading dashboard…</p></div>;
  if (error && !d) return <div className="p-6 bg-rose-950/20 border border-rose-500/30 rounded-2xl text-center text-rose-300"><AlertCircle className="w-10 h-10 mx-auto text-rose-500" /><p className="mt-2 text-sm">{error}</p></div>;
  if (!d) return null;

  const f = d.finished;
  const rate = f.total ? Math.round((f.successful / f.total) * 100) : 0;
  const agents = Array.from(new Set(d.results.map((r) => r.agent_name || "(unassigned)"))).sort();

  const Card = ({ label, value, icon: Icon, tone, hint }: { label: string; value: any; icon: any; tone: string; hint?: string }) => (
    <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl flex items-center gap-4">
      <div className={`p-3 rounded-xl bg-current/10 ${tone} shrink-0`}><Icon className={`w-6 h-6 ${tone}`} /></div>
      <div className="min-w-0">
        <p className="text-[10px] text-[var(--muted)] font-bold uppercase">{label}</p>
        <h3 className="text-2xl font-bold text-[var(--heading)] tracking-tight font-mono">{value}</h3>
        {hint && <p className="text-[10px] text-[var(--muted)] mt-0.5">{hint}</p>}
      </div>
    </div>
  );

  const SectionTitle = ({ icon: Icon, title, sub, tone = "text-violet-400" }: { icon: any; title: string; sub?: string; tone?: string }) => (
    <div>
      <h2 className="text-lg font-extrabold text-[var(--heading)] flex items-center gap-2"><Icon className={`w-5 h-5 ${tone}`} /> {title}</h2>
      {sub && <p className="text-xs text-[var(--muted)] mt-1">{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-8 animate-fade-in text-[var(--text)]">
      {/* Banner */}
      <div className="bg-gradient-to-r from-[var(--surface)] via-[var(--surface-2)] to-[var(--bg)] border border-[var(--border)] p-6 md:p-8 rounded-3xl shadow-xl">
        <span className="bg-violet-950/45 text-violet-400 text-xs font-bold px-3 py-1 rounded-full border border-violet-500/30">Survey Analytics</span>
        <h1 className="text-2xl md:text-3xl font-extrabold text-[var(--heading)] tracking-tight mt-2">Surveys Dashboard</h1>
        <p className="text-[var(--muted)] text-sm mt-1 font-light">The calls agents are working inside the system, how many they finished, and the answers they collected. Uploaded Excel history is counted separately at the bottom.</p>
      </div>

      {/* Period */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-lg flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-[var(--heading)] font-bold text-sm mr-1"><Filter className="w-4 h-4 text-violet-400" /> Period</div>
        {(["today", "week", "month"] as const).map((p) => (
          <button key={p} onClick={() => applyPeriod(p)}
            className={`px-3 py-2 text-xs font-bold rounded-xl border transition active:scale-95 ${activePeriod === p ? "bg-violet-600 text-white border-violet-600" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)] hover:border-violet-500/40"}`}>
            {p === "today" ? "Today" : p === "week" ? "This Week" : "This Month"}
          </button>
        ))}
        <button onClick={allTime}
          className={`px-3 py-2 text-xs font-bold rounded-xl border transition active:scale-95 ${!from && !to ? "bg-violet-600 text-white border-violet-600" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)] hover:border-violet-500/40"}`}>
          All time
        </button>
        <div className="w-px h-6 bg-[var(--border)] mx-1 self-center" />
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">From</label>
          <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setActivePeriod(""); }} className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">To</label>
          <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setActivePeriod(""); }} className={inputCls} />
        </div>
        <button onClick={() => load()} disabled={loading} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" /> Apply</button>
        <span className="text-[11px] text-[var(--muted)] font-medium ml-auto">Finished = calls whose result was saved in the period ({periodLabel})</span>
      </div>

      {error && <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs text-rose-400">{error}</div>}

      {/* ================= LIVE: QUEUE RIGHT NOW ================= */}
      <div className="space-y-4">
        <SectionTitle icon={PhoneCall} title="Waiting to be called — right now" sub="Numbers in the agents' Survey Queue at this moment (not affected by the period)." />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card label="Waiting now" value={d.queue.due_now} icon={Hourglass} tone="text-amber-400" hint="due today or earlier" />
          <Card label="Scheduled later" value={d.queue.later} icon={CalendarClock} tone="text-blue-400" hint="daily limit pushed them ahead" />
          <Card label="In progress" value={d.queue.in_progress} icon={PhoneCall} tone="text-violet-400" hint="an agent has it open" />
          <Card label="On hold" value={d.queue.on_hold} icon={PauseCircle} tone="text-zinc-400" hint="campaign not active" />
        </div>
      </div>

      {/* ================= LIVE: FINISHED IN PERIOD ================= */}
      <div className="space-y-4">
        <SectionTitle icon={CheckCircle2} tone="text-emerald-400" title={`Finished ${periodLabel}`} sub="Every call an agent closed in the period, by result." />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <Card label="Finished" value={f.total} icon={CheckCircle2} tone="text-[var(--heading)]" />
          <Card label="Surveyed" value={f.successful} icon={CheckCircle2} tone="text-emerald-400" hint={f.total ? `${rate}% of finished` : undefined} />
          <Card label="Not reached" value={f.not_reached} icon={PhoneOff} tone="text-rose-400" />
          <Card label="Refused / not interested" value={f.refused} icon={Ban} tone="text-orange-400" />
          <Card label="Complaints" value={f.complaints} icon={MessageSquareWarning} tone="text-amber-400" hint="flagged during the call" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* By agent */}
          <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
            <h3 className="text-sm font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><Users className="w-4 h-4 text-violet-400" /> By agent</h3>
            {d.byAgent.length === 0 ? <div className="text-center py-6 text-[var(--muted)] text-xs">No calls finished {periodLabel}.</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                    <th className="text-left py-2 px-2">Agent</th><th className="text-center py-2 px-2">Finished</th><th className="text-center py-2 px-2">Surveyed</th>
                    <th className="text-center py-2 px-2">Not reached</th><th className="text-center py-2 px-2">Refused</th><th className="text-center py-2 px-2">Complaints</th>
                  </tr></thead>
                  <tbody>
                    {d.byAgent.map((a) => (
                      <tr key={a.agent} onClick={() => setAgent(agent === a.agent ? "" : a.agent)} title="Show this agent's results below"
                        className={`border-b border-[var(--border)]/40 last:border-0 cursor-pointer transition ${agent === a.agent ? "bg-violet-500/10" : "hover:bg-[var(--surface-2)]/30"}`}>
                        <td className="py-2 px-2 font-bold text-[var(--heading)]">{a.agent}</td>
                        <td className="py-2 px-2 text-center font-mono">{a.finished}</td>
                        <td className="py-2 px-2 text-center font-mono text-emerald-400">{a.successful}</td>
                        <td className="py-2 px-2 text-center font-mono text-rose-400">{a.not_reached}</td>
                        <td className="py-2 px-2 text-center font-mono text-orange-400">{a.refused}</td>
                        <td className="py-2 px-2 text-center font-mono text-amber-400">{a.complaints || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* By campaign */}
          <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
            <h3 className="text-sm font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><Megaphone className="w-4 h-4 text-violet-400" /> Campaign progress</h3>
            {d.byCampaign.length === 0 ? <div className="text-center py-6 text-[var(--muted)] text-xs">No campaigns with numbers.</div> : (
              <div className="space-y-4">
                {d.byCampaign.map((c) => {
                  const pct = c.total ? Math.round((c.finished / c.total) * 100) : 0;
                  return (
                    <div key={c.id} className="space-y-1.5">
                      <div className="flex justify-between items-baseline gap-2 text-xs">
                        <span className="font-bold text-[var(--heading)] truncate">{campaignLabel(c)}{c.status !== "active" && <span className="ml-1.5 text-[10px] font-normal text-[var(--muted)]">({c.status})</span>}</span>
                        <span className="font-mono text-[var(--muted)] shrink-0">{c.finished}/{c.total} done · {c.open} left</span>
                      </div>
                      <div className="w-full bg-[var(--surface-2)] h-2 rounded-full overflow-hidden"><div className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-violet-500"}`} style={{ width: `${pct}%` }} /></div>
                      <div className="text-[10px] text-[var(--muted)]">{c.successful} surveyed in total{c.finished_in_period ? ` · ${c.finished_in_period} finished ${periodLabel}` : ""}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ================= LIVE: RESULTS ================= */}
      <div className="space-y-4">
        <SectionTitle icon={ClipboardList} tone="text-sky-400" title="Finished surveys — results" sub="The answers agents saved. Click a row to see every answer." />
        <div className="flex flex-wrap items-center gap-3">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={selCls}>
            <option value="">All results</option>
            <option value="surveyed">Surveyed</option>
            <option value="not_reached">Not reached</option>
            <option value="refused">Refused / not interested</option>
            <option value="complaint">Complaints</option>
          </select>
          <select value={agent} onChange={(e) => setAgent(e.target.value)} className={selCls}>
            <option value="">All agents</option>
            {agents.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Phone, name, order or item…" className={inputCls + " pl-8 w-56"} />
          </div>
          {(outcome || agent || search) && (
            <button onClick={() => { setOutcome(""); setAgent(""); setSearch(""); }} className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:text-rose-400 font-bold rounded-xl text-xs flex items-center gap-1.5 transition"><X className="w-3.5 h-3.5" /> Clear</button>
          )}
          <button onClick={exportCsv} disabled={!results.length} className="ml-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Export CSV</button>
        </div>
        {d.results.length >= d.resultsCap && <p className="text-[11px] text-amber-400">Showing the latest {d.resultsCap} finished calls — pick a shorter period to see everything.</p>}

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg)] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                <tr>
                  <th className="p-4">Finished</th>
                  <th className="p-4">Agent</th>
                  <th className="p-4">Customer</th>
                  <th className="p-4">Brand</th>
                  <th className="p-4">Item</th>
                  <th className="p-4">Result</th>
                  <th className="p-4">Ratings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {results.map((r) => {
                  const open = expanded === r.id;
                  const o = outcomeView(r.status);
                  const ratings = (r.answers || []).filter(isRating);
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => setExpanded(open ? null : r.id)} className={`cursor-pointer transition align-middle ${open ? "bg-[var(--surface-2)]/60" : "hover:bg-[var(--surface-2)]/40"}`}>
                        <td className="p-4 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">
                          <span className="inline-flex items-center gap-1"><ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`} />{fmtTime(r.completed_at)}</span>
                        </td>
                        <td className="p-4 text-[var(--text)]">{r.agent_name || "—"}</td>
                        <td className="p-4">
                          <div className="font-mono font-bold text-[var(--heading)]">{r.customer_phone}</div>
                          {(r.customer_name || r.order_id) && <div className="text-[10px] text-[var(--muted)] mt-0.5">{[r.customer_name, r.order_id].filter(Boolean).join(" · ")}</div>}
                        </td>
                        <td className="p-4 text-[var(--text)]">{r.brand_name || "—"}{r.branch && <div className="text-[10px] text-[var(--muted)] mt-0.5">{r.branch}</div>}</td>
                        <td className="p-4 text-[var(--text)] max-w-[260px]">{r.item_name ? <span className="line-clamp-2" title={r.item_name}>{r.item_name}</span> : "—"}</td>
                        <td className="p-4">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border whitespace-nowrap ${o.cls}`}>{o.label}</span>
                          {r.action_type === "complaint" && <div className="text-[10px] font-bold text-amber-400 mt-1">Complaint</div>}
                        </td>
                        <td className="p-4">
                          {ratings.length ? (
                            <div className="flex flex-wrap gap-1">
                              {ratings.map((a, i) => <span key={i} title={a.q || ""} className="px-1.5 py-0.5 bg-[var(--bg)] border border-[var(--border)] rounded-md font-mono text-[10px] text-[var(--heading)]">{a.v}</span>)}
                            </div>
                          ) : <span className="text-[var(--muted)]">—</span>}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-[var(--surface-2)]/30">
                          <td colSpan={7} className="p-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div className="space-y-2">
                                <p className="text-[10px] font-bold text-[var(--muted)] uppercase">Answers</p>
                                {(r.answers || []).length === 0 ? <p className="text-[11px] text-[var(--muted)]">No answers saved — the call didn't reach a survey.</p> : (
                                  <div className="space-y-1.5">
                                    {(r.answers || []).map((a, i) => (
                                      <div key={i} className="flex justify-between gap-4 text-[11px] border-b border-[var(--border)]/40 pb-1.5">
                                        <span className="text-[var(--text)]">{a.q || "Answer"}</span>
                                        <span className="font-bold text-[var(--heading)] text-right">{isRating(a) ? `${a.v} / ${a.type === "rating_1_10" ? 10 : 5}` : a.v}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] content-start">
                                {([
                                  ["Campaign", r.template_name], ["Order ID", r.order_id], ["Branch", r.branch], ["Item type", r.item_kind],
                                  ["Attempts", r.attempt_count], ["Segment", r.segment], ["Task #", r.task_no],
                                ] as [string, any][]).filter(([, v]) => v !== null && v !== undefined && String(v) !== "").map(([k, v]) => (
                                  <div key={k}><div className="text-[10px] font-bold text-[var(--muted)] uppercase">{k}</div><div className="text-[var(--heading)] break-words">{String(v)}</div></div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {results.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-[var(--muted)]">{d.results.length ? "No results match these filters." : `No calls finished ${periodLabel}.`}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ================= UPLOADED HISTORY (separate) ================= */}
      <div className="space-y-4">
        <SectionTitle icon={Upload} tone="text-zinc-400" title={`Uploaded survey files — ${periodLabel}`}
          sub="Surveys done outside the system and uploaded from Excel (Survey Data). Not part of the agents' live work above." />
        <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
          {d.uploaded.length === 0 ? <div className="text-center py-4 text-[var(--muted)] text-xs">No survey files uploaded {periodLabel}.</div> : (
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                <th className="text-left py-2 px-2">File type</th><th className="text-center py-2 px-2">Rows</th><th className="text-center py-2 px-2">Answered</th>
              </tr></thead>
              <tbody>
                {d.uploaded.map((u) => (
                  <tr key={u.record_type} className="border-b border-[var(--border)]/40 last:border-0">
                    <td className="py-2 px-2 font-bold text-[var(--heading)]">{UPLOAD_LABEL[u.record_type] || u.record_type}</td>
                    <td className="py-2 px-2 text-center font-mono">{u.rows}</td>
                    <td className="py-2 px-2 text-center font-mono text-emerald-400">{u.answered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[10px] text-[var(--muted)] mt-3">To see these rows, open Survey Data and pick the file type.</p>
        </div>
      </div>
    </div>
  );
}
