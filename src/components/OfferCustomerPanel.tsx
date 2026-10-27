import { Fragment, useCallback, useEffect, useState } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import DncBadge from "./DncBadge.tsx";
import {
  OfferCampaign, OfferCustomer, OfferOrder, OfferEvent, Eligibility, CALL_STATUS, OFFER_STATE,
  kwToday, fmtDT, fmtDay, fillScript, stepLabel, fmtExtra, statusText, useOfferLists, handlersFrom, type Handler,
} from "../lib/offers.ts";
import { X, AlertCircle, CheckCircle2, PhoneOutgoing, PhoneIncoming, ShoppingBag, History, FileText, Trash2, RefreshCw } from "lucide-react";

// One customer of an offer campaign: the script, the offer (what is used, what is next, until when), logging a
// call or an order, and the full history. Opened from My calls (to make the call) and
// from Find customer (when the customer calls us).

interface Data { customer: OfferCustomer; campaign: OfferCampaign; orders: OfferOrder[]; events: OfferEvent[]; eligibility: Eligibility; dnc: { reason: string | null; added_by_name: string | null; added_at: string } | null }

const inputCls = "w-full px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-violet-500 focus:outline-none";
const Badge = ({ cls, children }: { cls: string; children: any }) => <span className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${cls}`}>{children}</span>;
const money = (v: any) => (v === null || v === undefined || v === "" ? "" : `${Number(v).toFixed(3)} KWD`);

export default function OfferCustomerPanel({ id, mode, currentUser, canManage, onClose, onChanged }: {
  id: string; mode: "call" | "lookup"; currentUser: User; canManage: boolean; onClose: () => void; onChanged?: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [showScript, setShowScript] = useState(mode === "call");
  // call form
  const [direction, setDirection] = useState<"outbound" | "inbound">(mode === "call" ? "outbound" : "inbound");
  const [status, setStatus] = useState("");   // the picked call result (its id in the Configuration list)
  const [churn, setChurn] = useState("");
  const lists = useOfferLists();
  const picked = lists.results.find((o) => o.id === status);
  const kind = picked?.kind || "";              // the built-in status it works like
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [callBack, setCallBack] = useState("");
  // order form
  const [orderNo, setOrderNo] = useState("");
  const [orderDate, setOrderDate] = useState(kwToday());
  const [orderValue, setOrderValue] = useState("");
  const [orderNote, setOrderNote] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const res = await apiFetch(`/api/offer-campaigns/customers/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load the customer.");
      setData(await res.json());
    } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // the name box shows the saved name (and follows it after every save)
  useEffect(() => { setName(data?.customer.customer_name || ""); }, [data?.customer.customer_name]);
  const nameChanged = !!name.trim() && name.trim() !== (data?.customer.customer_name || "");
  const [gender, setGender] = useState("");
  useEffect(() => { setGender(data?.customer.gender || ""); }, [data?.customer.gender]);
  const genderChanged = !!gender && gender !== (data?.customer.gender || "");
  const detailsChanged = nameChanged || genderChanged;

  const post = async (path: string, body: any, okText: string, key: string) => {
    setBusy(key); setError(""); setMsg("");
    try {
      const res = await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not save.");
      setData(d); setMsg(okText); onChanged?.();
      return true;
    } catch (e: any) { setError(e.message); return false; } finally { setBusy(""); }
  };

  const saveCall = async () => {
    if (!picked) { setError("Pick the result of the call."); return; }
    if (kind === "call_back" && !callBack) { setError("Pick the day to call back."); return; }
    const ok = await post(`/api/offer-campaigns/customers/${id}/call`, { ...(picked.builtin ? { call_status: picked.kind } : { result_id: picked.id }), direction, churn_reason: churn || undefined, comment: comment || undefined, call_back_date: callBack || undefined, customer_name: nameChanged ? name.trim() : undefined, gender: genderChanged ? gender : undefined }, "Call saved.", "call");
    if (ok) { setStatus(""); setComment(""); setCallBack(""); }
  };
  const saveName = async () => {
    setBusy("name"); setError(""); setMsg("");
    try {
      const res = await apiFetch(`/api/offer-campaigns/customers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer_name: nameChanged ? name.trim() : undefined, gender: genderChanged ? gender : undefined }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not save.");
      setData(d); setMsg("Saved."); onChanged?.();
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const saveOrder = async () => {
    const digits = orderNo.replace(/\D/g, "");
    if (digits.length >= 8 && digits.slice(-8) === String(data?.customer.phone || "").replace(/\D/g, "").slice(-8)) { setError("That is the customer's phone number, not an order number. Type the order number, or leave it empty if there is none."); return; }
    const next = data?.eligibility.next;
    if (!next || !window.confirm(`Log ${orderNo.trim() ? `order ${orderNo.trim()}` : "this order"} with ${next.discount}% off (${stepLabel(next.step)} order of the offer)?`)) return;
    const ok = await post(`/api/offer-campaigns/customers/${id}/orders`, { order_number: orderNo.trim(), order_date: orderDate, order_value: orderValue === "" ? undefined : orderValue, comment: orderNote || undefined }, "Order logged.", "order");
    if (ok) { setOrderNo(""); setOrderValue(""); setOrderNote(""); setOrderDate(kwToday()); }
  };
  const removeOrder = async (o: OfferOrder) => {
    const reason = window.prompt(`Remove the ${stepLabel(o.step)} order${o.order_number ? ` ${o.order_number}` : ""} (${o.discount}%)?\nWrite why (kept in the history):`);
    if (!reason || !reason.trim()) return;
    await post(`/api/offer-campaigns/orders/${o.id}/remove`, { reason: reason.trim() }, "Order removed.", "remove");
  };

  const c = data?.customer;
  const el = data?.eligibility;
  const camp = data?.campaign;
  const agentForScript = currentUser.full_name;   // the agent reading the script

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-y-auto p-3 sm:p-6" onClick={onClose}>
      <div className="max-w-6xl mx-auto bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)] bg-[var(--bg)]">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-violet-400">{camp?.name || "Offer campaign"}</div>
            <h3 className="text-lg font-extrabold text-[var(--heading)] truncate">{c?.customer_name || "Customer"}</h3>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              <span className="font-mono text-sm font-bold text-[var(--heading)] select-all" dir="ltr">{c?.phone}</span>
              {data?.dnc && <DncBadge />}
              {c && <Badge cls={CALL_STATUS[c.call_status]?.cls || ""}>{statusText(c)}</Badge>}
              {el && <Badge cls={OFFER_STATE[el.state].cls}>{OFFER_STATE[el.state].label}</Badge>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={load} title="Refresh" className="p-2 rounded-xl text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface-2)]"><RefreshCw className="w-4 h-4" /></button>
            <button onClick={onClose} className="p-2 rounded-xl text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface-2)]"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {!data ? (
          <div className="p-10 text-center text-xs text-[var(--muted)]">{error ? <span className="text-rose-400">{error}</span> : "Loading…"}</div>
        ) : (
          <div className="p-5 space-y-4">
            {data.dnc && (
              <div className="p-4 rounded-2xl border-2 border-rose-500 bg-rose-600/15 text-rose-300 text-xs">
                <b className="text-sm">DO NOT CALL THIS CUSTOMER.</b> They asked us not to contact them again{data.dnc.reason ? ` (${data.dnc.reason})` : ""}. You can still help them if they call us.
              </div>
            )}
            {error && <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}
            {msg && <div className="p-3 rounded-xl text-xs border bg-emerald-950/20 border-emerald-500/20 text-emerald-400 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" /> {msg}</div>}

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              {/* left: script + call + order */}
              <div className="lg:col-span-3 space-y-4">
                <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5">
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <button onClick={() => setShowScript(!showScript)} className="flex items-center gap-2 text-xs font-extrabold text-[var(--heading)]"><FileText className="w-4 h-4 text-violet-400" /> Call script {showScript ? "▾" : "▸"}</button>
                    {showScript && (
                      <div className="flex rounded-lg overflow-hidden border border-[var(--border)]">
                        {(["ar", "en"] as const).map((l) => <button key={l} onClick={() => setLang(l)} className={`px-2.5 py-1 text-[10px] font-bold ${lang === l ? "bg-violet-600 text-white" : "bg-[var(--bg)] text-[var(--muted)]"}`}>{l === "ar" ? "عربي" : "English"}</button>)}
                      </div>
                    )}
                  </div>
                  {showScript && (
                    <div dir={lang === "ar" ? "rtl" : "ltr"} className="px-4 pb-4 text-[13px] leading-7 text-[var(--text)] whitespace-pre-wrap max-h-[340px] overflow-y-auto">
                      {fillScript(lang === "ar" ? camp?.script_ar : camp?.script_en, c?.customer_name, agentForScript) || <span className="text-[var(--muted)]">No script yet — a team leader can add it under Script &amp; settings.</span>}
                    </div>
                  )}
                </div>

                {/* log a call */}
                <div className="rounded-2xl border border-[var(--border)] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-extrabold text-[var(--heading)]">Record a call</p>
                    <div className="flex rounded-lg overflow-hidden border border-[var(--border)]">
                      <button onClick={() => setDirection("outbound")} className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold ${direction === "outbound" ? "bg-violet-600 text-white" : "bg-[var(--bg)] text-[var(--muted)]"}`}><PhoneOutgoing className="w-3 h-3" /> We called</button>
                      <button onClick={() => setDirection("inbound")} className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold ${direction === "inbound" ? "bg-violet-600 text-white" : "bg-[var(--bg)] text-[var(--muted)]"}`}><PhoneIncoming className="w-3 h-3" /> Customer called us</button>
                    </div>
                  </div>
                  <div className="flex items-end gap-2">
                    <label className="text-[10px] font-bold text-[var(--muted)] space-y-1 block flex-1">Customer name
                      <input value={name} onChange={(e) => setName(e.target.value)} dir="auto" placeholder="Ask the customer's name and type it here" className={inputCls + (nameChanged ? " ring-2 ring-amber-400" : "")} />
                    </label>
                    {detailsChanged && <button onClick={saveName} disabled={!!busy} className="px-3 py-2 rounded-xl text-[11px] font-bold bg-[var(--bg)] border border-violet-500/40 text-violet-400 disabled:opacity-50 whitespace-nowrap">{busy === "name" ? "Saving…" : nameChanged && genderChanged ? "Save name & gender" : genderChanged ? "Save gender" : "Save name"}</button>}
                  </div>
                  <label className="text-[10px] font-bold text-[var(--muted)] space-y-1 block">Gender
                    <select value={gender} onChange={(e) => setGender(e.target.value)} className={inputCls + (genderChanged ? " ring-2 ring-amber-400" : "") + " [&>option]:bg-[var(--surface)]"}>
                      <option value="">— not asked —</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                    </select>
                  </label>
                  {detailsChanged && <p className="text-[10px] text-amber-600 -mt-2">This is also saved when you press "Save the call".</p>}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="text-[10px] font-bold text-[var(--muted)] space-y-1 block">Result of the call
                      <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls + " font-bold [&>option]:bg-[var(--surface)]"}>
                        <option value="">{lists.loaded ? "— pick —" : "Loading…"}</option>
                        {lists.results.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    </label>
                    <label className="text-[10px] font-bold text-[var(--muted)] space-y-1 block">Why they stopped ordering (churn reason)
                      <select value={churn} onChange={(e) => setChurn(e.target.value)} className={inputCls + " [&>option]:bg-[var(--surface)]"}>
                        <option value="">— not asked / keep as is —</option>
                        {(lists.churn ?? camp?.churn_reasons ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </label>
                    {kind === "call_back" && (
                      <label className="text-[10px] font-bold text-[var(--muted)] space-y-1 block">Call back on
                        <input type="date" value={callBack} min={kwToday()} onChange={(e) => setCallBack(e.target.value)} className={inputCls} />
                      </label>
                    )}
                  </div>
                  <label className="text-[10px] font-bold text-[var(--muted)] space-y-1 block">Comment (what the customer said, complaint, …)
                    <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className={inputCls + " resize-y"} />
                  </label>
                  {(kind === "accepted" || kind === "ordered") && !c?.offer_started_at && (
                    <p className="text-[11px] text-emerald-500">Saving this starts the offer: valid {camp?.validity_days} days, until {fmtDay(new Date(Date.now() + (camp?.validity_days || 30) * 86400_000).toISOString())}.</p>
                  )}
                  <button onClick={saveCall} disabled={!!busy} className="px-4 py-2 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50">{busy === "call" ? "Saving…" : "Save the call"}</button>
                </div>

                {/* log an order */}
                <div className="rounded-2xl border border-[var(--border)] p-4 space-y-3">
                  <p className="text-xs font-extrabold text-[var(--heading)] flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-violet-400" /> Log an order with the offer</p>
                  {el && el.next && el.state !== "expired" ? (
                    <>
                      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-[var(--text)]">
                        This is the customer's <b>{stepLabel(el.next.step)} order</b> of the offer → <b className="text-emerald-500 text-sm">{el.next.discount}% off</b>
                        {el.expires ? <> · valid until <b>{el.expires}</b> ({el.daysLeft} day{el.daysLeft === 1 ? "" : "s"} left)</> : <> · the offer starts with this order ({camp?.validity_days} days)</>}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label className="text-[10px] font-bold text-[var(--muted)] space-y-1 block">Order number (optional — not the phone)
                          <input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} dir="ltr" className={inputCls + " font-mono"} placeholder="from the POS / app" />
                        </label>
                        <label className="text-[10px] font-bold text-[var(--muted)] space-y-1 block">Order date
                          <input type="date" value={orderDate} max={kwToday()} onChange={(e) => setOrderDate(e.target.value)} className={inputCls} />
                        </label>
                        <label className="text-[10px] font-bold text-[var(--muted)] space-y-1 block">Order value (KWD, optional)
                          <input type="number" min="0" step="0.001" value={orderValue} onChange={(e) => setOrderValue(e.target.value)} className={inputCls} />
                        </label>
                      </div>
                      <input value={orderNote} onChange={(e) => setOrderNote(e.target.value)} placeholder="Note (optional)" className={inputCls} />
                      <button onClick={saveOrder} disabled={!!busy} className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">{busy === "order" ? "Saving…" : `Log the order with ${el.next.discount}% off`}</button>
                    </>
                  ) : (
                    <div className="p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--muted)]">
                      {el?.state === "completed" ? `All ${el.total} discounts were already used — the offer is complete.` : el?.state === "expired" ? `The offer expired on ${el.expires}. No discount can be applied.` : "—"}
                    </div>
                  )}
                </div>
              </div>

              {/* right: offer, details, history */}
              <div className="lg:col-span-2 space-y-4">
                <div className="rounded-2xl border border-[var(--border)] p-4 space-y-2">
                  <p className="text-xs font-extrabold text-[var(--heading)]">The offer</p>
                  <div className="text-[11px] text-[var(--muted)]">
                    {el?.starts ? <>Started <b className="text-[var(--heading)]">{el.starts}</b> · ends <b className="text-[var(--heading)]">{el.expires}</b>{el.state === "active" && <> · <b className="text-emerald-500">{el.daysLeft} day{el.daysLeft === 1 ? "" : "s"} left</b></>}</> : "Not started yet — it starts on the day the customer accepts the offer (or with their first order if they call us first)."}
                  </div>
                  <div className="space-y-1.5 pt-1">
                    {(camp?.steps || []).map((d, i) => {
                      const o = data.orders.find((x) => x.step === i + 1);
                      const isLast = o && o.step === Math.max(...data.orders.map((x) => x.step));
                      return (
                        <div key={i} className={`flex items-center justify-between gap-2 p-2 rounded-xl border text-[11px] ${o ? "border-emerald-500/30 bg-emerald-500/5" : el?.next?.step === i + 1 ? "border-violet-500/40 bg-violet-500/5" : "border-[var(--border)]"}`}>
                          <span className="font-bold text-[var(--heading)]">{stepLabel(i + 1)} order · {d}%</span>
                          {o ? (
                            <span className="flex items-center gap-1.5 text-[var(--text)]">{o.order_number ? `#${o.order_number} · ` : ""}{fmtDay(o.order_date)}{o.order_value ? ` · ${money(o.order_value)}` : ""}<span className="text-[var(--muted)]"> · {o.logged_by_name}</span>
                              {canManage && isLast && <button onClick={() => removeOrder(o)} title="Remove this order" className="p-1 rounded text-[var(--muted)] hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>}
                            </span>
                          ) : <span className="text-[var(--muted)]">{el?.next?.step === i + 1 ? "next" : "—"}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] p-4">
                  <p className="text-xs font-extrabold text-[var(--heading)] mb-2">Customer</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                    <dt className="text-[var(--muted)]">Uploaded</dt><dd>{fmtDay(c!.uploaded_at)}{c!.uploaded_by_name ? ` by ${c!.uploaded_by_name}` : ""}</dd>
                    <dt className="text-[var(--muted)]">Gender</dt><dd>{c!.gender === "female" ? "Female" : c!.gender === "male" ? "Male" : "—"}</dd>
                    <dt className="text-[var(--muted)]">Agent</dt><dd>{c!.agent_name || "—"}</dd>
                    {(() => { const hs = handlersFrom(data.events); return hs.length > 0 && <><dt className="text-[var(--muted)]">Worked on by</dt><dd><WorkedBy hs={hs} owner={c!.assigned_agent_id} /></dd></>; })()}
                    <dt className="text-[var(--muted)]">Contact date</dt><dd>{fmtDay(c!.contact_date) || "—"}</dd>
                    <dt className="text-[var(--muted)]">1st call</dt><dd>{c!.first_call_at ? `${fmtDT(c!.first_call_at)}${c!.first_call_agent_name ? ` · ${c!.first_call_agent_name}` : ""}` : "—"}</dd>
                    <dt className="text-[var(--muted)]">Attempts</dt><dd>{c!.attempts}</dd>
                    <dt className="text-[var(--muted)]">Churn reason</dt><dd>{c!.churn_reason || "—"}</dd>
                    <dt className="text-[var(--muted)]">Comment</dt><dd className="whitespace-pre-wrap">{c!.comment || "—"}</dd>
                    {Object.entries(c!.extra || {}).map(([k, v]) => <Fragment key={k}><dt className="text-[var(--muted)]">{k}</dt><dd>{fmtExtra(k, v)}</dd></Fragment>)}
                  </dl>
                </div>

                <div className="rounded-2xl border border-[var(--border)] p-4">
                  <p className="text-xs font-extrabold text-[var(--heading)] flex items-center gap-2 mb-2"><History className="w-4 h-4 text-violet-400" /> History</p>
                  <ol className="space-y-2 max-h-[360px] overflow-y-auto">
                    {[...data.events].reverse().map((e) => <Fragment key={e.id}><EventRow e={e} /></Fragment>)}
                  </ol>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Everyone who recorded a call or an order on the customer, and what they did. A colleague (not the customer's agent) is marked. */
export function WorkedBy({ hs, owner }: { hs: Handler[]; owner: string | null }) {
  return (
    <ul className="space-y-1">
      {hs.map((h) => {
        const colleague = !!owner && h.user_id !== owner;
        return (
          <li key={h.user_id || h.name} className="text-[11px] leading-snug">
            <span className={`font-bold ${colleague ? "text-amber-600" : "text-[var(--heading)]"}`}>{h.name}</span>
            {colleague && <span className="ml-1 px-1.5 py-px rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 text-[9px] font-bold">colleague</span>}
            <span className="text-[var(--text)]">: {h.actions.join(", ")}</span>
            <span className="text-[var(--muted)] whitespace-nowrap"> ({fmtDT(h.last_at).slice(5)})</span>
          </li>
        );
      })}
    </ul>
  );
}

function EventRow({ e }: { e: OfferEvent }) {
  const d = e.details || {};
  const st = (s: string | null) => (s ? CALL_STATUS[s]?.label || s : "—");
  let text: string;
  if (e.kind === "upload") text = "Uploaded to the campaign";
  else if (e.kind === "assign") text = d.from !== undefined ? `Moved from ${d.from || "nobody"} to ${d.to || "nobody"}` : `Assigned to ${d.to}${d.from_file ? " (from the file)" : ""}`;
  else if (e.kind === "call") text = `${e.direction === "inbound" ? "Customer called us" : "Called the customer"}: ${d.prev_result || st(e.prev_status)} → ${d.result || st(e.call_status)}${d.call_back_date ? ` (call back ${d.call_back_date})` : ""}${d.offer_started ? ` · offer started, ends ${d.expires}` : ""}${d.stays_ordered ? " (the customer stays Ordered)" : ""}`;
  else if (e.kind === "order") text = `Order ${d.order_number ? `#${d.order_number} ` : ""}on ${d.order_date} — ${d.discount}% off (${stepLabel(d.step)} order)${d.order_value !== null && d.order_value !== undefined ? ` · ${money(d.order_value)}` : ""}${d.offer_started ? " · offer started" : ""}`;
  else if (e.kind === "order_removed") text = `Removed the ${stepLabel(d.step)} order${d.order_number ? ` #${d.order_number}` : ""} (${d.discount}%, logged by ${d.logged_by || "?"})${d.reverted_to ? `, customer back to ${st(d.reverted_to)}` : ""}${d.offer_cleared ? ", offer taken back" : ""}`;
  else if (e.kind === "gender") text = d.from ? `Gender changed: ${d.from} → ${d.to}` : `Gender set: ${d.to}`;
  else if (e.kind === "name") text = d.from ? `Name changed: ${d.from} → ${d.to}` : `Name added: ${d.to}`;
  else if (e.kind === "edit") {
    const show = (x: any) => (x === null || x === undefined || x === "" ? "empty" : CALL_STATUS[x]?.label || String(x));
    text = `Edited: ${(d.changes || []).map((x: any) => `${x.field} ${show(x.from)} → ${show(x.to)}`).join("; ")}`;
  }
  else text = e.kind;
  return (
    <li className="text-[11px] border-l-2 border-[var(--border)] pl-3">
      <div className="text-[var(--heading)] font-bold">{text}</div>
      {e.churn_reason && <div className="text-[var(--text)]">Reason: {e.churn_reason}</div>}
      {e.comment && <div className="text-[var(--text)] whitespace-pre-wrap">“{e.comment}”</div>}
      <div className="text-[10px] text-[var(--muted)]">{fmtDT(e.created_at)}{e.user_name ? ` · ${e.user_name}` : ""}</div>
    </li>
  );
}
