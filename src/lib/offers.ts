// Shared definitions for the offer campaign pages (see server/offers.ts for the rules).

export interface OfferCampaign {
  id: string; name: string; brand_id: string | null; brand_name: string | null; steps: number[]; validity_days: number;
  script_ar: string | null; script_en: string | null; churn_reasons: string[] | null; status: string; created_at: string;
}
export interface Eligibility {
  state: "not_started" | "active" | "expired" | "completed";
  next: { step: number; discount: number } | null; used: number; total: number;
  starts: string | null; expires: string | null; daysLeft: number | null;
}
export interface OfferOrder { id: string; step: number; discount: number; order_number: string; order_date: string; order_value: string | null; logged_by_name: string | null; logged_at: string }
export interface OfferEvent {
  id: string; kind: string; direction: string | null; call_status: string | null; prev_status: string | null; churn_reason: string | null;
  comment: string | null; details: any; user_name: string | null; created_at: string;
}
export interface OfferCustomer {
  id: string; campaign_id: string; phone: string; customer_name: string | null; extra: Record<string, string> | null;
  uploaded_at: string; uploaded_by_name: string | null; assigned_agent_id: string | null; agent_name?: string | null;
  contact_date: string | null; call_status: string; attempts: number; first_call_at: string | null; first_call_agent_name?: string | null;
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

export const stepLabel = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
