// Shared definitions for the offer campaign pages (see server/offers.ts for the rules).
import { useEffect, useState } from "react";
import { apiFetch } from "./api.ts";

export interface OfferCampaign {
  id: string; name: string; brand_id: string | null; brand_name: string | null; steps: number[]; validity_days: number;
  script_ar: string | null; script_en: string | null; churn_reasons: string[] | null; status: string; created_at: string;
}
export interface Eligibility {
  state: "not_started" | "active" | "expired" | "completed";
  next: { step: number; discount: number } | null; used: number; total: number;
  starts: string | null; expires: string | null; daysLeft: number | null;
}
export interface OfferOrder { id: string; step: number; discount: number; order_number: string | null; order_date: string; order_value: string | null; logged_by_name: string | null; logged_at: string }
export interface OfferEvent {
  id: string; kind: string; direction: string | null; call_status: string | null; prev_status: string | null; churn_reason: string | null;
  comment: string | null; details: any; user_name: string | null; created_at: string;
}
export interface OfferCustomer {
  id: string; campaign_id: string; phone: string; customer_name: string | null; extra: Record<string, string> | null;
  uploaded_at: string; uploaded_by_name: string | null; assigned_agent_id: string | null; agent_name?: string | null;
  contact_date: string | null; call_status: string; call_result?: string | null; attempts: number; first_call_at: string | null; first_call_agent_name?: string | null;
  last_call_at: string | null; churn_reason: string | null; comment: string | null; offer_started_at: string | null; offer_expires_at: string | null;
}

export const CALL_STATUS: Record<string, { label: string; cls: string; open?: boolean; reached?: boolean }> = {
  not_called: { label: "Not called yet", cls: "bg-zinc-500/10 text-zinc-500 border-zinc-500/25", open: true },
  no_answer: { label: "No answer", cls: "bg-rose-500/10 text-rose-500 border-rose-500/25", open: true },
  busy: { label: "Busy / switched off", cls: "bg-rose-500/10 text-rose-500 border-rose-500/25", open: true },
  call_back: { label: "Call back later", cls: "bg-sky-500/10 text-sky-500 border-sky-500/25", open: true, reached: true },
  wrong_number: { label: "Wrong number", cls: "bg-zinc-500/10 text-zinc-500 border-zinc-500/25" },
  not_interested: { label: "Not interested", cls: "bg-orange-500/10 text-orange-500 border-orange-500/25", reached: true },
  accepted: { label: "Accepted the offer", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/25", reached: true },
  ordered: { label: "Ordered", cls: "bg-violet-500/10 text-violet-500 border-violet-500/25", reached: true },
};
/** What an agent can record as the result of a call (everything except "not called yet"). */
export const RESULT_STATUSES = Object.keys(CALL_STATUS).filter((k) => k !== "not_called");

/** The status shown for a customer: the result the agent picked, else the built-in status's name. */
export const statusText = (r: { call_status: string; call_result?: string | null }) => r.call_result || CALL_STATUS[r.call_status]?.label || r.call_status;

/** What a call result can work like — shown when an admin adds one in Configuration. */
export const RESULT_KIND_HELP: Record<string, string> = {
  no_answer: "No answer — call again later",
  busy: "Busy / switched off — call again later",
  call_back: "Call back later — asks for a date",
  wrong_number: "Wrong number — closed",
  not_interested: "Not interested — closed (reached)",
  accepted: "Accepted the offer — starts the offer days",
  ordered: "Ordered — starts the offer days",
};

export interface CallResultOption { id: string; label: string; kind: string; builtin?: boolean }

/** The two lists on the agent's call form, edited on the Configuration page. If the call results can't be loaded
 *  (or the list is empty) the built-in ones are used; churn reasons then fall back to the campaign's old list. */
export function useOfferLists() {
  const [results, setResults] = useState<CallResultOption[] | null>(null);
  const [churn, setChurn] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    const get = (key: string) => apiFetch(`/api/options/${key}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([get("offer_call_result"), get("offer_churn_reason")]).then(([r, c]) => {
      if (!live) return;
      const usable = (Array.isArray(r) ? r : []).filter((o: any) => RESULT_STATUSES.includes(o.kind));
      setResults(usable.length ? usable.map((o: any) => ({ id: o.id, label: o.label, kind: o.kind }))
        : RESULT_STATUSES.map((k) => ({ id: `builtin:${k}`, label: CALL_STATUS[k].label, kind: k, builtin: true })));
      setChurn(Array.isArray(c) ? c.map((o: any) => o.label) : null);
    });
    return () => { live = false; };
  }, []);
  return { results: results || [], churn, loaded: results !== null };
}

export const OFFER_STATE: Record<Eligibility["state"], { label: string; cls: string }> = {
  not_started: { label: "Offer not given yet", cls: "bg-zinc-500/10 text-zinc-500 border-zinc-500/25" },
  active: { label: "Offer active", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/25" },
  expired: { label: "Offer expired", cls: "bg-rose-500/10 text-rose-500 border-rose-500/25" },
  completed: { label: "All discounts used", cls: "bg-violet-500/10 text-violet-500 border-violet-500/25" },
};

export const MANAGER_ROLES = ["admin", "owner", "manager", "supervisor", "leader"];

const KW_MS = 3 * 3600_000;
export const kwToday = () => new Date(Date.now() + KW_MS).toISOString().slice(0, 10);
export const fmtDT = (ts?: string | null) => (ts ? new Date(new Date(ts).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16) : "");
export const fmtDay = (ts?: string | null) => (ts ? (/^\d{4}-\d{2}-\d{2}$/.test(ts) ? ts : new Date(new Date(ts).getTime() + KW_MS).toISOString().slice(0, 10)) : "");

/** The campaign script with the customer's and the agent's names filled in. */
export const fillScript = (text: string | null | undefined, customer: string | null | undefined, agent: string | null | undefined) =>
  String(text || "")
    .split("[اسم العميل]").join(customer || "[اسم العميل]")
    .split("[Customer Name]").join(customer || "[Customer Name]")
    .split("[اسم الموظف]").join(agent || "[اسم الموظف]")
    .split("[Agent Name]").join(agent || "[Agent Name]");

/** Uploaded extra columns: an Excel date that arrived as a day number (e.g. 46119) is shown as YYYY-MM-DD. */
export const fmtExtra = (key: string, v: any): string => {
  const s = String(v ?? "");
  if (/date/i.test(key) && /^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s));
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400_000).toISOString().slice(0, 10);
  }
  return s;
};

export const stepLabel = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
