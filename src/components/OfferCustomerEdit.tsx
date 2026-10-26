import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { OfferCampaign, CALL_STATUS, fmtDay, kwToday, statusText, stepLabel, useOfferLists, type CallResultOption } from "../lib/offers.ts";
import { X, AlertCircle, CheckCircle2, Pencil, Trash2 } from "lucide-react";

// Edit one customer of an offer campaign (admins, supervisors and the managers above them). Every change is kept in
// the customer's history with its value before and after, and in the audit log.

const inputCls = "w-full px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-violet-500 focus:outline-none";
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
// A labelled field (defined outside the form so the inputs keep their focus while typing).
const L = ({ label, children, wide }: { label: string; children: any; wide?: boolean }) => (
  <label className={`text-[10px] font-bold text-[var(--muted)] space-y-1 block ${wide ? "sm:col-span-2" : ""}`}>{label}{children}</label>
);

export default function OfferCustomerEdit({ row: initial, camp, agents, onClose, onSaved, onChanged }: {
  row: any; camp: OfferCampaign; agents: { id: string; full_name: string }[]; onClose: () => void; onSaved: () => void; onChanged?: () => void;
}) {
  const lists = useOfferLists();
  const [row, setRow] = useState<any>(initial);          // follows the customer after an order is removed here
  const [msg, setMsg] = useState("");
  const [v, setV] = useState({
    name: row.customer_name || "", phone: row.phone || "", agent: row.assigned_agent_id || "", contact: fmtDay(row.contact_date) || "",
    churn: row.churn_reason || "", comment: row.comment || "", start: row.eligibility?.starts || "", end: row.eligibility?.expires || "", note: "",
  });
  const set = (k: keyof typeof v, val: string) => setV((p) => ({ ...p, [k]: val }));
  const [statusId, setStatusId] = useState("current");
  const [statusTouched, setStatusTouched] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const hasOrders = (row.orders || []).length > 0;

  // The status list: "not called yet" plus the call results from Configuration; the customer's current status is
  // picked, and shown as its own entry if it is no longer in the list.
  const statusOptions = useMemo<CallResultOption[]>(() => [{ id: "builtin:not_called", label: CALL_STATUS.not_called.label, kind: "not_called", builtin: true }, ...lists.results], [lists.results]);
  const currentMatch = statusOptions.find((o) => o.label === row.call_result) || (!row.call_result ? statusOptions.find((o) => o.kind === row.call_status) : undefined);
  useEffect(() => { if (!statusTouched && lists.loaded) setStatusId(currentMatch?.id || "current"); }, [lists.loaded, currentMatch?.id, statusTouched]);
  const picked = statusOptions.find((o) => o.id === statusId);

  const pickStatus = (id: string) => {
    setStatusTouched(true); setStatusId(id);
    const kind = statusOptions.find((o) => o.id === id)?.kind;
    // Accepting the offer without one running yet: start it today, like a call would.
    if ((kind === "accepted" || kind === "ordered") && !v.start) setV((p) => ({ ...p, start: kwToday(), end: addDays(kwToday(), camp.validity_days) }));
  };
  const churnOptions = [...new Set([...(lists.churn ?? camp.churn_reasons ?? []), ...(row.churn_reason ? [row.churn_reason] : [])])];
  const agentOptions = row.assigned_agent_id && !agents.some((a) => a.id === row.assigned_agent_id) ? [{ id: row.assigned_agent_id, full_name: row.agent_name || "Current agent" }, ...agents] : agents;

  // Only the latest order can be taken back (the discounts stay in order); taking back the only one puts the customer
  // where they were before it, so the status can be changed again.
  const removeOrder = async (o: any) => {
    const reason = window.prompt(`Remove the ${stepLabel(o.step)} order${o.order_number ? ` ${o.order_number}` : ""} (${o.discount}% off)?\nWrite why (kept in the history):`);
    if (reason === null) return;
    if (!reason.trim()) { setError("Write why the order is being removed."); return; }
    setError(""); setMsg(""); setBusy(true);
    try {
      const res = await apiFetch(`/api/offer-campaigns/orders/${o.id}/remove`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not remove the order.");
      setRow((p: any) => ({ ...p, ...d.customer, orders: d.orders, eligibility: d.eligibility }));
      setV((p) => ({ ...p, start: d.eligibility?.starts || "", end: d.eligibility?.expires || "" }));
      setStatusTouched(false);
      setMsg(d.orders.length ? "Order removed." : `Order removed. The customer is back to "${statusText(d.customer)}"${d.eligibility?.starts ? "" : " and has no offer running"}.`);
      onChanged?.();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const save = async () => {
    setError(""); setBusy(true);
    try {
      const status = statusTouched && picked ? (picked.builtin ? { status_changed: true, call_status: picked.kind } : { status_changed: true, result_id: picked.id }) : {};
      const res = await apiFetch(`/api/offer-campaigns/customers/${row.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_name: v.name, phone: v.phone, agent_id: v.agent || null, contact_date: v.contact || null, churn_reason: v.churn, comment: v.comment,
          offer_start: v.start || null, offer_end: v.end || null, note: v.note, ...status }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not save.");
      onSaved();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-y-auto p-3 sm:p-6" onClick={onClose}>
      <div className="max-w-2xl mx-auto bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)] bg-[var(--bg)]">
          <div>
            <div className="text-[10px] font-bold text-violet-500 flex items-center gap-1"><Pencil className="w-3 h-3" /> Edit customer</div>
            <h3 className="text-lg font-extrabold text-[var(--heading)]">{row.customer_name || "Customer"} <span className="font-mono text-sm" dir="ltr">{row.phone}</span></h3>
            <p className="text-[11px] text-[var(--muted)]">Now: {statusText(row)}{row.agent_name ? `, with ${row.agent_name}` : ""}. Every change is kept in the history.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface-2)]"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}
          {msg && <div className="p-3 rounded-xl text-xs border bg-emerald-500/10 border-emerald-500/25 text-emerald-600 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" /> {msg}</div>}
          {hasOrders && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
              <p className="text-[11px] font-bold text-[var(--heading)]">Offer orders</p>
              {row.orders.map((o: any, i: number) => (
                <div key={o.id || o.step} className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text)]">
                  <span><b className="text-[var(--heading)]">{o.discount}% off</b>, {stepLabel(o.step)} order on {fmtDay(o.order_date)}{o.order_number ? `, #${o.order_number}` : ""}{o.logged_by_name ? `, logged by ${o.logged_by_name}` : ""}</span>
                  {i === row.orders.length - 1 && o.id && (
                    <button onClick={() => removeOrder(o)} disabled={busy} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-rose-500/40 text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"><Trash2 className="w-3 h-3" /> Remove</button>
                  )}
                </div>
              ))}
              <p className="text-[10px] text-[var(--muted)]">While the customer has an order the status stays Ordered. Only the latest order can be removed; removing the only one puts the customer back where they were before it.</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <L label="Customer name"><input value={v.name} onChange={(e) => set("name", e.target.value)} dir="auto" className={inputCls} /></L>
            <L label="Phone"><input value={v.phone} onChange={(e) => set("phone", e.target.value)} dir="ltr" className={inputCls + " font-mono"} /></L>
            <L label="Status">
              <select value={statusId} onChange={(e) => pickStatus(e.target.value)} disabled={!lists.loaded || hasOrders} className={inputCls + " font-bold disabled:opacity-60 [&>option]:bg-[var(--surface)]"}>
                {!currentMatch && <option value="current">{statusText(row)} (current)</option>}
                {statusOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              {hasOrders && <span className="block font-normal text-[10px] text-amber-600">Remove the order above to change the status.</span>}
            </L>
            <L label="Agent">
              <select value={v.agent} onChange={(e) => set("agent", e.target.value)} className={inputCls + " [&>option]:bg-[var(--surface)]"}>
                <option value="">— none —</option>
                {agentOptions.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            </L>
            <L label="Contact date (when to call)"><input type="date" value={v.contact} onChange={(e) => set("contact", e.target.value)} className={inputCls} /></L>
            <L label="Churn reason">
              <select value={v.churn} onChange={(e) => set("churn", e.target.value)} className={inputCls + " [&>option]:bg-[var(--surface)]"}>
                <option value="">— none —</option>
                {churnOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </L>
            <L label="Offer starts"><input type="date" value={v.start} max={v.end || undefined} onChange={(e) => setV((p) => ({ ...p, start: e.target.value, end: e.target.value ? addDays(e.target.value, camp.validity_days) : "" }))} className={inputCls} /></L>
            <L label="Offer ends"><input type="date" value={v.end} min={v.start || undefined} onChange={(e) => set("end", e.target.value)} className={inputCls} /></L>
            {(v.start || v.end) && !hasOrders && <p className="sm:col-span-2 -mt-1 text-[10px] text-[var(--muted)]">Clear both offer dates to take the offer back. Picking a start fills the end with {camp.validity_days} days.</p>}
            <L label="Comment" wide><textarea value={v.comment} onChange={(e) => set("comment", e.target.value)} rows={2} className={inputCls + " resize-y"} /></L>
            <L label="Why are you changing this? (kept in the history)" wide><input value={v.note} onChange={(e) => set("note", e.target.value)} className={inputCls} /></L>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-[var(--muted)] hover:text-[var(--heading)]">Cancel</button>
            <button onClick={save} disabled={busy} className="px-5 py-2 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50">{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
