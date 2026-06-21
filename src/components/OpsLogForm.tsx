import React, { useState, useEffect } from "react";
import { User, LogType, LOG_TYPE_CONFIG, OpsLog, Brand, Branch } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { Check, Loader2, Send, AlertCircle, ClipboardList } from "lucide-react";

interface OpsLogFormProps {
  currentUser: User;
  editLog?: OpsLog | null;
  onDone: () => void;
}

const DEPT_TO_LOGTYPE: Record<string, LogType> = {
  "Call Center": "call_center",
  "Technical": "technical",
  "Complaints": "complaint",
};

const FIELD_META: Record<string, { label: string; type: "text" | "textarea" | "date" | "brand" | "branch" | "aggregator" | "agent" }> = {
  branch: { label: "Branch", type: "branch" },
  brand: { label: "Brand", type: "brand" },
  order_number: { label: "Order Number", type: "text" },
  aggregator: { label: "Aggregator", type: "aggregator" },
  customer_name: { label: "Customer Name", type: "text" },
  complaint_id: { label: "Complaint ID", type: "text" },
  target_agent_name: { label: "Agent Name", type: "agent" },
  notes: { label: "Notes", type: "textarea" },
  action_taken: { label: "Action Taken", type: "textarea" },
  resolution_notes: { label: "Resolution Notes", type: "textarea" },
  action_plan: { label: "Action Plan", type: "textarea" },
  follow_up_date: { label: "Follow-up Date", type: "date" },
};

export default function OpsLogForm({ currentUser, editLog, onDone }: OpsLogFormProps) {
  const isAdmin = currentUser.role === "admin";
  const isLeader = currentUser.role === "leader";
  const editing = !!editLog;

  // Determine the log type
  const initialType: LogType = editLog?.log_type as LogType
    || (isLeader ? "team_leader" : isAdmin ? "call_center" : (DEPT_TO_LOGTYPE[currentUser.department || ""] || "call_center"));
  const [logType, setLogType] = useState<LogType>(initialType);
  const cfg = LOG_TYPE_CONFIG[logType];

  const [activity, setActivity] = useState(editLog?.activity_type || "");
  const [status, setStatus] = useState(editLog?.status || "");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    if (editLog) Object.keys(FIELD_META).forEach((k) => { v[k] = (editLog as any)[k] || ""; });
    return v;
  });

  const [activityOpts, setActivityOpts] = useState<string[]>([]);
  const [statusOpts, setStatusOpts] = useState<string[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [agents, setAgents] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Load option lists whenever the log type changes
  useEffect(() => {
    const load = async () => {
      const getLabels = async (key?: string) => {
        if (!key) return [];
        try { const r = await apiFetch(`/api/options/${key}`); if (r.ok) return (await r.json()).map((o: any) => o.label); } catch (e) {}
        return [];
      };
      const [act, st] = await Promise.all([getLabels(cfg.activityKey), getLabels(cfg.statusKey)]);
      setActivityOpts(act);
      setStatusOpts(st);
      if (!editing) {
        setActivity(act[0] || "");
        setStatus(st[0] || "");
      }
    };
    load();
  }, [logType]);

  useEffect(() => {
    const load = async () => {
      try {
        const [rb, rbr] = await Promise.all([apiFetch("/api/brands"), apiFetch("/api/branches")]);
        if (rb.ok) setBrands(await rb.json());
        if (rbr.ok) setBranches(await rbr.json());
        // Agents in the relevant department (for Team Leader target selection)
        const ru = await apiFetch("/api/users");
        if (ru.ok) {
          const users: User[] = await ru.json();
          const dept = currentUser.department;
          setAgents(users.filter((u) => u.role === "agent" && (!dept || u.department === dept)).map((u) => u.full_name));
        }
      } catch (e) { /* ignore */ }
    };
    load();
  }, []);

  const setVal = (k: string, v: string) =>
    setValues((p) => (k === "brand" ? { ...p, brand: v, branch: "" } : { ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!activity) return setError("Please select an activity type.");
    if (cfg.statusKey && !status) return setError("Please select a status.");

    const payload: any = { activity_type: activity };
    if (cfg.statusKey) payload.status = status;
    cfg.fields.forEach((f) => { if (values[f]) payload[f] = values[f]; });
    if (isAdmin) { payload.log_type = logType; payload.department = cfg.department || currentUser.department; }

    try {
      setLoading(true);
      const res = await apiFetch(editing ? `/api/logs/${editLog!.id}` : "/api/logs", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed to save log."); }
      setSuccess(true);
      setTimeout(() => onDone(), 1100);
    } catch (err: any) {
      setError(err.message || "Network error.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full px-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition";
  const selectCls = inputCls + " font-bold [&>option]:bg-[#121214]";

  const renderField = (f: string) => {
    const meta = FIELD_META[f];
    if (!meta) return null;
    const common = { value: values[f] || "", onChange: (e: any) => setVal(f, e.target.value) };
    let control: React.ReactNode;
    if (meta.type === "textarea") control = <textarea {...common} rows={f === "notes" ? 3 : 2} className={inputCls + " leading-relaxed"} placeholder={meta.label + "..."} />;
    else if (meta.type === "date") control = <input type="date" {...common} className={inputCls} />;
    else if (meta.type === "brand") control = <select {...common} className={selectCls}><option value="">— Select —</option>{brands.map((b) => <option key={b.id} value={b.brand_name}>{b.brand_name}</option>)}</select>;
    else if (meta.type === "branch") {
      const brandSel = values["brand"];
      const branchOpts = brandSel ? branches.filter((b) => b.brand === brandSel) : (cfg.fields.includes("brand") ? [] : branches);
      control = (
        <select {...common} className={selectCls}>
          <option value="">{cfg.fields.includes("brand") && !brandSel ? "— Select a brand first —" : "— Select —"}</option>
          {branchOpts.map((b) => <option key={b.id} value={b.branch_name}>{b.branch_name}</option>)}
        </select>
      );
    }
    else if (meta.type === "aggregator") control = <select {...common} className={selectCls}><option value="">— Select —</option>{["Talabat", "Keeta", "Other Aggregators"].map((a) => <option key={a} value={a}>{a}</option>)}</select>;
    else if (meta.type === "agent") control = <select {...common} className={selectCls}><option value="">— Select agent —</option>{agents.map((a) => <option key={a} value={a}>{a}</option>)}</select>;
    else control = <input type="text" {...common} className={inputCls} placeholder={meta.label} />;
    const full = meta.type === "textarea";
    return (
      <div key={f} className={`space-y-1.5 ${full ? "md:col-span-2" : ""}`}>
        <label className="text-xs font-bold text-zinc-300">{meta.label}:</label>
        {control}
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="bg-[#121214] border border-[#27272a] rounded-3xl p-6 md:p-8 shadow-xl space-y-6 relative overflow-hidden text-[#e4e4e7]">
      {success && (
        <div className="absolute inset-0 bg-[#121214]/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-emerald-900/30 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center mb-4"><Check className="w-8 h-8 stroke-[3]" /></div>
          <h3 className="text-lg font-extrabold text-white">{editing ? "Log Updated!" : "Log Saved!"}</h3>
        </div>
      )}

      <div>
        <h2 className="text-lg font-extrabold text-white flex items-center gap-2"><ClipboardList className="w-5 h-5 text-blue-400" /> {editing ? "Edit" : "New"} {cfg.title}</h2>
        <p className="text-xs text-[#71717a] mt-1 font-light">Date &amp; time are recorded automatically.</p>
      </div>

      {error && (<div className="flex bg-rose-500/10 border border-rose-500/20 text-rose-300 p-4 rounded-2xl text-xs gap-2 items-center"><AlertCircle className="w-5 h-5 shrink-0" /><p className="font-bold">{error}</p></div>)}

      {/* Admin picks the log type */}
      {isAdmin && !editing && (
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-zinc-300">Log Type:</label>
          <select value={logType} onChange={(e) => setLogType(e.target.value as LogType)} className={selectCls}>
            {(Object.keys(LOG_TYPE_CONFIG) as LogType[]).map((t) => <option key={t} value={t}>{LOG_TYPE_CONFIG[t].title}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-zinc-300">{cfg.activityLabel}:</label>
          <select value={activity} onChange={(e) => setActivity(e.target.value)} className={selectCls}>
            <option value="">— Select —</option>
            {activityOpts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {cfg.statusKey && (
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-300">Status:</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
              <option value="">— Select —</option>
              {statusOpts.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        {cfg.fields.map(renderField)}
      </div>

      <button type="submit" disabled={loading} className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 text-white font-extrabold rounded-2xl shadow-lg shadow-blue-600/10 transition flex items-center justify-center gap-2 text-sm">
        {loading ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>) : (<><Send className="w-4 h-4" /> {editing ? "Update Log" : "Save Log"}</>)}
      </button>
    </form>
  );
}
