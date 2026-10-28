import { useCallback, useEffect, useState } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { Card as ChartCard, GroupedColumns, STYLE as CHART_STYLE, C as CC, type Series } from "./SurveyCharts.tsx";
import {
  Star, RefreshCw, AlertCircle, Inbox, Hourglass, PhoneCall, PhoneOff, CheckCircle2, Users, MessageSquare, Flag, Clock, Building2, Store, X,
} from "lucide-react";

// Ratings & Reviews dashboard — the Reviews page's Dashboard tab, laid out like the Surveys dashboard:
// what is waiting right now, what the period brought in and what agents closed, per day / agent / platform / brand,
// and the commented reviews themselves. Days are Kuwait days.

interface Props { currentUser: User; }
interface Data {
  range: { from: string; to: string };
  live: { unassigned: number; pending: number; in_progress: number; no_phone: number; older_3d: number };
  liveAgents: { agent: string; agent_id: string; pending: number; in_progress: number; older_3d: number }[];
  period: { uploaded: number; tasks: number; auto_closed: number; with_comment: number; avg_rating: number; s1: number; s2: number; s3: number; s4: number; s5: number;
    closed: number; resolved: number; no_action: number; unreachable: number; avg_hours: number; attempts: number; answered: number };
  days: { day: string; uploaded: number; tasks: number; closed: number }[];
  agents: { agent_id: string; agent: string; closed: number; resolved: number; no_action: number; unreachable: number; avg_hours: number; attempts: number; answered: number; open: number }[];
  platforms: { name: string; reviews: number; tasks: number; avg: number; low: number }[];
  brands: { name: string; reviews: number; tasks: number; avg: number; low: number }[];
  branches: { brand: string; name: string; reviews: number; avg: number; low: number }[];
  results: any[]; resultsCap: number;
}

const KW_MS = 3 * 60 * 60 * 1000;
const kwToday = () => new Date(Date.now() + KW_MS).toISOString().slice(0, 10);
const back = (n: number) => new Date(Date.now() + KW_MS - n * 86400_000).toISOString().slice(0, 10);
const fmtDT = (ts?: string | null) => (ts ? new Date(new Date(ts).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16) : "—");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const hours = (h: number) => (!h ? "—" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`);
const starColor = (a: number) => (a >= 4 ? "text-emerald-500" : a >= 3 ? "text-amber-500" : "text-rose-500");
const statusView = (s: string) =>
  s === "resolved" ? { label: "Complaint recorded", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" }
  : s === "no_action_needed" ? { label: "No action required", cls: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20" }
  : s === "unreachable" ? { label: "Unreachable", cls: "bg-rose-500/10 text-rose-500 border-rose-500/20" }
  : s === "in_progress" ? { label: "In progress", cls: "bg-violet-500/10 text-violet-500 border-violet-500/20" }
  : { label: "Pending", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" };

const inputCls = "px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-violet-500 focus:outline-none";
const PRESETS: [string, string][] = [["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["month", "This month"]];

export default function RatingsDashboard({ currentUser: _u }: Props) {
  const today = kwToday();
  const [range, setRange] = useState({ from: today, to: today, preset: "today" });
  const [agent, setAgent] = useState("");
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusF, setStatusF] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError("");
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (agent) qs.set("agent_id", agent);
      const res = await apiFetch(`/api/ratings/dashboard?${qs}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load the dashboard.");
      setD(await res.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [range.from, range.to, agent]);
  useEffect(() => { load(); }, [load]);

  const preset = (p: string) => {
    const t = kwToday(), dt = new Date(t + "T00:00:00Z");
    if (p === "today") setRange({ from: t, to: t, preset: p });
    if (p === "yesterday") setRange({ from: back(1), to: back(1), preset: p });
    if (p === "week") setRange({ from: back((dt.getUTCDay() + 1) % 7), to: t, preset: p });   // Kuwait week starts Saturday
    if (p === "month") setRange({ from: t.slice(0, 8) + "01", to: t, preset: p });
  };
  const periodText = PRESETS.find(([k]) => k === range.preset)?.[1] || (range.from === range.to ? dayText(range.from) : `${dayText(range.from)} – ${dayText(range.to)}`);
  const p = d?.period;
  const S_DAYS: Series[] = [{ key: "uploaded", label: "Uploaded", color: CC.blue }, { key: "tasks", label: "Tasks (need a call)", color: CC.orange }, { key: "closed", label: "Closed by agents", color: CC.aqua }];
  const cats = (d?.days || []).map((x) => ({ key: x.day, label: String(Number(x.day.slice(8, 10))) }));
  const dayMap = new Map((d?.days || []).map((x) => [x.day, x]));
  const results = (d?.results || []).filter((r) => !statusF || (statusF === "open" ? ["pending", "in_progress"].includes(r.action_status) : r.action_status === statusF));
  const agentName = d?.agents.find((a) => a.agent_id === agent)?.agent || d?.liveAgents.find((a) => a.agent_id === agent)?.agent;

  return (
    <div className="space-y-6 svc">
      <style>{CHART_STYLE}</style>
      {/* period */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex max-w-full overflow-x-auto p-1 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-sm">
          {PRESETS.map(([k, l]) => (
            <button key={k} onClick={() => preset(k)} className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${range.preset === k ? "bg-amber-500 text-white shadow-md shadow-amber-500/30" : "text-[var(--muted)] hover:text-[var(--heading)]"}`}>{l}</button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">From<input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value, preset: "" })} className={inputCls} /></label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">To<input type="date" value={range.to} min={range.from} max={today} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value, preset: "" })} className={inputCls} /></label>
        {agent && <button onClick={() => setAgent("")} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-violet-500/10 border border-violet-500/30 text-violet-500"><X className="w-3.5 h-3.5" /> {agentName || "Agent"} only</button>}
        <button onClick={load} title="Refresh" className="ml-auto p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--heading)]"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
      </div>
      {error && <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}

      {!d || !p ? <div className="h-64 rounded-3xl bg-[var(--surface-2)] animate-pulse" /> : (
        <>
          {/* right now */}
          <Section icon={Inbox} tone="text-amber-500" title="Waiting to be handled — right now" sub="Open reviews in the agents' lists at this moment (not affected by the period)." />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Tile label="No agent yet" value={d.live.unassigned} icon={Inbox} tone="text-amber-500" hint="use Assign by count" />
            <Tile label="Pending" value={d.live.pending} icon={Hourglass} tone="text-blue-500" hint="assigned, not started" />
            <Tile label="In progress" value={d.live.in_progress} icon={PhoneCall} tone="text-violet-500" hint="a call was logged" />
            <Tile label="No phone" value={d.live.no_phone} icon={PhoneOff} tone="text-zinc-500" hint="agent asks the aggregator" />
            <Tile label="Older than 3 days" value={d.live.older_3d} icon={Clock} tone="text-rose-500" hint="still open" />
          </div>
          {d.liveAgents.length > 0 && (
            <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl">
              <h3 className="text-sm font-bold text-[var(--heading)] mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-violet-400" /> Open reviews per agent — right now</h3>
              <div className="flex flex-wrap gap-2">
                {d.liveAgents.map((a) => (
                  <button key={a.agent_id} onClick={() => setAgent(agent === a.agent_id ? "" : a.agent_id)} title="Show this agent's period numbers below"
                    className={`px-3 py-1.5 rounded-xl border text-xs flex items-center gap-2 transition ${agent === a.agent_id ? "bg-violet-600 text-white border-violet-600" : "bg-[var(--bg)] border-[var(--border)] text-[var(--text)] hover:border-violet-400"}`}>
                    <span className="font-bold">{a.agent}</span>
                    <span className="tabular-nums">{a.pending + a.in_progress}</span>
                    {a.in_progress > 0 && <span className="text-[10px] opacity-80">({a.in_progress} in progress)</span>}
                    {a.older_3d > 0 && <span className={`text-[10px] font-bold ${agent === a.agent_id ? "text-rose-200" : "text-rose-500"}`}>{a.older_3d} old</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* the period */}
          <Section icon={Star} tone="text-amber-500" title={`Reviews — ${periodText}`} sub={`Uploaded in the period (by upload day)${agentName ? `, assigned to ${agentName}` : ""}. Closed = finished by a person in the period (by closing day).`} />
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Tile label="Uploaded" value={p.uploaded} icon={Star} tone="text-[var(--heading)]" hint={`avg ${p.avg_rating.toFixed(2)} ★`} />
            <Tile label="Tasks" value={p.tasks} icon={Flag} tone="text-orange-500" hint={p.uploaded ? `${pct(p.tasks, p.uploaded)}% needed a call` : undefined} />
            <Tile label="Closed by the upload" value={p.auto_closed} icon={CheckCircle2} tone="text-zinc-500" hint="4–5 ★, no comment" />
            <Tile label="Closed by agents" value={p.closed} icon={CheckCircle2} tone="text-emerald-500" hint={`avg ${hours(p.avg_hours)} after upload`} />
            <Tile label="Complaints recorded" value={p.resolved} icon={MessageSquare} tone="text-emerald-500" hint={`${p.no_action} no action · ${p.unreachable} unreachable`} />
            <Tile label="Call attempts" value={p.attempts} icon={PhoneCall} tone="text-sky-500" hint={p.attempts ? `${pct(p.answered, p.attempts)}% answered` : undefined} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <div className="xl:col-span-2">
              <ChartCard reset={d} title="Per day" sub={`${dayText(d.range.from)} – ${dayText(d.range.to)}`} legend={S_DAYS}
                table={{ head: ["Day", ...S_DAYS.map((s) => s.label)], rows: d.days.map((x: any) => [x.day, ...S_DAYS.map((s) => String(x[s.key]))]) }}>
                {(setTip) => <GroupedColumns cats={cats} series={S_DAYS} value={(c, s) => (dayMap.get(c) as any)?.[s] || 0} setTip={setTip} />}
              </ChartCard>
            </div>
            <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl">
              <h3 className="text-sm font-bold text-[var(--heading)] mb-1 flex items-center gap-2"><Star className="w-4 h-4 text-amber-500" /> Stars</h3>
              <p className="text-[11px] text-[var(--muted)] mb-4">{p.with_comment} review(s) came with a comment.</p>
              <div className="space-y-2.5">
                {[5, 4, 3, 2, 1].map((s) => {
                  const n = (p as any)[`s${s}`] as number;
                  return (
                    <div key={s} className="flex items-center gap-2 text-xs">
                      <span className="w-8 font-bold tabular-nums text-[var(--heading)]">{s} ★</span>
                      <div className="flex-1 h-2.5 bg-[var(--surface-2)] rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct(n, p.uploaded)}%`, background: s >= 4 ? "#10b981" : s === 3 ? "#f59e0b" : "#f43f5e" }} /></div>
                      <span className="w-16 text-right tabular-nums text-[var(--muted)]"><b className="text-[var(--heading)]">{n}</b> <span className="text-[10px]">{pct(n, p.uploaded)}%</span></span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* agents */}
          <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl">
            <h3 className="text-sm font-bold text-[var(--heading)] mb-1 flex items-center gap-2"><Users className="w-4 h-4 text-violet-400" /> By agent</h3>
            <p className="text-[11px] text-[var(--muted)] mb-4">{periodText}. Closed = reviews the agent finished in the period. Click a row to filter the page to that agent.</p>
            {!d.agents.length ? <div className="text-xs text-[var(--muted)] py-6 text-center">Nothing closed or logged in this period.</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[720px]">
                  <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                    <th className="text-left py-2 px-2">Agent</th><th className="text-center py-2 px-2">Closed</th><th className="text-center py-2 px-2">Complaint recorded</th>
                    <th className="text-center py-2 px-2">No action</th><th className="text-center py-2 px-2">Unreachable</th>
                    <th className="text-center py-2 px-2" title="Average time from upload to closing">Avg to close</th>
                    <th className="text-center py-2 px-2">Call attempts</th><th className="text-center py-2 px-2" title="Open reviews on their list right now">Open now</th>
                  </tr></thead>
                  <tbody>
                    {d.agents.map((a) => (
                      <tr key={a.agent_id} onClick={() => setAgent(agent === a.agent_id ? "" : a.agent_id)} className={`border-b border-[var(--border)]/40 cursor-pointer hover:bg-[var(--surface-2)]/50 ${agent === a.agent_id ? "bg-violet-500/10" : ""}`}>
                        <td className="py-2 px-2 font-bold text-[var(--heading)]">{a.agent || "—"}</td>
                        <td className="py-2 px-2 text-center tabular-nums font-bold">{a.closed}</td>
                        <td className="py-2 px-2 text-center tabular-nums text-emerald-500">{a.resolved}</td>
                        <td className="py-2 px-2 text-center tabular-nums text-[var(--muted)]">{a.no_action}</td>
                        <td className="py-2 px-2 text-center tabular-nums text-rose-500">{a.unreachable}</td>
                        <td className="py-2 px-2 text-center tabular-nums">{hours(a.avg_hours)}</td>
                        <td className="py-2 px-2 text-center tabular-nums">{a.attempts}{a.attempts ? <span className="text-[10px] text-[var(--muted)]"> ({pct(a.answered, a.attempts)}% answered)</span> : ""}</td>
                        <td className="py-2 px-2 text-center tabular-nums text-amber-500 font-bold">{a.open || <span className="text-[var(--muted)] font-normal">0</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* platforms and brands */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <PerfTable icon={Store} title="By platform" rows={d.platforms} />
            <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl">
              <h3 className="text-sm font-bold text-[var(--heading)] mb-3 flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-400" /> By brand <span className="font-normal text-[var(--muted)] text-[11px]">— click a brand for its branches</span></h3>
              {!d.brands.length ? <div className="text-xs text-[var(--muted)] py-6 text-center">No reviews in this period.</div> : (
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]"><th className="text-left py-2">Brand</th><th className="text-center py-2">Reviews</th><th className="text-center py-2">Tasks</th><th className="text-center py-2" title="1–2 star reviews">Low</th><th className="text-center py-2">Avg ★</th></tr></thead>
                  <tbody>
                    {d.brands.map((b) => {
                      const kids = d.branches.filter((x) => x.brand === b.name);
                      const isOpen = expandedBrand === b.name;
                      return [
                        <tr key={b.name} onClick={() => setExpandedBrand(isOpen ? null : b.name)} className="border-b border-[var(--border)]/40 cursor-pointer hover:bg-[var(--surface-2)]/50">
                          <td className="py-2 font-bold text-[var(--heading)]">{isOpen ? "▾" : "▸"} {b.name}</td>
                          <td className="py-2 text-center tabular-nums">{b.reviews}</td><td className="py-2 text-center tabular-nums text-orange-500">{b.tasks}</td>
                          <td className="py-2 text-center tabular-nums text-rose-500">{b.low}</td><td className={`py-2 text-center tabular-nums font-bold ${starColor(b.avg)}`}>{b.avg.toFixed(2)}</td>
                        </tr>,
                        ...(isOpen ? kids.map((k) => (
                          <tr key={b.name + "/" + k.name} className="border-b border-[var(--border)]/20 bg-[var(--surface-2)]/30">
                            <td className="py-1.5 pl-6 text-[var(--text)]">{k.name}</td>
                            <td className="py-1.5 text-center tabular-nums">{k.reviews}</td><td />
                            <td className="py-1.5 text-center tabular-nums text-rose-500">{k.low}</td><td className={`py-1.5 text-center tabular-nums ${starColor(k.avg)}`}>{k.avg.toFixed(2)}</td>
                          </tr>
                        )) : []),
                      ];
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* the reviews */}
          <div className="bg-[var(--surface)] border border-[var(--border)] shadow-lg rounded-2xl overflow-hidden">
            <div className="p-5 flex flex-wrap items-center gap-3 border-b border-[var(--border)]">
              <div>
                <h3 className="text-sm font-bold text-[var(--heading)] flex items-center gap-2"><MessageSquare className="w-4 h-4 text-sky-400" /> Reviews that needed a call — {periodText}</h3>
                <p className="text-[11px] text-[var(--muted)]">{results.length}{d.results.length >= d.resultsCap ? ` of the newest ${d.resultsCap}` : ""} review(s). Click a row to read the full comment and the agent's note.</p>
              </div>
              <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={inputCls + " ml-auto font-bold"}>
                <option value="">All</option><option value="open">Still open</option><option value="resolved">Complaint recorded</option><option value="no_action_needed">No action required</option><option value="unreachable">Unreachable</option>
              </select>
            </div>
            {!results.length ? <div className="p-8 text-center text-xs text-[var(--muted)]">Nothing here for this period.</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] text-[var(--muted)] font-bold bg-[var(--bg)]">
                    <th className="text-left p-3">Uploaded</th><th className="text-left p-3">Brand · branch</th><th className="text-left p-3">Source</th><th className="text-left p-3">★</th><th className="text-left p-3">Comment</th><th className="text-left p-3">Agent</th><th className="text-left p-3">Status</th><th className="text-left p-3">Closed</th>
                  </tr></thead>
                  <tbody>
                    {results.map((r) => {
                      const sv = statusView(r.action_status), isOpen = open === r.id;
                      return [
                        <tr key={r.id} onClick={() => setOpen(isOpen ? null : r.id)} className="border-t border-[var(--border)]/40 cursor-pointer hover:bg-[var(--surface-2)]/40 align-top">
                          <td className="p-3 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">{fmtDT(r.uploaded_at)}</td>
                          <td className="p-3"><div className="font-bold text-[var(--heading)]">{r.brand_name || "—"}</div><div className="text-[10px] text-[var(--muted)]">{r.branch || ""}</div></td>
                          <td className="p-3 text-[var(--muted)]">{r.platform_name || "—"}<div className="text-[10px] font-mono">{r.order_id}</div></td>
                          <td className={`p-3 font-bold tabular-nums ${starColor(r.rating)}`}>{r.rating}</td>
                          <td className="p-3 max-w-[280px]">{r.review_text ? <span className={isOpen ? "" : "line-clamp-2"}>{r.review_text}</span> : <span className="text-[var(--muted)]">— (low rating, no comment)</span>}</td>
                          <td className="p-3 text-[var(--text)]">{r.agent_name || <span className="text-amber-500">unassigned</span>}{r.attempts ? <div className="text-[10px] text-[var(--muted)]">{r.attempts} attempt(s)</div> : null}</td>
                          <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${sv.cls}`}>{sv.label}</span></td>
                          <td className="p-3 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">{r.resolved_at ? fmtDT(r.resolved_at) : "—"}{r.closed_by ? <div className="text-[10px] font-sans">{r.closed_by}</div> : null}</td>
                        </tr>,
                        ...(isOpen ? [
                          <tr key={r.id + ":d"} className="bg-[var(--surface-2)]/30"><td colSpan={8} className="px-5 py-3 text-xs space-y-1">
                            <div><b>Customer:</b> {r.customer_name || "—"} · <span className="font-mono">{r.customer_phone || "no phone"}</span></div>
                            {r.review_text && <div><b>Comment:</b> <span className="whitespace-pre-wrap">{r.review_text}</span></div>}
                            <div><b>Agent's note:</b> {r.action_note || <span className="text-[var(--muted)]">none</span>}</div>
                          </td></tr>,
                        ] : []),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const Section = ({ icon: Icon, tone, title, sub }: { icon: any; tone: string; title: string; sub: string }) => (
  <div>
    <h2 className="text-lg font-extrabold text-[var(--heading)] flex items-center gap-2"><Icon className={`w-5 h-5 ${tone}`} /> {title}</h2>
    <p className="text-[11px] text-[var(--muted)]">{sub}</p>
  </div>
);
const Tile = ({ label, value, icon: Icon, tone, hint }: { label: string; value: number; icon: any; tone: string; hint?: string }) => (
  <div className="bg-[var(--surface)] p-4 border border-[var(--border)] shadow-lg rounded-2xl flex items-center gap-3">
    <div className={`p-2.5 rounded-xl bg-current/10 ${tone} shrink-0`}><Icon className={`w-5 h-5 ${tone}`} /></div>
    <div className="min-w-0">
      <p className="text-[10px] text-[var(--muted)] font-bold uppercase leading-tight">{label}</p>
      <h3 className="text-xl font-bold text-[var(--heading)] tracking-tight tabular-nums">{value.toLocaleString()}</h3>
      {hint && <p className="text-[10px] text-[var(--muted)] leading-tight">{hint}</p>}
    </div>
  </div>
);
const PerfTable = ({ icon: Icon, title, rows }: { icon: any; title: string; rows: { name: string; reviews: number; tasks: number; avg: number; low: number }[] }) => (
  <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl">
    <h3 className="text-sm font-bold text-[var(--heading)] mb-3 flex items-center gap-2"><Icon className="w-4 h-4 text-blue-400" /> {title}</h3>
    {!rows.length ? <div className="text-xs text-[var(--muted)] py-6 text-center">No reviews in this period.</div> : (
      <table className="w-full text-xs">
        <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]"><th className="text-left py-2">Name</th><th className="text-center py-2">Reviews</th><th className="text-center py-2">Tasks</th><th className="text-center py-2" title="1–2 star reviews">Low</th><th className="text-center py-2">Avg ★</th></tr></thead>
        <tbody>{rows.map((b) => (
          <tr key={b.name} className="border-b border-[var(--border)]/40">
            <td className="py-2 font-bold text-[var(--heading)]">{b.name}</td><td className="py-2 text-center tabular-nums">{b.reviews}</td>
            <td className="py-2 text-center tabular-nums text-orange-500">{b.tasks}</td><td className="py-2 text-center tabular-nums text-rose-500">{b.low}</td>
            <td className={`py-2 text-center tabular-nums font-bold ${starColor(b.avg)}`}>{b.avg.toFixed(2)}</td>
          </tr>
        ))}</tbody>
      </table>
    )}
  </div>
);
