import React, { useState, useEffect } from "react";
import {
  Brand, Branch, User, CallReason as CallReasonType, CALL_REASONS,
  Team, TEAMS, PriorityLevel, InteractionStatus, InteractionType,
  CustomerType, CUSTOMER_TYPES, CallFrom, CALL_FROM_OPTIONS, AGGREGATORS,
  ComplaintReason, COMPLAINT_REASONS, FCR, FCR_OPTIONS, Interaction,
} from "../types.js";
import {
  Phone, PhoneIncoming, PhoneOutgoing, AlertCircle, Check, Loader2, Send,
  ShoppingCart, RefreshCw, MessageSquareWarning, HelpCircle, PlusCircle,
  Building2, MapPin, Hash, History, Clock,
} from "lucide-react";
import { apiFetch } from "../lib/api.ts";

interface CallReasonProps {
  currentUser: User;
  onSuccess: () => void;
}

const REASON_TO_TYPE: Record<CallReasonType, InteractionType> = {
  "New Order": "SR",
  "Follow Up": "Follow Up",
  "Complaint": "Complaint",
  "Inquiry": "Inquiry",
  "Additional Request": "SR",
};

const REASON_META: Record<CallReasonType, { icon: any }> = {
  "New Order": { icon: ShoppingCart },
  "Follow Up": { icon: RefreshCw },
  "Complaint": { icon: MessageSquareWarning },
  "Inquiry": { icon: HelpCircle },
  "Additional Request": { icon: PlusCircle },
};

export default function CallReason({ currentUser, onSuccess }: CallReasonProps) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  // Call classification
  const [callReason, setCallReason] = useState<CallReasonType | "">("");
  // Basic information
  const [orderNumber, setOrderNumber] = useState("");
  const [brand, setBrand] = useState("");
  const [branch, setBranch] = useState("");
  // Caller information
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerType, setCustomerType] = useState<CustomerType>("Customer");
  const [callFrom, setCallFrom] = useState<CallFrom>("Customer");
  const [aggregatorName, setAggregatorName] = useState(AGGREGATORS[0]);
  const [callDirection, setCallDirection] = useState<"Inbound" | "Outbound">("Inbound");
  const [comments, setComments] = useState("");
  // Complaint details
  const [complaintReason, setComplaintReason] = useState<ComplaintReason>("Late Delivery");
  const [fcr, setFcr] = useState<FCR>("Solved");
  // Handling
  const [priority, setPriority] = useState<PriorityLevel>("Medium");
  const [status, setStatus] = useState<InteractionStatus>("Open");
  const [team, setTeam] = useState<Team>(currentUser.team || "Call Center");
  const [actionTaken, setActionTaken] = useState("");

  // Agent history
  const [history, setHistory] = useState<Interaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [rb, rbr] = await Promise.all([apiFetch("/api/brands"), apiFetch("/api/branches")]);
        if (rb.ok) { const b = await rb.json(); setBrands(b); if (b.length) setBrand(b[0].brand_name); }
        if (rbr.ok) { const br = await rbr.json(); setBranches(br); if (br.length) setBranch(br[0].branch_name); }
      } catch (e) { console.error(e); }
    };
    load();
  }, []);

  // Auto-fetch agent history when phone or order number is provided
  useEffect(() => {
    const phone = customerPhone.trim();
    const order = orderNumber.trim();
    if (phone.length < 5 && order.length < 2) { setHistory([]); return; }
    const t = setTimeout(async () => {
      try {
        setHistoryLoading(true);
        const qs = new URLSearchParams();
        if (phone) qs.set("phone", phone);
        if (order) qs.set("order", order);
        const res = await apiFetch(`/api/interactions/history?${qs.toString()}`);
        if (res.ok) setHistory(await res.json());
      } catch (e) { /* ignore */ } finally { setHistoryLoading(false); }
    }, 600);
    return () => clearTimeout(t);
  }, [customerPhone, orderNumber]);

  const isComplaint = callReason === "Complaint";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!callReason) return setError("Please select the call type first.");
    if (!customerPhone.trim()) return setError("Please enter the customer phone number.");
    if (!brand) return setError("Please select a brand.");
    if (isComplaint && !branch) return setError("Please select the branch for this complaint.");

    try {
      setLoading(true);
      const payload = {
        customer_name: customerName.trim() || "Walk-In / Guest Customer",
        customer_phone: customerPhone.trim(),
        interaction_type: REASON_TO_TYPE[callReason],
        communication_type: "Call",
        call_direction: callDirection,
        brand,
        branch,
        order_number: orderNumber.trim() || undefined,
        category: isComplaint ? "Complaint" : "Other",
        call_reason: callReason,
        customer_type: customerType,
        call_from: callFrom,
        aggregator_name: (customerType === "Aggregator" || callFrom === "Aggregator") ? aggregatorName : undefined,
        comments: comments || undefined,
        complaint_reason: isComplaint ? complaintReason : undefined,
        fcr: isComplaint ? fcr : undefined,
        team,
        priority,
        status,
        summary: comments,
        action_taken: actionTaken,
        follow_up_required: false,
      };

      const res = await apiFetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to log the call.");
      }
      setSuccess(true);
      setTimeout(() => onSuccess(), 1400);
    } catch (err: any) {
      setError(err.message || "Unexpected network error.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full px-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition";
  const selectCls = inputCls + " font-bold [&>option]:bg-[#121214]";
  const showAggregator = customerType === "Aggregator" || callFrom === "Aggregator";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fade-in text-[#e4e4e7]">
      {/* MAIN FORM */}
      <form onSubmit={handleSubmit} className="lg:col-span-8 bg-[#121214] border border-[#27272a] rounded-3xl p-6 md:p-8 shadow-xl space-y-8 relative overflow-hidden">
        {success && (
          <div className="absolute inset-0 bg-[#121214]/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-emerald-900/30 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center mb-4"><Check className="w-8 h-8 stroke-[3]" /></div>
            <h3 className="text-xl font-extrabold text-white">Call Logged Successfully!</h3>
          </div>
        )}

        <div>
          <h2 className="text-lg font-extrabold text-white flex items-center gap-2"><Phone className="w-5 h-5 text-blue-400" /> Log a Call</h2>
          <p className="text-xs text-[#71717a] mt-1 font-light">Date &amp; time are recorded automatically when you submit.</p>
        </div>

        {error && (
          <div className="flex bg-rose-500/10 border border-rose-500/20 text-rose-300 p-4 rounded-2xl text-xs gap-2 items-center">
            <AlertCircle className="w-5 h-5 shrink-0" /><p className="font-bold">{error}</p>
          </div>
        )}

        {/* CALL CLASSIFICATION */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider">Call Type</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
            {CALL_REASONS.map((r) => {
              const Icon = REASON_META[r].icon;
              const active = callReason === r;
              return (
                <button type="button" key={r} onClick={() => setCallReason(r)}
                  className={`p-3 rounded-2xl border text-[11px] font-bold transition flex flex-col items-center gap-1.5 text-center ${active ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-950/40" : "bg-[#0a0a0b] text-[#71717a] border-[#27272a] hover:text-white hover:border-blue-500/30"}`}>
                  <Icon className="w-5 h-5" />{r}
                </button>
              );
            })}
          </div>
        </div>

        {/* BASIC INFORMATION */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider">Basic Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Order Number:</label>
              <div className="relative">
                <Hash className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                <input type="text" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="e.g. 4432" dir="ltr" className={inputCls + " pl-10 font-mono"} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Brand:</label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                <select value={brand} onChange={(e) => setBrand(e.target.value)} className={selectCls + " pl-10"}>
                  {brands.map((b) => (<option key={b.id} value={b.brand_name}>{b.brand_name}</option>))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Branch:</label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                <select value={branch} onChange={(e) => setBranch(e.target.value)} className={selectCls + " pl-10"}>
                  {branches.length === 0 && <option value="">No branches — add in Settings</option>}
                  {branches.map((b) => (<option key={b.id} value={b.branch_name}>{b.branch_name}</option>))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Date &amp; Time:</label>
              <div className={inputCls + " flex items-center gap-2 text-blue-400 font-bold"}><Clock className="w-4 h-4" /> Automatic on submit</div>
            </div>
          </div>
        </div>

        {/* CALLER INFORMATION */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider">Caller Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Customer Phone:</label>
              <input type="text" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+2010xxxxxxxx" dir="ltr" className={inputCls + " font-mono text-left"} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Customer Name (optional):</label>
              <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Ahmed Mohamed" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Customer Type:</label>
              <select value={customerType} onChange={(e) => setCustomerType(e.target.value as CustomerType)} className={selectCls}>
                {CUSTOMER_TYPES.map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Call From:</label>
              <select value={callFrom} onChange={(e) => setCallFrom(e.target.value as CallFrom)} className={selectCls}>
                {CALL_FROM_OPTIONS.map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
            </div>
            {showAggregator && (
              <div className="space-y-1.5 animate-fade-in">
                <label className="text-xs font-bold text-zinc-300">Aggregator Name:</label>
                <select value={aggregatorName} onChange={(e) => setAggregatorName(e.target.value)} className={selectCls}>
                  {AGGREGATORS.map((a) => (<option key={a} value={a}>{a}</option>))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300 block">Call Direction:</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setCallDirection("Inbound")} className={`py-3 rounded-2xl text-xs font-bold border transition flex items-center justify-center gap-1.5 ${callDirection === "Inbound" ? "bg-blue-600 text-white border-blue-600" : "bg-[#0a0a0b] text-[#71717a] border-[#27272a] hover:text-white"}`}><PhoneIncoming className="w-3.5 h-3.5" /> Inbound</button>
                <button type="button" onClick={() => setCallDirection("Outbound")} className={`py-3 rounded-2xl text-xs font-bold border transition flex items-center justify-center gap-1.5 ${callDirection === "Outbound" ? "bg-blue-600 text-white border-blue-600" : "bg-[#0a0a0b] text-[#71717a] border-[#27272a] hover:text-white"}`}><PhoneOutgoing className="w-3.5 h-3.5" /> Outbound</button>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-300">Comments:</label>
            <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} placeholder="Call notes and remarks..." className={inputCls + " leading-relaxed"} />
          </div>
        </div>

        {/* COMPLAINT DETAILS */}
        {isComplaint && (
          <div className="space-y-4 p-5 bg-rose-950/10 border border-rose-500/20 rounded-2xl animate-fade-in">
            <h3 className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5"><MessageSquareWarning className="w-3.5 h-3.5" /> Complaint Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-300">Complaint Reason:</label>
                <select value={complaintReason} onChange={(e) => setComplaintReason(e.target.value as ComplaintReason)} className={selectCls}>
                  {COMPLAINT_REASONS.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-300">FCR (First Call Resolution):</label>
                <select value={fcr} onChange={(e) => setFcr(e.target.value as FCR)} className={selectCls}>
                  {FCR_OPTIONS.map((f) => (<option key={f} value={f}>{f}</option>))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* HANDLING */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider">Handling</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300 block">Team:</label>
              <select value={team} onChange={(e) => setTeam(e.target.value as Team)} className={selectCls}>{TEAMS.map((t) => (<option key={t} value={t}>{t}</option>))}</select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300 block">Priority:</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as PriorityLevel)} className={selectCls}>
                <option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option><option value="Critical">Critical</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300 block">Status:</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as InteractionStatus)} className={selectCls}>
                <option value="Open">Open</option><option value="Pending">Pending</option><option value="Resolved">Resolved</option><option value="Closed">Closed</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-300">Action Taken:</label>
            <textarea value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} rows={2} placeholder="What was done..." className={inputCls + " leading-relaxed"} />
          </div>
        </div>

        <button type="submit" disabled={loading} className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 text-white font-extrabold rounded-2xl shadow-lg shadow-blue-600/10 transition flex items-center justify-center gap-2 text-sm">
          {loading ? (<><Loader2 className="w-4 h-4 animate-spin" /> Logging call...</>) : (<><Send className="w-4 h-4" /> Log Call</>)}
        </button>
      </form>

      {/* AGENT HISTORY PANEL */}
      <div className="lg:col-span-4 bg-[#121214] border border-[#27272a] rounded-3xl p-6 shadow-xl space-y-4 lg:sticky lg:top-24">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-blue-400" />
          <h3 className="text-sm font-extrabold text-white">Agent History</h3>
        </div>
        <p className="text-[11px] text-[#71717a] font-light leading-relaxed">Previous interactions for this customer phone or order number appear here automatically.</p>

        {historyLoading && (
          <div className="flex items-center gap-2 text-xs text-[#71717a]"><Loader2 className="w-4 h-4 animate-spin" /> Searching history...</div>
        )}

        {!historyLoading && history.length === 0 && (
          <div className="text-center py-8 text-[#71717a] text-xs border border-dashed border-[#27272a] rounded-2xl">No previous records found.</div>
        )}

        <div className="space-y-2.5 max-h-[60vh] overflow-y-auto">
          {history.map((h) => (
            <div key={h.id} className="p-3 bg-[#0a0a0b] border border-[#27272a] rounded-2xl text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-blue-400">{h.call_reason || h.interaction_type}</span>
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${h.status === "Resolved" || h.status === "Closed" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>{h.status}</span>
              </div>
              <div className="text-[10px] text-zinc-400">{h.interaction_date} {h.interaction_time} · {h.brand}{h.branch ? " / " + h.branch : ""}</div>
              {h.order_number && <div className="text-[10px] text-zinc-500 font-mono">Order #{h.order_number}</div>}
              {h.complaint_reason && <div className="text-[10px] text-rose-400">{h.complaint_reason}{h.fcr ? " · FCR: " + h.fcr : ""}</div>}
              {h.comments && <div className="text-[10px] text-zinc-400 line-clamp-2">{h.comments}</div>}
              <div className="text-[9px] text-zinc-600">by {h.agent_name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
