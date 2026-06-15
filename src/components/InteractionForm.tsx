import React, { useState, useEffect } from "react";
import { Brand, Category, User, InteractionType, CommunicationType, CallDirection, PriorityLevel, InteractionStatus } from "../types.js";
import { Phone, UserIcon, ShieldAlert, CheckSquare, AlertCircle, FilePlus, Eye, Clock, Calendar, Check, Send, Trash, Loader2 } from "lucide-react";
import { apiFetch } from "../lib/api.ts";

interface InteractionFormProps {
  currentUser: User;
  onSuccess: () => void;
}

interface FileAttachmentInput {
  file_name: string;
  mime_type: string;
  file_data: string; // Base64
}

// Preset options for dropdown choices to eliminate text fields
const CUSTOMER_NAMES = [
  "VIP Corporate Client",
  "Retail Consumer Account",
  "Ahmed Mohamed (General)",
  "Sarah Hassan (Retail)",
  "Walk-In / Guest Customer",
  "Corporate Partnership Contact",
  "Anonymous Retail Inquirer"
];

const CUSTOMER_PHONES = [
  "+201002223344",
  "+201115556677",
  "+201228889900",
  "+966509998877",
  "Private Number / Undefined"
];

const INTERACTION_SUMMARIES = [
  "Customer reported standard delivery delay with cold/missing items.",
  "Client requested dynamic pricing inquiry / coupon clearance.",
  "Customer called expressing peak satisfaction with our fast response rate.",
  "Refund request processed due to a technical merchant failure.",
  "Escalation initiated for order dispute / payment deduction discrepancy.",
  "Routine check-in regarding brand partner active integration."
];

const ACTIONS_TAKEN = [
  "Refund authorized and added directly to the client wallet.",
  "Order tracking ticket raised and escalated to the regional team.",
  "Complaint successfully marked as resolved after consulting the merchant.",
  "Discount voucher provided to the customer as gesture of goodwill.",
  "Customer informed of current company timeline and terms of service."
];

const FOLLOW_UP_NOTES_LIST = [
  "Call client back to confirm final order resolution.",
  "Check refund transaction status with the accounting team.",
  "Verify with delivery driver if dispatch completed successfully.",
  "Ensure partner brand confirmed service SLA status.",
  "Perform courtesy feedback call to measure loyalty index."
];

const CUSTOM_BRANDS = [
  "Uber",
  "IKEA",
  "Hungerstation",
  "Jahez",
  "Mrsool",
  "Noon Food"
];

export default function InteractionForm({ currentUser, onSuccess }: InteractionFormProps) {
  // Database configurations fetched from backend
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // Form Fields State
  const [customerName, setCustomerName] = useState(CUSTOMER_NAMES[0]);
  const [customerPhone, setCustomerPhone] = useState(CUSTOMER_PHONES[0]);
  const [interactionType, setInteractionType] = useState<InteractionType>("SR");
  const [communicationType, setCommunicationType] = useState<CommunicationType>("Call");
  const [callDirection, setCallDirection] = useState<CallDirection>("Inbound");
  const [selectedBrand, setSelectedBrand] = useState("Talabat");
  const [customBrand, setCustomBrand] = useState(CUSTOM_BRANDS[0]);
  const [selectedCategory, setSelectedCategory] = useState("Order Issue");
  const [priority, setPriority] = useState<PriorityLevel>("Medium");
  const [status, setStatus] = useState<InteractionStatus>("Open");
  const [summary, setSummary] = useState(INTERACTION_SUMMARIES[0]);
  const [actionTaken, setActionTaken] = useState(ACTIONS_TAKEN[0]);
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState(FOLLOW_UP_NOTES_LIST[0]);
  const [attachments, setAttachments] = useState<FileAttachmentInput[]>([]);

  // General Form States
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState(false);

  // Load brands and categories upon initialization
  useEffect(() => {
    const loadFields = async () => {
      try {
        const [resBrands, resCat] = await Promise.all([
          apiFetch("/api/brands"),
          apiFetch("/api/categories")
        ]);
        if (resBrands.ok && resCat.ok) {
          const bData = await resBrands.json();
          const cData = await resCat.json();
          setBrands(bData);
          setCategories(cData);
          if (bData.length > 0) setSelectedBrand(bData[0].brand_name);
          if (cData.length > 0) setSelectedCategory(cData[0].category_name);
        }
      } catch (err) {
        console.error("Error prefetching backend parameters:", err);
      }
    };
    loadFields();
  }, []);

  // Drag and Drop files uploader setup
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file: File) => {
      // Validate support format
      const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "image/jpeg", "image/png"];
      if (!allowed.includes(file.type)) {
        alert("Unsupported format! Only PDF, XLSX, JPG, and PNG files are supported.");
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const base64Str = reader.result as string;
        setAttachments((prev) => [
          ...prev,
          {
            file_name: file.name,
            mime_type: file.type,
            file_data: base64Str,
          }
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = (indexIdx: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== indexIdx));
  };

  // Submit Logger Interaction Event
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!customerName.trim() || !customerPhone.trim()) {
      setFormError("Please enter customer name and phone number to start.");
      return;
    }

    try {
      setFormLoading(true);
      setFormError("");

      const finalBrand = selectedBrand === "Custom Value" ? (customBrand || "Custom Brand") : selectedBrand;

      const bodyPayload = {
        customer_name: customerName,
        customer_phone: customerPhone,
        interaction_type: interactionType,
        communication_type: communicationType,
        call_direction: callDirection,
        brand: finalBrand,
        category: selectedCategory,
        priority,
        status,
        summary,
        action_taken: actionTaken,
        follow_up_required: followUpRequired,
        follow_up_date: followUpRequired ? followUpDate : undefined,
        follow_up_notes: followUpRequired ? followUpNotes : undefined,
        agent_id: currentUser.id,
        agent_name: currentUser.name,
        attachments,
      };

      const res = await apiFetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to log customer interaction in the database.");
      }

      setFormSuccess(true);
      setTimeout(() => {
        onSuccess(); // Switch lists or go back to Dashboard
      }, 1500);

    } catch (err: any) {
      setFormError(err.message || "Unexpected network connection error.");
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="animate-fade-in text-[#e4e4e7]">

      {/* Main CRM Interaction Logger Form */}
      <form onSubmit={handleSubmit} className="max-w-4xl mx-auto bg-[#121214] border border-[#27272a] rounded-3xl p-6 md:p-8 shadow-xl space-y-8 relative overflow-hidden text-[#e4e4e7]">
        
        {formSuccess && (
          <div className="absolute inset-0 bg-[#121214]/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-center animate-fade-in">
            <div className="w-16 h-16 bg-emerald-900/30 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center mb-4">
              <Check className="w-8 h-8 stroke-[3]" />
            </div>
            <h3 className="text-xl font-extrabold text-white">Interaction Logged Successfully!</h3>
            <p className="text-[#71717a] text-sm mt-1">Saving data and updating daily support indicators...</p>
          </div>
        )}

        <div>
          <h2 className="text-lg font-extrabold text-white">Log New Customer Interaction</h2>
          <p className="text-xs text-[#71717a] mt-1 font-light">Please ensure core fields are populated to maintain accurate tracking and export metrics.</p>
        </div>

        {formError && (
          <div className="flex bg-rose-500/10 border border-rose-500/20 text-rose-300 p-4 rounded-2xl text-xs gap-2 items-center">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="font-bold">{formError}</p>
          </div>
        )}

        {/* 1. Basic Customer Info Section */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider pb-1 border-b border-[#27272a] flex items-center gap-1.5">
            <UserIcon className="w-3.5 h-3.5 text-[#71717a]" />
            1. Core Customer Information
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Full Customer Name:</label>
              <div className="relative">
                <select
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full px-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition font-medium [&>option]:bg-[#121214] [&>option]:text-white"
                >
                  {CUSTOMER_NAMES.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                  {!CUSTOMER_NAMES.includes(customerName) && customerName && (
                    <option value={customerName}>Custom: {customerName}</option>
                  )}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Phone Number:</label>
              <select
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full px-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition font-medium font-mono text-left [&>option]:bg-[#121214] [&>option]:text-white"
                dir="ltr"
              >
                {CUSTOMER_PHONES.map((phone) => (
                  <option key={phone} value={phone}>{phone}</option>
                ))}
                {!CUSTOMER_PHONES.includes(customerPhone) && customerPhone && (
                  <option value={customerPhone}>Custom: {customerPhone}</option>
                )}
              </select>
            </div>
          </div>

          {/* Auto Filled Agent Info */}
          <div className="p-3 bg-blue-950/20 rounded-2xl flex flex-wrap gap-4 items-center justify-between text-xs font-medium text-blue-400 border border-blue-500/20">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-400" />
              <span>Interaction DateTime: <strong>Automatic</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <UserIcon className="w-4 h-4 text-blue-400" />
              <span>Assigned Agent: <strong className="text-white font-bold">{currentUser.name}</strong></span>
            </div>
          </div>
        </div>

        {/* 2. Interaction Details Section */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider pb-1 border-b border-[#27272a] flex items-center gap-1.5">
            <CheckSquare className="w-3.5 h-3.5 text-[#71717a]" />
            2. Interaction Classification Details
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Interaction Type:</label>
              <select
                value={interactionType}
                onChange={(e) => setInteractionType(e.target.value as InteractionType)}
                className="w-full px-3 py-3 bg-[#0a0a0b] border border-[#27272a] text-white rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition font-bold [&>option]:bg-[#121214] [&>option]:text-white"
              >
                <option value="SR">Service Request (SR)</option>
                <option value="Complaint">Complaint</option>
                <option value="Inquiry">Finance/General Inquiry</option>
                <option value="Escalation">Urgent Escalation</option>
                <option value="Follow Up">Previous Follow Up</option>
                <option value="Feedback">Customer Experience Feedback</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Collaborating Brand:</label>
              <select
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
                className="w-full px-3 py-3 bg-[#0a0a0b] border border-[#27272a] text-white rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition font-bold [&>option]:bg-[#121214] [&>option]:text-white"
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.brand_name}>
                    {b.brand_name}
                  </option>
                ))}
                <option value="Custom Value">Other Custom Value...</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Priority & Severity:</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                className="w-full px-3 py-3 bg-[#0a0a0b] border border-[#27272a] text-white rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition font-bold [&>option]:bg-[#121214] [&>option]:text-white"
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Initial Ticket Status:</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as InteractionStatus)}
                className="w-full px-3 py-3 bg-[#0a0a0b] border border-[#27272a] text-white rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition font-bold [&>option]:bg-[#121214] [&>option]:text-white"
              >
                <option value="Open">Open</option>
                <option value="Pending">Pending Review</option>
                <option value="Resolved">Resolved</option>
                <option value="Closed">Closed</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Custom Brand input if Custom Value is toggled */}
            {selectedBrand === "Custom Value" && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-300">Select Custom Brand Name:</label>
                <select
                  value={customBrand}
                  onChange={(e) => setCustomBrand(e.target.value)}
                  className="w-full px-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition font-medium [&>option]:bg-[#121214] [&>option]:text-white"
                >
                  {CUSTOM_BRANDS.map((brand) => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                  {!CUSTOM_BRANDS.includes(customBrand) && customBrand && (
                    <option value={customBrand}>Custom: {customBrand}</option>
                  )}
                </select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Problem & Core Event Category:</label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-3 py-3 bg-[#0a0a0b] border border-[#27272a] text-white rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition font-bold [&>option]:bg-[#121214] [&>option]:text-white"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.category_name}>
                    {c.category_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Form direction controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300 block">Communication Channel:</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCommunicationType("Call")}
                  className={`py-3 rounded-2xl text-xs font-bold border transition flex items-center justify-center gap-1.5 ${
                    communicationType === "Call"
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-[#0a0a0b] text-[#71717a] border-[#27272a] hover:bg-[#1c1c1f]/50 hover:text-[#e4e4e7]"
                  }`}
                >
                  <Phone className="w-3.5 h-3.5" />
                  Phone Call
                </button>
                <button
                  type="button"
                  onClick={() => setCommunicationType("Task")}
                  className={`py-3 rounded-2xl text-xs font-bold border transition flex items-center justify-center gap-1.5 ${
                    communicationType === "Task"
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-[#0a0a0b] text-[#71717a] border-[#27272a] hover:bg-[#1c1c1f]/50 hover:text-[#e4e4e7]"
                  }`}
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  Internal Task
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300 block">Call Direction:</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCallDirection("Inbound")}
                  className={`py-3 rounded-2xl text-xs font-bold border transition flex items-center justify-center gap-1.5 ${
                    callDirection === "Inbound"
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-[#0a0a0b] text-[#71717a] border-[#27272a] hover:bg-[#1c1c1f]/50 hover:text-[#e4e4e7]"
                  }`}
                >
                  Inbound Call
                </button>
                <button
                  type="button"
                  onClick={() => setCallDirection("Outbound")}
                  className={`py-3 rounded-2xl text-xs font-bold border transition flex items-center justify-center gap-1.5 ${
                    callDirection === "Outbound"
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-[#0a0a0b] text-[#71717a] border-[#27272a] hover:bg-[#1c1c1f]/50 hover:text-[#e4e4e7]"
                  }`}
                >
                  Outbound Call
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Text Fields Areas */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider pb-1 border-b border-[#27272a]">
            3. Issue Details & Key Actions
          </h3>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Detailed Interaction Summary:</label>
              <select
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="w-full px-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition font-medium [&>option]:bg-[#121214] [&>option]:text-white"
              >
                {INTERACTION_SUMMARIES.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                {!INTERACTION_SUMMARIES.includes(summary) && summary && (
                  <option value={summary}>Custom: {summary}</option>
                )}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">Immediate Action Taken:</label>
              <select
                value={actionTaken}
                onChange={(e) => setActionTaken(e.target.value)}
                className="w-full px-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition font-medium [&>option]:bg-[#121214] [&>option]:text-white"
              >
                {ACTIONS_TAKEN.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                {!ACTIONS_TAKEN.includes(actionTaken) && actionTaken && (
                  <option value={actionTaken}>Custom: {actionTaken}</option>
                )}
              </select>
            </div>
          </div>
        </div>

        {/* 4. Follow Up Schedule Panel */}
        <div className="space-y-4 p-5 bg-[#0a0a0b] border border-[#27272a] rounded-2xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-white">Is an active follow-up required?</p>
              <p className="text-[10px] text-[#71717a] font-light">The CRM logs reminders to help agent follow-up with the customer effectively.</p>
            </div>
            
            <button
              type="button"
              onClick={() => setFollowUpRequired(!followUpRequired)}
              className={`w-14 h-8 rounded-full transition relative flex items-center p-1 ${
                followUpRequired ? "bg-blue-600 justify-end" : "bg-[#27272a] justify-start"
              }`}
            >
              <span className="w-6 h-6 bg-white rounded-full shadow-md"></span>
            </button>
          </div>

          {followUpRequired && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 animate-fade-in">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-300">Expected Follow-up Date:</label>
                <input
                  type="date"
                  required
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  className="w-full px-4 py-3 bg-[#121214] border border-[#27272a] text-white rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition font-bold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-300">Core Follow-up Target Notes:</label>
                <select
                  value={followUpNotes}
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                  className="w-full px-4 py-3 bg-[#121214] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition font-medium [&>option]:bg-[#121214] [&>option]:text-white"
                >
                  {FOLLOW_UP_NOTES_LIST.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                  {!FOLLOW_UP_NOTES_LIST.includes(followUpNotes) && followUpNotes && (
                    <option value={followUpNotes}>Custom: {followUpNotes}</option>
                  )}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* 5. Document Attachments Drag Area */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider pb-1 border-b border-[#27272a]">
            5. Attachments & Support Documents
          </h3>

          <div className="flex flex-col items-center justify-center border-2 border-dashed border-[#27272a] hover:border-blue-500/50 p-6 rounded-2xl cursor-pointer transition bg-[#0a0a0b] hover:bg-[#1c1c1f]/40 relative">
            <input
              type="file"
              multiple
              onChange={handleFileChange}
              accept=".pdf,.xlsx,.png,.jpg,.jpeg"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <FilePlus className="w-8 h-8 text-[#71717a] mb-2" />
            <p className="text-xs font-bold text-white">Drag & drop files here, or click to choose local file</p>
            <p className="text-[10px] text-[#71717a] mt-1 font-light">Supported formats: PDF, XLSX, JPG, JPEG, PNG (Max size: 5MB per file)</p>
          </div>

          {attachments.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {attachments.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-[#0a0a0b] border border-[#27272a] rounded-2xl text-xs">
                  <div className="flex items-center gap-2 truncate pr-2">
                    <span className="p-1 px-1.5 bg-blue-900/30 text-blue-400 border border-blue-500/20 rounded-md font-extrabold text-[9px] uppercase shrink-0">
                      {file.mime_type.split("/")[1]?.toUpperCase() || "DOC"}
                    </span>
                    <span className="text-[#e4e4e7] font-medium truncate">{file.file_name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    className="p-1 text-[#71717a] hover:text-rose-400 rounded-lg active:scale-90 transition shrink-0"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submit Form Triggers */}
        <button
          type="submit"
          disabled={formLoading}
          className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 text-white font-extrabold rounded-2xl shadow-lg shadow-blue-600/10 transition flex items-center justify-center gap-2 text-sm cursor-pointer"
        >
          {formLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Registering interaction in secure CRM databases...
            </>
          ) : (
            <>
              <Send className="w-4 h-4 rotate-180" />
              Submit and Log Interaction in CRM Now
            </>
          )}
        </button>

      </form>
    </div>
  );
}
