import React, { useState, useEffect } from "react";
import { Brand, Branch, User, CallReason as CallReasonType, CALL_REASONS, Team, TEAMS, PriorityLevel, InteractionStatus, InteractionType } from "../types.js";
import { Phone, PhoneIncoming, PhoneOutgoing, AlertCircle, Check, Loader2, Send, ShoppingCart, RefreshCw, MessageSquareWarning, HelpCircle, Building2, MapPin } from "lucide-react";
import { apiFetch } from "../lib/api.ts";

interface CallReasonProps {
  currentUser: User;
  onSuccess: () => void;
}

// Each call reason maps to the underlying interaction_type stored on the ticket
const REASON_TO_TYPE: Record<CallReasonType, InteractionType> = {
  "New Order": "SR",
  "Follow Up": "Follow Up",
  "Complaint": "Complaint",
  "Inquiry": "Inquiry",
};

const REASON_META: Record<CallReasonType, { icon: any; hint: string }> = {
  "New Order": { icon: ShoppingCart, hint: "Customer wants to place a new order." },
  "Follow Up": { icon: RefreshCw, hint: "Following up on an existing order or ticket." },
  "Complaint": { icon: MessageSquareWarning, hint: "Customer is reporting a problem — branch required." },
  "Inquiry": { icon: HelpCircle, hint: "General question or information request." },
};

export default function CallReason({ currentUser, onSuccess }: CallReasonProps) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  // Step 1: reason
  const [callReason, setCallReason] = useState<CallReasonType | "">("");
  // Step 2: customer
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  // Step 3: brand
  const [brand, setBrand] = useState("");
  // Step 4 (complaint only): branch
  const [branch, setBranch] = useState("");
  // Details
  const [callDirection, setCallDirection] = useState<"Inbound" | "Outbound">("Inbound");
  const [priority, setPriority] = useState<PriorityLevel>("Medium");
  const [status, setStatus] = useState<InteractionStatus>("Open");
  const [summary, setSummary] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [team, setTeam] = useState<Team>(currentUser.team || "Call Center");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [rb, rbr] = await Promise.all([apiFetch("/api/brands"), apiFetch("/api/branches")]);
        if (rb.ok) {
          const b = await rb.json();
          setBrands(b);
          if (b.length) setBrand(b[0].brand_name);
        }
        if (rbr.ok) {
          const br = await rbr.json();
          setBranches(br);
          if (br.length) setBranch(br[0].branch_name);
        }
      } catch (e) {
        console.error("Failed to load form options", e);
      }
    };
    load();
  }, []);

  const isComplaint = callReason === "Complaint";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!callReason) return setError("Please select the call reason first.");
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
        category: isComplaint ? "Complaint" : "Other",
        call_reason: callReason,
        branch: isComplaint ? branch : undefined,
        team,
        priority,
        status,
        summary,
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

  return (
    <div className="max-w-3xl mx-auto animate-fade-in text-[#e4e4e7]">
      <form onSubmit={handleSubmit} className="bg-[#121214] border border-[#27272a] rounded-3xl p-6 md:p-8 shadow-xl space-y-8 relative overflow-hidden">
        {success && (
          <div className="absolute inset-0 bg-[#121214]/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-emerald-900/30 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center mb-4">
              <Check className="w-8 h-8 stroke-[3]" />
            </div>
            <h3 className="text-xl font-extrabold text-white">Call Logged Successfully!</h3>
            <p className="text-[#71717a] text-sm mt-1">Saving the interaction...</p>
          </div>
        )}

        <div>
          <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
            <Phone className="w-5 h-5 text-blue-400" />
            Log a Call — Call Reason
          </h2>
          <p className="text-xs text-[#71717a] mt-1 font-light">Pick the call reason first; the form adapts to the reason you choose.</p>
        </div>

        {error && (
          <div className="flex bg-rose-500/10 border border-rose-500/20 text-rose-300 p-4 rounded-2xl text-xs gap-2 items-center">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="font-bold">{error}</p>
          </div>
        )}

        {/* STEP 1: Call Reason */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider">1. Call Reason</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {CALL_REASONS.map((r) => {
              const Icon = REASON_META[r].icon;
              const active = callReason === r;
              return (
                <button
                  type="button"
                  key={r}
                  onClick={() => setCallReason(r)}
                  className={`p-4 rounded-2xl border text-xs font-bold transition flex flex-col items-center gap-2 text-center ${
                    active
                      ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-950/40"
                      : "bg-[#0a0a0b] text-[#71717a] border-[#27272a] hover:text-white hover:border-blue-500/30"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {r}
                </button>
              );
            })}
          </div>
          {callReason && <p className="text-[11px] text-blue-400 font-medium">{REASON_META[callReason].hint}</p>}
        </div>

        {/* The rest unlocks once a reason is picked */}
        {callReason && (
          <>
            {/* STEP 2: Customer */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider">2. Customer</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-300">Customer Phone Number:</label>
                  <input
                    type="text"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+2010xxxxxxxx"
                    dir="ltr"
                    className="w-full px-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs font-mono text-left focus:ring-2 focus:ring-blue-500 focus:outline-none transition"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-300">Customer Name (optional):</label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="e.g. Ahmed Mohamed"
                    className="w-full px-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition"
                  />
                </div>
              </div>
            </div>

            {/* STEP 3: Brand */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider">3. Brand</h3>
              <div className="relative">
                <Building2 className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                <select
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none transition [&>option]:bg-[#121214]"
                >
                  {brands.map((b) => (
                    <option key={b.id} value={b.brand_name}>{b.brand_name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* STEP 4: Branch (complaint only) */}
            {isComplaint && (
              <div className="space-y-3 animate-fade-in">
                <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> 4. Branch (required for complaints)
                </h3>
                <select
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="w-full px-4 py-3 bg-[#0a0a0b] text-white border border-amber-500/30 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-amber-500 focus:outline-none transition [&>option]:bg-[#121214]"
                >
                  {branches.length === 0 && <option value="">No branches configured — add them in Settings</option>}
                  {branches.map((b) => (
                    <option key={b.id} value={b.branch_name}>{b.branch_name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* STEP 5: Details */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider">{isComplaint ? "5" : "4"}. Details</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-300 block">Call Direction:</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setCallDirection("Inbound")} className={`py-3 rounded-2xl text-xs font-bold border transition flex items-center justify-center gap-1.5 ${callDirection === "Inbound" ? "bg-blue-600 text-white border-blue-600" : "bg-[#0a0a0b] text-[#71717a] border-[#27272a] hover:text-white"}`}>
                      <PhoneIncoming className="w-3.5 h-3.5" /> Inbound
                    </button>
                    <button type="button" onClick={() => setCallDirection("Outbound")} className={`py-3 rounded-2xl text-xs font-bold border transition flex items-center justify-center gap-1.5 ${callDirection === "Outbound" ? "bg-blue-600 text-white border-blue-600" : "bg-[#0a0a0b] text-[#71717a] border-[#27272a] hover:text-white"}`}>
                      <PhoneOutgoing className="w-3.5 h-3.5" /> Outbound
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-300 block">Handling Team:</label>
                  <select value={team} onChange={(e) => setTeam(e.target.value as Team)} className="w-full px-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none transition [&>option]:bg-[#121214]">
                    {TEAMS.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-300 block">Priority:</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value as PriorityLevel)} className="w-full px-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none transition [&>option]:bg-[#121214]">
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-300 block">Status:</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value as InteractionStatus)} className="w-full px-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none transition [&>option]:bg-[#121214]">
                    <option value="Open">Open</option>
                    <option value="Pending">Pending</option>
                    <option value="Resolved">Resolved</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-300">Summary:</label>
                <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="Describe the call..." className="w-full p-4 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition leading-relaxed" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-300">Action Taken:</label>
                <textarea value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} rows={2} placeholder="What was done..." className="w-full p-4 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition leading-relaxed" />
              </div>
            </div>

            <button type="submit" disabled={loading} className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 text-white font-extrabold rounded-2xl shadow-lg shadow-blue-600/10 transition flex items-center justify-center gap-2 text-sm">
              {loading ? (<><Loader2 className="w-4 h-4 animate-spin" /> Logging call...</>) : (<><Send className="w-4 h-4" /> Log Call</>)}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
