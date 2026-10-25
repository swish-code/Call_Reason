import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import DncBadge from "./DncBadge.tsx";
import OfferCustomerPanel from "./OfferCustomerPanel.tsx";
import { Card as ChartCard, GroupedColumns, STYLE as CHART_STYLE, C as CC, type Series } from "./SurveyCharts.tsx";
import { useDoNotCall } from "../lib/dnc.ts";
import {
  OfferCampaign as Campaign, Eligibility, CALL_STATUS, OFFER_STATE, MANAGER_ROLES, kwToday, fmtDay, stepLabel,
} from "../lib/offers.ts";
import { Gift, PhoneOutgoing, Search, Users, UploadCloud, BarChart3, Settings2, RefreshCw, AlertCircle, CheckCircle2, Download, Filter, X } from "lucide-react";

// Offer campaigns page (first campaign: Shakir). Agents: My calls + Find customer. Team leaders and above also:
// Customers (assign, export), Upload, Dashboard, Script & settings.

type Tab = "calls" | "find" | "customers" | "upload" | "dashboard" | "settings";
const inputCls = "px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-violet-500 focus:outline-none";
const selCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";
const Badge = ({ cls, children, title }: { cls: string; children: any; title?: string }) => <span title={title} className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${cls}`}>{children}</span>;
const box = "bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg";
const Err = ({ text }: { text: string }) => text ? <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {text}</div> : null;
const Ok = ({ text }: { text: string }) => text ? <div className="p-3 rounded-xl text-xs border bg-emerald-950/20 border-emerald-500/20 text-emerald-400 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" /> {text}</div> : null;

export default function OfferCampaignPage({ currentUser }: { currentUser: User }) {
  const canManage = MANAGER_ROLES.includes(currentUser.role);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campId, setCampId] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>(canManage ? "dashboard" : "calls");
  const [open, setOpen] = useState<{ id: string; mode: "call" | "lookup" } | null>(null);
  const [tick, setTick] = useState(0);              // bumps after a change in the panel, so lists reload

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await apiFetch("/api/offer-campaigns");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load the campaigns.");
      const list: Campaign[] = await res.json();
      setCampaigns(list);
      setCampId((prev) => prev && list.some((c) => c.id === prev) ? prev : list[0]?.id || "");
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);
  const camp = campaigns.find((c) => c.id === campId);

  const tabs: { key: Tab; label: string; icon: any; show: boolean }[] = [
    { key: "calls", label: "My calls", icon: PhoneOutgoing, show: true },
    { key: "find", label: "Find customer", icon: Search, show: true },
    { key: "customers", label: "Customers", icon: Users, show: canManage },
    { key: "upload", label: "Upload", icon: UploadCloud, show: canManage },
    { key: "dashboard", label: "Dashboard", icon: BarChart3, show: canManage },
    { key: "settings", label: "Script & settings", icon: Settings2, show: canManage },
  ];

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      <div className="bg-gradient-to-r from-[var(--surface)] via-[var(--surface-2)] to-[var(--bg)] border border-[var(--border)] p-6 rounded-3xl shadow-xl flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="bg-violet-950/45 text-violet-400 text-xs font-bold px-3 py-1 rounded-full border border-violet-500/30">Offer campaign</span>
          <h1 className="text-2xl md:text-3xl font-extrabold text-[var(--heading)] tracking-tight mt-2 flex items-center gap-2"><Gift className="w-7 h-7 text-violet-400" /> {camp?.name || "Campaign"}</h1>
          {camp && <p className="text-[var(--muted)] text-sm mt-1 font-light">{camp.steps.map((s, i) => `${stepLabel(i + 1)} order ${s}% off`).join(" · ")} — valid {camp.validity_days} days from the day the customer accepts the offer, only through the call center.</p>}
        </div>
        {campaigns.length > 1 && (
          <select value={campId} onChange={(e) => setCampId(e.target.value)} className={selCls}>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status !== "active" ? " (paused)" : ""}</option>)}
          </select>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.filter((t) => t.show).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition ${tab === key ? "bg-violet-600 text-white border-violet-500" : "bg-[var(--surface)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)]"}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <Err text={error} />
      {!camp ? (!error && <div className="text-xs text-[var(--muted)]">Loading…</div>) : (
        <>
          {tab === "calls" && <MyCalls camp={camp} tick={tick} onOpen={(id) => setOpen({ id, mode: "call" })} />}
          {tab === "find" && <FindCustomer tick={tick} onOpen={(id) => setOpen({ id, mode: "lookup" })} />}
          {tab === "customers" && canManage && <Customers camp={camp} tick={tick} onOpen={(id) => setOpen({ id, mode: "lookup" })} />}
          {tab === "upload" && canManage && <Upload camp={camp} />}
          {tab === "dashboard" && canManage && <Dashboard camp={camp} tick={tick} />}
          {tab === "settings" && canManage && <SettingsTab camp={camp} onSaved={loadCampaigns} />}
        </>
      )}

      {open && <OfferCustomerPanel id={open.id} mode={open.mode} currentUser={currentUser} canManage={canManage} onClose={() => setOpen(null)} onChanged={() => setTick((t) => t + 1)} />}
    </div>
  );
}

// ---------------------------------------------------------------- My calls (the agent's list)
function MyCalls({ camp, tick, onOpen }: { camp: Campaign; tick: number; onOpen: (id: string) => void }) {
  const [d, setD] = useState<{ rows: any[]; later: number; today: { calls: number; reached: number } } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setError("");
      const res = await apiFetch(`/api/offer-campaigns/${camp.id}/my-calls`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load your list.");
      setD(await res.json());
    } catch (e: any) { setError(e.message); }
  }, [camp.id]);
  useEffect(() => { load(); }, [load, tick]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[["To call now", d?.rows.length ?? "…"], ["Call back on a later day", d?.later ?? "…"], ["My calls today", d?.today.calls ?? "…"], ["Reached today", d?.today.reached ?? "…"]].map(([l, v]) => (
          <div key={String(l)} className={box + " px-4 py-3"}><div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">{l}</div><div className="text-2xl font-extrabold text-[var(--heading)] mt-1">{v}</div></div>
        ))}
      </div>
      <Err text={error} />
      <div className={box + " overflow-hidden"}>
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <span className="text-xs font-bold text-[var(--heading)]">Customers assigned to you</span>
          <button onClick={load} className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--heading)]"><RefreshCw className="w-4 h-4" /></button>
        </div>
        {!d ? <div className="p-6 text-xs text-[var(--muted)]">Loading…</div> : !d.rows.length ? <div className="p-8 text-center text-xs text-[var(--muted)]">Nothing to call right now.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] bg-[var(--surface-2)]/40">
                <th className="text-left py-3 px-4">Customer</th><th className="text-left py-3 px-4">Status</th><th className="text-center py-3 px-4">Attempts</th><th className="text-left py-3 px-4">Contact date</th><th className="text-left py-3 px-4">Last note</th><th />
              </tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)]/40 last:border-0 hover:bg-[var(--surface-2)]/30">
                    <td className="py-2.5 px-4"><div className="font-bold text-[var(--heading)]">{r.customer_name || "—"}</div><div className="font-mono text-[11px]" dir="ltr">{r.phone}</div></td>
                    <td className="py-2.5 px-4"><Badge cls={CALL_STATUS[r.call_status]?.cls || ""}>{CALL_STATUS[r.call_status]?.label || r.call_status}</Badge></td>
                    <td className="py-2.5 px-4 text-center font-mono">{r.attempts}</td>
                    <td className="py-2.5 px-4 font-mono">{fmtDay(r.contact_date)}</td>
                    <td className="py-2.5 px-4 max-w-[22rem] truncate" title={r.comment || ""}>{r.comment || <span className="text-[var(--muted)]">—</span>}</td>
                    <td className="py-2.5 px-4 text-right"><button onClick={() => onOpen(r.id)} className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-violet-600 hover:bg-violet-700 text-white">Open &amp; call</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Find customer (inbound)
function FindCustomer({ tick, onOpen }: { tick: number; onOpen: (id: string) => void }) {
  const [phone, setPhone] = useState("");
  const [res, setRes] = useState<{ rows: any[]; dnc: any } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const last = useRef("");
  const search = async (p = phone) => {
    setError(""); setBusy(true); last.current = p;
    try {
      const r = await apiFetch(`/api/offer-campaigns/lookup?phone=${encodeURIComponent(p.trim())}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Search failed.");
      setRes(d);
    } catch (e: any) { setError(e.message); setRes(null); } finally { setBusy(false); }
  };
  useEffect(() => { if (last.current) search(last.current); }, [tick]);   // refresh after a change in the panel
  return (
    <div className="space-y-4">
      <div className={box + " p-4 flex flex-wrap items-end gap-3"}>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">The customer's phone number
          <input value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} dir="ltr" placeholder="e.g. 99999999" className={inputCls + " w-56 font-mono text-sm"} autoFocus />
        </label>
        <button onClick={() => search()} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"><Search className="w-4 h-4" /> {busy ? "Searching…" : "Search"}</button>
        <p className="text-[11px] text-[var(--muted)] basis-full">When a customer calls about the offer: search the number, check the offer is valid and which discount is next, then open the customer to log the order.</p>
      </div>
      <Err text={error} />
      {res && (
        <div className="space-y-3">
          {res.dnc && <div className="p-3 rounded-xl border-2 border-rose-500 bg-rose-600/15 text-rose-300 text-xs"><b>This number is on the Do Not Call list.</b> Help them if they called us, but never call them.</div>}
          {!res.rows.length ? <div className={box + " p-8 text-center text-xs text-[var(--muted)]"}>This number is not in any offer campaign — no offer discount applies.</div> : res.rows.map((r) => {
            const el: Eligibility = r.eligibility;
            return (
              <div key={r.id} className={box + " p-4 flex flex-wrap items-center justify-between gap-4"}>
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-violet-400">{r.campaign_name}</div>
                  <div className="text-base font-extrabold text-[var(--heading)]">{r.customer_name || "—"} <span className="font-mono text-sm" dir="ltr">{r.phone}</span>{res.dnc && <DncBadge />}</div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <Badge cls={OFFER_STATE[el.state].cls}>{OFFER_STATE[el.state].label}</Badge>
                    <Badge cls={CALL_STATUS[r.call_status]?.cls || ""}>{CALL_STATUS[r.call_status]?.label || r.call_status}</Badge>
                    {r.agent_name && <span className="text-[11px] text-[var(--muted)]">Agent: {r.agent_name}</span>}
                  </div>
                </div>
                <div className="text-right space-y-1">
                  {el.next && el.state !== "expired"
                    ? <div className="text-sm text-[var(--text)]">Next: <b className="text-emerald-500 text-lg">{el.next.discount}% off</b> <span className="text-[var(--muted)]">({stepLabel(el.next.step)} order)</span></div>
                    : <div className="text-sm text-[var(--muted)]">{el.state === "completed" ? "All discounts used" : `Expired on ${el.expires}`}</div>}
                  <div className="text-[11px] text-[var(--muted)]">{el.used} of {el.total} used{el.expires ? ` · until ${el.expires}${el.state === "active" ? ` (${el.daysLeft} days left)` : ""}` : ""}</div>
                  <button onClick={() => onOpen(r.id)} className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-violet-600 hover:bg-violet-700 text-white">Open customer</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Customers (leaders)
function Customers({ camp, tick, onOpen }: { camp: Campaign; tick: number; onOpen: (id: string) => void }) {
  const dnc = useDoNotCall();
  const [rows, setRows] = useState<any[]>([]);
  const [agents, setAgents] = useState<{ id: string; full_name: string; open: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [f, setF] = useState({ status: "", agent: "", offer: "", from: "", to: "", search: "" });
  const [giveAgent, setGiveAgent] = useState("");
  const [giveCount, setGiveCount] = useState("20");
  const [searchText, setSearchText] = useState("");
  useEffect(() => { const t = setTimeout(() => setF((p) => ({ ...p, search: searchText })), 300); return () => clearTimeout(t); }, [searchText]);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError("");
      const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
      const [r, a] = await Promise.all([apiFetch(`/api/offer-campaigns/${camp.id}/customers?${qs}`), apiFetch(`/api/offer-campaigns/${camp.id}/agents`)]);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not load the customers.");
      setRows((await r.json()).rows);
      if (a.ok) setAgents(await a.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [camp.id, f]);
  useEffect(() => { load(); }, [load, tick]);

  const give = async () => {
    setError(""); setMsg("");
    const res = await apiFetch(`/api/offer-campaigns/${camp.id}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: giveAgent, count: Number(giveCount) }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error || "Could not assign."); return; }
    setMsg(`Gave ${d.assigned} customer(s) to ${agents.find((a) => a.id === giveAgent)?.full_name || "the agent"}.`);
    load();
  };
  const reassign = async (id: string, agentId: string) => {
    setError(""); setMsg("");
    const res = await apiFetch(`/api/offer-campaigns/customers/${id}/assign`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: agentId || null }) });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Could not change the agent."); return; }
    load();
  };

  const unassigned = rows.filter((r) => !r.assigned_agent_id && r.call_status === "not_called").length;
  const orderDate = (r: any, step: number) => fmtDay(r.orders.find((o: any) => o.step === step)?.order_date) || "";
  const exportCsv = () => downloadCSV(
    ["Uploaded Day", "Date of contact", "Customer Name", "Phone number", "Call status", "1st Call Date", ...camp.steps.map((s) => `${s}% Order Date`), "Agent name", "Churn Reason", "Comment", "Offer", "Offer starts", "Offer ends"],
    rows.map((r) => [fmtDay(r.uploaded_at), fmtDay(r.contact_date), r.customer_name || "", r.phone, CALL_STATUS[r.call_status]?.label || r.call_status, fmtDay(r.first_call_at),
      ...camp.steps.map((_s, i) => orderDate(r, i + 1)), r.agent_name || "", r.churn_reason || "", r.comment || "",
      OFFER_STATE[r.eligibility.state as Eligibility["state"]].label, r.eligibility.starts || "", r.eligibility.expires || ""]),
    `${camp.name.replace(/\s+/g, "_")}_customers_${kwToday()}`,
  );
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4">
      <div className={box + " p-4 flex flex-wrap items-end gap-3"}>
        <div className="flex items-center gap-2 text-[var(--heading)] font-bold text-sm mr-1"><Users className="w-4 h-4 text-violet-400" /> Give customers</div>
        <span className="text-[11px] text-[var(--muted)]"><b className="text-[var(--heading)]">{unassigned}</b> never-called customer(s) without an agent</span>
        <select value={giveAgent} onChange={(e) => setGiveAgent(e.target.value)} className={selCls + " min-w-[12rem]"}>
          <option value="">— agent —</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name} — {a.open} open</option>)}
        </select>
        <input type="number" min="1" max="2000" value={giveCount} onChange={(e) => setGiveCount(e.target.value)} className={inputCls + " w-24"} />
        <button onClick={give} disabled={!giveAgent || !Number(giveCount)} className="px-4 py-2 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50">Give</button>
      </div>

      <div className={box + " p-4 flex flex-wrap items-end gap-3"}>
        <div className="flex items-center gap-2 text-[var(--heading)] font-bold text-sm mr-1"><Filter className="w-4 h-4 text-violet-400" /> Filter</div>
        <select value={f.status} onChange={(e) => set("status", e.target.value)} className={selCls}>
          <option value="">All statuses</option><option value="open">Still to call</option>
          {Object.entries(CALL_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={f.agent} onChange={(e) => set("agent", e.target.value)} className={selCls}>
          <option value="">All agents</option><option value="unassigned">No agent</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
        <select value={f.offer} onChange={(e) => set("offer", e.target.value)} className={selCls}>
          <option value="">Any offer state</option>
          {Object.entries(OFFER_STATE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">Uploaded from<input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set("from", e.target.value)} className={inputCls} /></label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">to<input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set("to", e.target.value)} className={inputCls} /></label>
        <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Name or phone…" className={inputCls + " w-44"} />
        {Object.values(f).some(Boolean) && <button onClick={() => { setF({ status: "", agent: "", offer: "", from: "", to: "", search: "" }); setSearchText(""); }} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-[var(--muted)] hover:text-[var(--heading)]"><X className="w-3.5 h-3.5" /> Clear</button>}
        <button onClick={exportCsv} disabled={!rows.length} className="ml-auto flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600/20 text-emerald-500 border border-emerald-500/30 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> Excel (CSV)</button>
      </div>

      <Err text={error} /><Ok text={msg} />
      <div className={box + " overflow-hidden"}>
        <div className="px-4 py-3 text-xs text-[var(--muted)] border-b border-[var(--border)]">{loading ? "Loading…" : `${rows.length.toLocaleString()} customer(s)`}</div>
        {!loading && !rows.length ? <div className="p-8 text-center text-xs text-[var(--muted)]">No customers match.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] bg-[var(--surface-2)]/40">
                <th className="text-left py-3 px-3">Uploaded</th><th className="text-left py-3 px-3">Customer</th><th className="text-left py-3 px-3">Agent</th><th className="text-left py-3 px-3">Status</th>
                <th className="text-left py-3 px-3">1st call</th>{camp.steps.map((s) => <th key={s} className="text-left py-3 px-3">{s}% order</th>)}
                <th className="text-left py-3 px-3">Offer</th><th className="text-left py-3 px-3">Churn reason</th><th />
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const el: Eligibility = r.eligibility;
                  const isOpen = CALL_STATUS[r.call_status]?.open;
                  return (
                    <tr key={r.id} className="border-b border-[var(--border)]/40 last:border-0 hover:bg-[var(--surface-2)]/30 align-top">
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">{fmtDay(r.uploaded_at)}</td>
                      <td className="py-2.5 px-3"><div className="font-bold text-[var(--heading)]">{r.customer_name || "—"}</div><div className="font-mono text-[11px] whitespace-nowrap" dir="ltr">{r.phone}</div>{dnc.isDnc(r.phone) && <DncBadge block />}</td>
                      <td className="py-2.5 px-3">
                        {isOpen ? (
                          <select value={r.assigned_agent_id || ""} onChange={(e) => reassign(r.id, e.target.value)} className={selCls + " min-w-[9rem]"}>
                            <option value="">— none —</option>
                            {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                          </select>
                        ) : <span title="Only customers still to be called can change hands">{r.agent_name || "—"}</span>}
                      </td>
                      <td className="py-2.5 px-3"><Badge cls={CALL_STATUS[r.call_status]?.cls || ""}>{CALL_STATUS[r.call_status]?.label || r.call_status}</Badge>{r.attempts > 0 && <div className="text-[10px] text-[var(--muted)] mt-0.5">{r.attempts} attempt(s)</div>}</td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">{fmtDay(r.first_call_at) || "—"}</td>
                      {camp.steps.map((_s, i) => <td key={i} className="py-2.5 px-3 font-mono whitespace-nowrap">{orderDate(r, i + 1) || "—"}</td>)}
                      <td className="py-2.5 px-3"><Badge cls={OFFER_STATE[el.state].cls}>{OFFER_STATE[el.state].label}</Badge>{el.expires && <div className="text-[10px] text-[var(--muted)] mt-0.5">until {el.expires}</div>}</td>
                      <td className="py-2.5 px-3 max-w-[10rem]">{r.churn_reason || <span className="text-[var(--muted)]">—</span>}</td>
                      <td className="py-2.5 px-3 text-right"><button onClick={() => onOpen(r.id)} className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-[var(--bg)] border border-[var(--border)] hover:text-[var(--heading)]">Open</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Upload (leaders)
function Upload({ camp }: { camp: Campaign }) {
  const [file, setFile] = useState<{ name: string; b64: string } | null>(null);
  const [check, setCheck] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const pickFile = (f?: File | null) => {
    setCheck(null); setResult(null); setError("");
    if (!f) { setFile(null); return; }
    const reader = new FileReader();
    reader.onload = () => setFile({ name: f.name, b64: String(reader.result).split(",")[1] || "" });
    reader.readAsDataURL(f);
  };
  const send = async (dry: boolean) => {
    if (!file) return;
    setBusy(dry ? "check" : "upload"); setError("");
    try {
      const res = await apiFetch(`/api/offer-campaigns/${camp.id}/upload`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: file.b64, dry_run: dry }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Upload failed.");
      if (dry) setCheck(d); else { setResult(d); setCheck(null); setFile(null); }
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const template = async () => {
    const res = await apiFetch("/api/offer-campaigns/template");
    if (!res.ok) return;
    const d = await res.json();
    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + d.file; a.download = d.filename; a.click();
  };
  const REASON: Record<string, string> = { dup_file: "Duplicate in the file", already_in_campaign: "Already in the campaign", do_not_call: "Do Not Call", empty_row: "Empty row", error: "Rejected", agent_not_found: "Agent name not found" };
  const shown = result || check;
  return (
    <div className="space-y-4">
      <div className={box + " p-5 space-y-3"}>
        <p className="text-sm font-bold text-[var(--heading)]">Upload the day's customers</p>
        <p className="text-xs text-[var(--muted)]">Excel with a <b>Customer Name</b> and a <b>Phone</b> column. Optional: an <b>Agent</b> column with the agent's full name (assigns them straight away). Any other column (last order, branch…) is kept and shown on the customer. Numbers already in the campaign, repeated in the file, or on the Do Not Call list are skipped.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={template} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-[var(--bg)] border border-[var(--border)] hover:text-[var(--heading)]"><Download className="w-3.5 h-3.5" /> Template</button>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => pickFile(e.target.files?.[0])} className="text-xs" />
          <button onClick={() => send(true)} disabled={!file || !!busy} className="px-4 py-2 rounded-xl text-xs font-bold bg-[var(--bg)] border border-violet-500/40 text-violet-400 disabled:opacity-50">{busy === "check" ? "Checking…" : "Check the file"}</button>
          <button onClick={() => send(false)} disabled={!file || !check || !!busy} className="px-4 py-2 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50">{busy === "upload" ? "Uploading…" : check ? `Upload ${check.would_insert} customer(s)` : "Upload"}</button>
        </div>
        <Err text={error} />
      </div>
      {shown && (
        <div className={box + " p-5 space-y-3"}>
          <p className="text-sm font-bold text-[var(--heading)]">{result ? "Uploaded" : "Check result (nothing saved yet)"}</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            {[["Rows in file", shown.total], [result ? "Added" : "Will be added", result ? result.inserted : shown.would_insert], ["Pre-assigned", shown.assigned], ["Skipped", shown.skipped], ["Rejected", shown.errors]].map(([l, v]) => (
              <div key={String(l)} className="p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)]"><div className="text-[10px] text-[var(--muted)] font-bold uppercase">{l}</div><div className="text-xl font-extrabold text-[var(--heading)]">{v}</div></div>
            ))}
          </div>
          {shown.issues?.length > 0 && (
            <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]"><th className="text-left py-1.5 px-2">Row</th><th className="text-left py-1.5 px-2">Phone</th><th className="text-left py-1.5 px-2">Name</th><th className="text-left py-1.5 px-2">Why</th><th className="text-left py-1.5 px-2">Detail</th></tr></thead>
                <tbody>{shown.issues.map((i: any, k: number) => <tr key={k} className="border-b border-[var(--border)]/40"><td className="py-1.5 px-2">{i.row}</td><td className="py-1.5 px-2 font-mono" dir="ltr">{i.phone || ""}</td><td className="py-1.5 px-2">{i.customer_name || ""}</td><td className="py-1.5 px-2 font-bold">{REASON[i.reason] || i.reason}</td><td className="py-1.5 px-2 text-[var(--muted)]">{i.detail}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {result && <p className="text-[11px] text-[var(--muted)]">The full list of skipped rows is also on the Audit page (Uploads tab).</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Dashboard (leaders)
function Dashboard({ camp, tick }: { camp: Campaign; tick: number }) {
  const today = kwToday();
  const [range, setRange] = useState({ from: today, to: today, preset: "today" });
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setError("");
      const res = await apiFetch(`/api/offer-campaigns/${camp.id}/dashboard?from=${range.from}&to=${range.to}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load the dashboard.");
      setD(await res.json());
    } catch (e: any) { setError(e.message); }
  }, [camp.id, range.from, range.to]);
  useEffect(() => { load(); }, [load, tick]);
  const preset = (p: string) => {
    const t = kwToday(), dt = new Date(t + "T00:00:00Z");
    const back = (n: number) => new Date(dt.getTime() - n * 86400_000).toISOString().slice(0, 10);
    if (p === "today") setRange({ from: t, to: t, preset: p });
    if (p === "yesterday") setRange({ from: back(1), to: back(1), preset: p });
    if (p === "week") setRange({ from: back((dt.getUTCDay() + 1) % 7), to: t, preset: p });          // Kuwait week starts Saturday
    if (p === "month") setRange({ from: t.slice(0, 8) + "01", to: t, preset: p });
  };
  const inRange = (day: string) => day >= range.from && day <= range.to;
  const sum = (k: string) => (d?.days || []).filter((x: any) => inRange(x.day)).reduce((a: number, x: any) => a + (x[k] || 0), 0);
  const steps: number[] = d?.campaign?.steps || camp.steps;
  const ordersTotal = steps.reduce((a, _s, i) => a + sum(`o${i + 1}`), 0);
  const cats = (d?.days || []).map((x: any) => ({ key: x.day, label: String(Number(x.day.slice(8, 10))) }));
  const dayMap = new Map((d?.days || []).map((x: any) => [x.day, x]));
  const colors = [CC.aqua, CC.orange, CC.violet, CC.yellow, CC.magenta];
  const S_CALLS: Series[] = [{ key: "calls", label: "Calls", color: CC.blue }, { key: "reached", label: "Reached", color: CC.aqua }, { key: "accepted", label: "Accepted / ordered", color: CC.orange }];
  const S_ORDERS: Series[] = steps.map((s, i) => ({ key: `o${i + 1}`, label: `${s}% orders`, color: colors[i] || CC.other }));
  const t = d?.totals || {};
  const tile = (l: string, v: any, hint?: string) => (
    <div key={l} className={box + " px-4 py-3"}><div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">{l}</div><div className="text-2xl font-extrabold text-[var(--heading)] mt-1">{v ?? "…"}</div>{hint && <div className="text-[10px] text-[var(--muted)]">{hint}</div>}</div>
  );
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  return (
    <section className="space-y-5 svc">
      <style>{CHART_STYLE}</style>
      <div className={box + " p-4 flex flex-wrap items-end gap-3"}>
        <div className="flex items-center gap-2 text-[var(--heading)] font-bold text-sm mr-1"><Filter className="w-4 h-4 text-violet-400" /> Period</div>
        {[["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["month", "This month"]].map(([k, l]) => (
          <button key={k} onClick={() => preset(k)} className={`px-4 py-2 rounded-xl text-xs font-bold border ${range.preset === k ? "bg-violet-600 text-white border-violet-500" : "bg-[var(--bg)] text-[var(--text)] border-[var(--border)]"}`}>{l}</button>
        ))}
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">From<input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value, preset: "" })} className={inputCls} /></label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">To<input type="date" value={range.to} min={range.from} max={today} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value, preset: "" })} className={inputCls} /></label>
        <button onClick={load} className="ml-auto p-2 rounded-xl text-[var(--muted)] hover:text-[var(--heading)]"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <Err text={error} />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {tile("Uploaded", sum("uploaded"))}
        {tile("First calls", sum("first_calls"))}
        {tile("All calls", sum("calls"), `${sum("outbound")} out · ${sum("inbound")} in`)}
        {tile("Reached", sum("reached"), pct(sum("reached"), sum("calls")) + " of calls")}
        {tile("Accepted / ordered", sum("accepted"))}
        {steps.map((s, i) => tile(`${s}% orders`, sum(`o${i + 1}`)))}
      </div>
      <div className="text-[11px] text-[var(--muted)] -mt-2">Offer orders in the period: <b className="text-[var(--heading)]">{ordersTotal}</b>{sum("value") ? <> · value <b className="text-[var(--heading)]">{sum("value").toFixed(3)} KWD</b></> : null}. Calls and orders are counted on the day they happened (Kuwait time).</div>

      <div>
        <p className="text-xs font-extrabold text-[var(--heading)] mb-2">Whole campaign, right now</p>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {tile("Customers", t.customers)}
          {tile("Without an agent", t.unassigned)}
          {tile("Still to call", t.open)}
          {tile("Offers active", t.offer_active)}
          {tile("Ending in ≤ 3 days", t.expiring_3d)}
          {tile("Redeemed (≥1 order)", t.redeemed, t.customers ? pct(t.redeemed, t.customers) + " of customers" : undefined)}
          {tile("All discounts used", t.completed)}
          {tile("Expired, never used", t.expired_unused)}
        </div>
      </div>

      {d && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <ChartCard reset={d} title="Calls per day" sub={`${d.window.from} → ${d.window.to}`} legend={S_CALLS}
            table={{ head: ["Day", ...S_CALLS.map((s) => s.label)], rows: d.days.map((x: any) => [x.day, ...S_CALLS.map((s) => String(x[s.key]))]) }}>
            {(setTip) => <GroupedColumns cats={cats} series={S_CALLS} value={(c, s) => (dayMap.get(c) as any)?.[s] || 0} selected={inRange} setTip={setTip} />}
          </ChartCard>
          <ChartCard reset={d} title="Offer orders per day" sub="By discount step, on the order date" legend={S_ORDERS}
            table={{ head: ["Day", ...S_ORDERS.map((s) => s.label)], rows: d.days.map((x: any) => [x.day, ...S_ORDERS.map((s) => String(x[s.key]))]) }}>
            {(setTip) => <GroupedColumns cats={cats} series={S_ORDERS} value={(c, s) => (dayMap.get(c) as any)?.[s] || 0} selected={inRange} setTip={setTip} />}
          </ChartCard>
        </div>
      )}

      {d && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className={box + " p-5 xl:col-span-2"}>
            <p className="text-sm font-bold text-[var(--heading)] mb-3">By agent (period)</p>
            {!d.agents.length ? <div className="text-xs text-[var(--muted)]">No activity.</div> : (
              <div className="overflow-x-auto"><table className="w-full text-xs">
                <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]"><th className="text-left py-2 px-2">Agent</th><th className="text-center py-2 px-2">Calls</th><th className="text-center py-2 px-2">Reached</th><th className="text-center py-2 px-2">Accepted</th><th className="text-center py-2 px-2">Orders logged</th><th className="text-center py-2 px-2">Still to call</th></tr></thead>
                <tbody>{d.agents.map((a: any) => <tr key={a.user_id} className="border-b border-[var(--border)]/40"><td className="py-2 px-2 font-bold text-[var(--heading)]">{a.name || "—"}</td><td className="py-2 px-2 text-center font-mono">{a.calls}</td><td className="py-2 px-2 text-center font-mono">{a.reached}</td><td className="py-2 px-2 text-center font-mono">{a.accepted}</td><td className="py-2 px-2 text-center font-mono">{a.orders}</td><td className="py-2 px-2 text-center font-mono">{a.open}</td></tr>)}</tbody>
              </table></div>
            )}
          </div>
          <div className={box + " p-5"}>
            <p className="text-sm font-bold text-[var(--heading)] mb-3">Why customers stopped ordering (period)</p>
            {!d.churn.length ? <div className="text-xs text-[var(--muted)]">No reasons recorded.</div> : (() => {
              const max = Math.max(...d.churn.map((c: any) => c.n));
              const total = d.churn.reduce((a: number, c: any) => a + c.n, 0);
              return <div className="space-y-1.5">{d.churn.map((c: any) => (
                <div key={c.reason} className="text-[11px]"><div className="flex justify-between gap-2"><span className="text-[var(--text)]">{c.reason}</span><span className="font-mono text-[var(--heading)]">{c.n} <span className="text-[var(--muted)]">({pct(c.n, total)})</span></span></div>
                  <div className="h-[8px] bg-[var(--bg)] rounded-sm overflow-hidden mt-0.5"><div className="h-full rounded-r-[4px]" style={{ width: `${(c.n / max) * 100}%`, background: CC.blue }} /></div></div>
              ))}</div>;
            })()}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Script & settings (leaders)
function SettingsTab({ camp, onSaved }: { camp: Campaign; onSaved: () => void }) {
  const [v, setV] = useState({ name: camp.name, validity_days: String(camp.validity_days), steps: camp.steps.join(", "), script_ar: camp.script_ar || "", script_en: camp.script_en || "", churn: (camp.churn_reasons || []).join("\n"), status: camp.status });
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV({ name: camp.name, validity_days: String(camp.validity_days), steps: camp.steps.join(", "), script_ar: camp.script_ar || "", script_en: camp.script_en || "", churn: (camp.churn_reasons || []).join("\n"), status: camp.status }); }, [camp]);
  const save = async () => {
    setBusy(true); setError(""); setMsg("");
    try {
      const body = { name: v.name, validity_days: Number(v.validity_days), steps: v.steps.split(/[,\s/]+/).filter(Boolean).map(Number), script_ar: v.script_ar, script_en: v.script_en, churn_reasons: v.churn.split("\n").map((s) => s.trim()).filter(Boolean), status: v.status };
      const res = await apiFetch(`/api/offer-campaigns/${camp.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not save.");
      setMsg("Saved."); onSaved();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const ta = inputCls + " w-full resize-y leading-6";
  return (
    <div className={box + " p-5 space-y-4"}>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">Campaign name<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={inputCls} /></label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">Discounts in order (%)<input value={v.steps} onChange={(e) => setV({ ...v, steps: e.target.value })} className={inputCls} placeholder="20, 30, 50" /></label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">Valid for (days)<input type="number" min="1" max="365" value={v.validity_days} onChange={(e) => setV({ ...v, validity_days: e.target.value })} className={inputCls} /></label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">Status
          <select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} className={selCls}><option value="active">Active</option><option value="paused">Paused</option></select>
        </label>
      </div>
      <p className="text-[11px] text-[var(--muted)]">Changing the discounts or days affects offers from now on; orders already logged keep the discount they had. In the scripts, <b>[اسم العميل]</b> / <b>[Customer Name]</b> and <b>[اسم الموظف]</b> / <b>[Agent Name]</b> are filled in on the agent's screen.</p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">Script — Arabic<textarea dir="rtl" rows={16} value={v.script_ar} onChange={(e) => setV({ ...v, script_ar: e.target.value })} className={ta} /></label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">Script — English<textarea rows={16} value={v.script_en} onChange={(e) => setV({ ...v, script_en: e.target.value })} className={ta} /></label>
      </div>
      <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)] max-w-xl">Churn reasons (one per line)<textarea rows={8} value={v.churn} onChange={(e) => setV({ ...v, churn: e.target.value })} className={ta} /></label>
      <Err text={error} /><Ok text={msg} />
      <button onClick={save} disabled={busy} className="px-5 py-2 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
    </div>
  );
}
