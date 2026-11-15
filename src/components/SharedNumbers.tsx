import { useCallback, useEffect, useMemo, useState } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { downloadXlsx } from "../lib/xlsx.ts";
import { SOURCE_LABEL, resultText } from "./OtherContacts.tsx";
import { phoneOnCopy } from "./phoneCopy.ts";
import { Users, RefreshCw, AlertCircle, Download, PhoneCall, Layers, AlertTriangle, ListChecks } from "lucide-react";

// Shared Numbers: every customer number that sits in two or three of the call lists (Ratings & Reviews, Surveys,
// Shakir Campaign), and where it stands in each. Read-only — it changes nothing; it shows how often one customer can
// be called by different teams.

interface Entry { source: string; id: string; label: string | null; status: string | null; open: boolean; agent: string | null; created_at: string; contacted_at: string | null; result: string | null; contacted_by: string | null }
interface Num { key: string; phone: string; name: string | null; entries: Entry[]; sources: string[]; open_sources: string[]; calls: number; last_contacted_at: string | null }

const SOURCES = ["reviews", "surveys", "shakir"] as const;
const KW_MS = 3 * 60 * 60 * 1000;
const fmtDT = (ts?: string | null) => (ts ? new Date(new Date(ts).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16) : "");
const box = "bg-[var(--surface)] border border-[var(--border)] shadow-lg rounded-3xl";
const inputCls = "px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-violet-500 focus:outline-none";
const selCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";
const PAGE_SIZE = 50;
const stateOf = (es: Entry[]) => (es.some((e) => e.open) ? (es.some((e) => e.open && !e.contacted_at) ? "Waiting" : "Open, called") : es.some((e) => e.contacted_at) ? "Called, closed" : "Closed");

export default function SharedNumbers({ currentUser: _u }: { currentUser: User }) {
  const [days, setDays] = useState("30");
  const [d, setD] = useState<{ numbers: Num[]; capped: boolean } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState("");       // "", three, two, open2, open1
  const [pair, setPair] = useState("");         // a source that must be among them
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError("");
      const res = await apiFetch(`/api/shared-numbers?days=${days}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load the report.");
      setD(await res.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [scope, pair, search, days]);

  const all = d?.numbers || [];
  const rows = useMemo(() => {
    const q = search.replace(/\D/g, "");
    const text = search.trim().toLowerCase();
    return all.filter((n) =>
      (!scope || (scope === "three" ? n.sources.length === 3 : scope === "two" ? n.sources.length === 2 : scope === "open2" ? n.open_sources.length >= 2 : n.open_sources.length >= 1)) &&
      (!pair || n.sources.includes(pair)) &&
      (!text || (q.length >= 3 && n.phone.replace(/\D/g, "").includes(q)) || (n.name || "").toLowerCase().includes(text)));
  }, [all, scope, pair, search]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);

  const tiles = [
    { label: "Numbers in 2 or 3 lists", n: all.length, Icon: Users, cls: "bg-indigo-500/10 text-indigo-500", scope: "" },
    { label: "In all three lists", n: all.filter((n) => n.sources.length === 3).length, Icon: Layers, cls: "bg-violet-500/10 text-violet-500", scope: "three" },
    { label: "Still open in 2+ lists", n: all.filter((n) => n.open_sources.length >= 2).length, Icon: AlertTriangle, cls: "bg-rose-500/10 text-rose-500", scope: "open2" },
    { label: "Called from 2+ lists", n: all.filter((n) => new Set(n.entries.filter((e) => e.contacted_at).map((e) => e.source)).size >= 2).length, Icon: PhoneCall, cls: "bg-amber-500/10 text-amber-500", scope: "" },
  ];

  const exportXlsx = () => downloadXlsx(
    ["Phone", "Customer", "In how many lists", "Open in how many", "Last call (Kuwait)", ...SOURCES.flatMap((s) => [`${SOURCE_LABEL[s]} — records`, `${SOURCE_LABEL[s]} — state`, `${SOURCE_LABEL[s]} — agent`, `${SOURCE_LABEL[s]} — last call`, `${SOURCE_LABEL[s]} — result`])],
    rows.map((n) => [n.phone, n.name || "", n.sources.length, n.open_sources.length, fmtDT(n.last_contacted_at),
      ...SOURCES.flatMap((s) => {
        const es = n.entries.filter((e) => e.source === s);
        if (!es.length) return ["", "", "", "", ""];
        const last = es.filter((e) => e.contacted_at).sort((a, b) => String(b.contacted_at).localeCompare(String(a.contacted_at)))[0];
        return [es.length, stateOf(es), [...new Set(es.map((e) => e.agent).filter(Boolean))].join(", "), fmtDT(last?.contacted_at), resultText(last?.result)];
      })]),
    `shared_numbers_last_${days}_days`, "Shared numbers");

  return (
    <div className="space-y-5 animate-fade-in text-[var(--text)]">
      <div className={box + " p-5 flex flex-wrap items-center justify-between gap-4"}>
        <div className="flex items-center gap-3">
          <div className="p-3 bg-violet-500/10 text-violet-500 rounded-2xl"><Users className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">Shared Numbers</h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">Customers who are in more than one call list — Ratings &amp; Reviews, Surveys and Shakir Campaign. Nothing is changed from this page.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={days} onChange={(e) => setDays(e.target.value)} className={selCls} title="Records still open, or added / called in this period">
            <option value="10">Last 10 days</option><option value="30">Last 30 days</option><option value="60">Last 60 days</option><option value="90">Last 90 days</option>
          </select>
          <button onClick={load} title="Refresh" className="p-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--heading)]"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
          <button onClick={exportXlsx} disabled={!rows.length} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600/20 text-emerald-500 border border-emerald-500/30 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> Excel</button>
        </div>
      </div>
      {error && <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}
      {d?.capped && <div className="p-3 rounded-xl text-xs border border-amber-500/30 bg-amber-500/10 text-amber-600">The period holds more records than one report can show — pick a shorter period for exact totals.</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(({ label, n, Icon, cls, scope: sc }) => (
          <button key={label} onClick={() => sc && setScope(scope === sc ? "" : sc)} className={`${box} p-4 flex items-center gap-3 text-left ${sc ? "hover:border-violet-400 transition" : "cursor-default"} ${sc && scope === sc ? "ring-2 ring-violet-500" : ""}`}>
            <div className={`p-2.5 rounded-xl shrink-0 ${cls}`}><Icon className="w-5 h-5" /></div>
            <div className="min-w-0">
              <div className="text-xl font-extrabold text-[var(--heading)] leading-tight tabular-nums">{!d ? "…" : n.toLocaleString()}</div>
              <div className="text-[10px] font-bold text-[var(--muted)] uppercase leading-tight">{label}</div>
            </div>
          </button>
        ))}
      </div>

      <div className={box + " p-4 flex flex-wrap items-end gap-3"}>
        <div className="flex items-center gap-2 text-[var(--heading)] font-bold text-sm mr-1"><ListChecks className="w-4 h-4 text-violet-400" /> Filter</div>
        <select value={scope} onChange={(e) => setScope(e.target.value)} className={selCls}>
          <option value="">In 2 or 3 lists</option><option value="three">In all three</option><option value="two">In exactly two</option>
          <option value="open2">Still open in 2+ lists (will be called twice)</option><option value="open1">Still open in at least one</option>
        </select>
        <select value={pair} onChange={(e) => setPair(e.target.value)} className={selCls}>
          <option value="">Any list</option>
          {SOURCES.map((s) => <option key={s} value={s}>Includes {SOURCE_LABEL[s]}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Phone or name…" className={inputCls + " w-48"} />
        <span className="ml-auto text-xs text-[var(--muted)]">{loading && !d ? "Loading…" : `${rows.length.toLocaleString()} number(s)`}</span>
      </div>

      <div className={box + " overflow-hidden"}>
        {!loading && !rows.length ? <div className="p-8 text-center text-xs text-[var(--muted)]">{d ? "No number is in more than one list for this period and filter." : "Loading…"}</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] bg-[var(--surface-2)]/40">
                <th className="text-left py-3 px-3">Customer</th>
                {SOURCES.map((s) => <th key={s} className="text-left py-3 px-3">{SOURCE_LABEL[s]}</th>)}
                <th className="text-left py-3 px-3">Last call</th>
              </tr></thead>
              <tbody>
                {shown.map((n) => {
                  const isOpen = open === n.key;
                  return [
                    <tr key={n.key} onClick={() => setOpen(isOpen ? null : n.key)} className={`border-b border-[var(--border)]/40 cursor-pointer hover:bg-[var(--surface-2)]/30 align-top ${n.open_sources.length >= 2 ? "bg-rose-500/5" : ""}`}>
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-bold text-[var(--heading)]" dir="ltr" onCopy={phoneOnCopy}>{n.phone}</div>
                        <div className="text-[11px] text-[var(--muted)]">{n.name || "—"}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/10 border border-violet-500/30 text-violet-500">{n.sources.length} lists</span>
                          {n.open_sources.length >= 2 && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 border border-rose-500/30 text-rose-500">open in {n.open_sources.length}</span>}
                        </div>
                      </td>
                      {SOURCES.map((s) => {
                        const es = n.entries.filter((e) => e.source === s);
                        if (!es.length) return <td key={s} className="py-2.5 px-3 text-[var(--muted)]">—</td>;
                        const st = stateOf(es);
                        const last = es.filter((e) => e.contacted_at).sort((a, b) => String(b.contacted_at).localeCompare(String(a.contacted_at)))[0];
                        const agents = [...new Set(es.map((e) => e.agent).filter(Boolean))];
                        return (
                          <td key={s} className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border whitespace-nowrap ${st === "Waiting" ? "bg-amber-500/10 text-amber-600 border-amber-500/30" : st === "Open, called" ? "bg-sky-500/10 text-sky-500 border-sky-500/30" : st === "Called, closed" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" : "bg-zinc-500/10 text-zinc-500 border-zinc-500/30"}`}>{st}</span>
                            {es.length > 1 && <span className="ml-1 text-[10px] text-[var(--muted)]">×{es.length}</span>}
                            <div className="text-[11px] text-[var(--text)] mt-1">{agents.length ? agents.join(", ") : <span className="text-amber-600">no agent</span>}</div>
                            {last && <div className="text-[10px] text-[var(--muted)]">{fmtDT(last.contacted_at)} · {resultText(last.result)}</div>}
                          </td>
                        );
                      })}
                      <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">{fmtDT(n.last_contacted_at) || <span className="text-[var(--muted)]">never</span>}</td>
                    </tr>,
                    ...(isOpen ? [
                      <tr key={n.key + ":d"} className="bg-[var(--surface-2)]/30"><td colSpan={5} className="px-5 py-3">
                        <table className="w-full text-[11px]">
                          <thead><tr className="text-[10px] text-[var(--muted)] font-bold"><th className="text-left py-1">List</th><th className="text-left py-1">Campaign / brand</th><th className="text-left py-1">Status</th><th className="text-left py-1">Agent</th><th className="text-left py-1">Added</th><th className="text-left py-1">Last call</th><th className="text-left py-1">Result</th></tr></thead>
                          <tbody>{n.entries.map((e) => (
                            <tr key={e.source + e.id} className="border-t border-[var(--border)]/40">
                              <td className="py-1 font-bold text-[var(--heading)]">{SOURCE_LABEL[e.source] || e.source}</td><td className="py-1">{e.label || "—"}</td>
                              <td className="py-1">{resultText(e.status)}{e.open ? <span className="text-amber-600 font-bold"> · open</span> : ""}</td><td className="py-1">{e.agent || "—"}</td>
                              <td className="py-1 font-mono">{fmtDT(e.created_at)}</td><td className="py-1 font-mono">{e.contacted_at ? `${fmtDT(e.contacted_at)}${e.contacted_by ? ` · ${e.contacted_by}` : ""}` : "—"}</td><td className="py-1">{resultText(e.result) || "—"}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </td></tr>,
                    ] : []),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > PAGE_SIZE && (
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)] border-t border-[var(--border)]">
            <span>{((cur - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(cur * PAGE_SIZE, rows.length).toLocaleString()} of {rows.length.toLocaleString()}</span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage(cur - 1)} disabled={cur === 1} className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-bold disabled:opacity-40">Previous</button>
              <span className="px-2 font-bold text-[var(--heading)]">Page {cur} / {pages}</span>
              <button onClick={() => setPage(cur + 1)} disabled={cur === pages} className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-bold disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
