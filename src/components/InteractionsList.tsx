import { useState, useEffect } from "react";
import { Interaction, User, Brand, Category } from "../types.js";
import { Search, Calendar, Filter, Phone, User as UserIcon, RefreshCw, Eye, Download, AlertCircle, FileText, CheckCircle2, X, ChevronDown } from "lucide-react";
import { downloadFile, formatDate, exportInteractionsToCSV } from "../utils.js";
import { apiFetch } from "../lib/api.ts";

interface InteractionsListProps {
  currentUser: User;
}

export default function InteractionsList({ currentUser }: InteractionsListProps) {
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [filtered, setFiltered] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters state
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // System options for filtering dropdowns
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [agents, setAgents] = useState<string[]>([]);

  // Detailed view modal
  const [selectedItem, setSelectedItem] = useState<Interaction | null>(null);

  const fetchInteractions = async () => {
    try {
      setLoading(true);
      setError("");
      const [resLogs, resBrands, resCat] = await Promise.all([
        apiFetch("/api/interactions"),
        apiFetch("/api/brands"),
        apiFetch("/api/categories")
      ]);

      if (!resLogs.ok) throw new Error("Failed to review interaction list from firewall");
      
      const logs: Interaction[] = await resLogs.json();
      setInteractions(logs);
      setFiltered(logs);

      if (resBrands.ok) {
        const b = await resBrands.json();
        setBrands(b);
      }
      if (resCat.ok) {
        const c = await resCat.json();
        setCategories(c);
      }

      // Gather distinct list of agent names
      const distinctAgents = Array.from(new Set(logs.map((l) => l.agent_name)));
      setAgents(distinctAgents);

    } catch (err: any) {
      setError(err.message || "Failed to connect to server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInteractions();
  }, []);

  // Filter computation
  useEffect(() => {
    let result = [...interactions];

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.customer_name.toLowerCase().includes(q) ||
          i.customer_phone.includes(q) ||
          (i.summary || "").toLowerCase().includes(q)
      );
    }

    if (brandFilter) {
      result = result.filter((i) => i.brand === brandFilter);
    }

    if (agentFilter) {
      result = result.filter((i) => i.agent_name === agentFilter);
    }

    if (statusFilter) {
      result = result.filter((i) => i.status === statusFilter);
    }

    if (typeFilter) {
      result = result.filter((i) => i.interaction_type === typeFilter);
    }

    if (directionFilter) {
      result = result.filter((i) => i.call_direction === directionFilter);
    }

    if (categoryFilter) {
      result = result.filter((i) => i.category === categoryFilter);
    }

    // Date range filter
    if (startDate) {
      result = result.filter((i) => i.interaction_date >= startDate);
    }
    if (endDate) {
      result = result.filter((i) => i.interaction_date <= endDate);
    }

    setFiltered(result);
  }, [search, brandFilter, agentFilter, statusFilter, typeFilter, directionFilter, categoryFilter, startDate, endDate, interactions]);

  const resetFilters = () => {
    setSearch("");
    setBrandFilter("");
    setAgentFilter("");
    setStatusFilter("");
    setTypeFilter("");
    setDirectionFilter("");
    setCategoryFilter("");
    setStartDate("");
    setEndDate("");
  };

  const getPriorityBadgeClass = (p: string) => {
    switch (p) {
      case "Critical":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20";
      case "High":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "Medium":
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      default:
        return "bg-zinc-800 text-zinc-400 border-zinc-700";
    }
  };

  const getStatusBadgeClass = (s: string) => {
    switch (s) {
      case "Resolved":
      case "Closed":
        return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25";
      case "Pending":
        return "bg-amber-500/10 text-amber-400 border border-amber-500/25";
      default:
        return "bg-blue-500/10 text-blue-400 border border-blue-500/25";
    }
  };

  const translateStatus = (s: string) => {
    switch (s) {
      case "Open": return "Open";
      case "Pending": return "Pending";
      case "Resolved": return "Resolved";
      case "Closed": return "Closed";
      default: return s;
    }
  };

  const translateType = (t: string) => {
    switch (t) {
      case "SR": return "Service Request (SR)";
      case "Complaint": return "Complaint";
      case "Inquiry": return "Inquiry";
      case "Escalation": return "Escalation";
      case "Follow Up": return "Follow Up";
      case "Feedback": return "Feedback";
      default: return t;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in text-[#e4e4e7]">
      
      {/* Search Header and filters bar */}
      <div className="bg-[#121214] p-5 border border-[#27272a] shadow-xl rounded-3xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-md font-extrabold text-white">Interactions Management List</h2>
            <p className="text-xs text-[#71717a] font-light mt-0.5">
              Search customer tickets, follow call records, and download comprehensive statistical reports.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchInteractions}
              className="p-3 text-zinc-300 hover:text-white bg-[#0a0a0b] hover:bg-zinc-800 border border-[#27272a] rounded-2xl active:scale-95 transition"
              title="Refresh Data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => exportInteractionsToCSV(filtered)}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 shadow shadow-emerald-500/10 transition"
            >
              <Download className="w-4 h-4" />
              Export Filtered to CSV
            </button>
          </div>
        </div>

        {/* Filters Panel */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-2">
          {/* Main search input */}
          <div className="relative sm:col-span-2">
            <Search className="w-4 h-4 text-zinc-500 absolute right-3.5 top-3.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer name, phone number, or summary..."
              className="w-full pr-10 pl-4 py-3 bg-[#0a0a0b] text-white border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition placeholder:text-zinc-650"
            />
          </div>

          {/* Date Range Start */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-zinc-400">Start Date (From):</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-[#0a0a0b] text-zinc-300 border border-[#27272a] rounded-2xl text-xs font-bold focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Date Range End */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-zinc-400">End Date (To):</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 bg-[#0a0a0b] text-zinc-300 border border-[#27272a] rounded-2xl text-xs font-bold focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Secondary filters dropdowns drawer */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[#27272a]/50">
          <div className="flex items-center gap-1 bg-[#0a0a0b] px-2.5 py-1.5 rounded-xl border border-[#27272a]/80 text-[10px] text-zinc-400">
            <Filter className="w-3.5 h-3.5 text-blue-400" />
            <span>Advanced Filter:</span>
          </div>

          {/* Brand Filter */}
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-[#0a0a0b] hover:bg-zinc-800 border border-[#27272a] rounded-xl text-xs font-bold text-zinc-300 focus:outline-none [&>option]:bg-[#121214] [&>option]:text-white"
          >
            <option value="">All Brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.brand_name}>
                {b.brand_name}
              </option>
            ))}
          </select>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-[#0a0a0b] hover:bg-zinc-800 border border-[#27272a] rounded-xl text-xs font-bold text-zinc-300 focus:outline-none [&>option]:bg-[#121214] [&>option]:text-white"
          >
            <option value="">All Interaction Types</option>
            <option value="SR">Service Request (SR)</option>
            <option value="Complaint">Complaint</option>
            <option value="Inquiry">Inquiry</option>
            <option value="Escalation">Escalation</option>
            <option value="Follow Up">Follow Up</option>
            <option value="Feedback">Feedback</option>
          </select>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-[#0a0a0b] hover:bg-zinc-800 border border-[#27272a] rounded-xl text-xs font-bold text-zinc-300 focus:outline-none [&>option]:bg-[#121214] [&>option]:text-white"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.category_name}>
                {c.category_name}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-[#0a0a0b] hover:bg-zinc-800 border border-[#27272a] rounded-xl text-xs font-bold text-zinc-300 focus:outline-none [&>option]:bg-[#121214] [&>option]:text-white"
          >
            <option value="">All Statuses</option>
            <option value="Open">Open</option>
            <option value="Pending">Pending</option>
            <option value="Resolved">Resolved</option>
            <option value="Closed">Closed</option>
          </select>

          {/* Agent Filter */}
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-[#0a0a0b] hover:bg-zinc-800 border border-[#27272a] rounded-xl text-xs font-bold text-zinc-300 focus:outline-none [&>option]:bg-[#121214] [&>option]:text-white"
          >
            <option value="">All Support Agents</option>
            {agents.map((ag) => (
              <option key={ag} value={ag}>
                {ag}
              </option>
            ))}
          </select>

          {/* Call direction filter */}
          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-[#0a0a0b] hover:bg-zinc-800 border border-[#27272a] rounded-xl text-xs font-bold text-zinc-300 focus:outline-none [&>option]:bg-[#121214] [&>option]:text-white"
          >
            <option value="">All Call Directions</option>
            <option value="Inbound">Inbound</option>
            <option value="Outbound">Outbound</option>
          </select>

          {/* Clear Filter */}
          <button
            onClick={resetFilters}
            className="px-2.5 py-1.5 text-xs text-rose-450 bg-[#1e1416]/40 hover:bg-[#1e1416]/80 border border-rose-500/20 hover:border-rose-500/40 rounded-xl font-bold transition"
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* Loading & Database State */}
      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[300px]">
          <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-3 text-xs text-zinc-400">Loading CRM records...</p>
        </div>
      ) : error ? (
        <div className="p-6 bg-rose-950/20 border border-rose-500/30 text-center rounded-3xl">
          <AlertCircle className="w-10 h-10 text-rose-450 mx-auto" />
          <h3 className="mt-2 text-md font-bold text-rose-200">Failed to Retrieve Interactions</h3>
          <p className="text-xs text-rose-450 mt-1">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#121214] border border-[#27272a] p-12 text-center rounded-3xl">
          <p className="text-[#71717a] text-sm font-bold">No interactions match the filters specified.</p>
          <button
            onClick={resetFilters}
            className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition"
          >
            Show All Interactions
          </button>
        </div>
      ) : (
        /* Data grid table and list */
        <div className="bg-[#121214] border border-[#27272a] rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0a0a0b] text-[#71717a] font-bold border-b border-[#27272a]">
                <tr>
                  <th className="p-4">Interaction Type</th>
                  <th className="p-4">Customer Name & Phone</th>
                  <th className="p-4">Agent & Brand</th>
                  <th className="p-4">Date & Time</th>
                  <th className="p-4">Priority</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272a]">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-[#1c1c1f]/40 transition even:bg-[#121214]">
                    {/* Interaction Type with direction indicator badge */}
                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-extrabold text-[#e4e4e7]">{translateType(item.interaction_type)}</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                            item.communication_type === "Call" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"
                          }`}>
                            {item.communication_type === "Call" ? "📞 Call" : "✏️ Task"}
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            {item.call_direction === "Inbound" ? "Inbound" : "Outbound"}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Customer and Contact info */}
                    <td className="p-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-white">{item.customer_name}</span>
                        <span className="font-mono text-zinc-400 font-medium tracking-wide text-[11px] select-all cursor-copy" dir="ltr">
                          {item.customer_phone}
                        </span>
                      </div>
                    </td>

                    {/* Brand and Agent assignee */}
                    <td className="p-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-extrabold text-blue-400">{item.brand}</span>
                        <span className="text-[10px] text-zinc-400">{item.agent_name}</span>
                      </div>
                    </td>

                    {/* Timestamp */}
                    <td className="p-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-zinc-300 font-mono text-[11px]">{item.interaction_date}</span>
                        <span className="text-[11px] text-zinc-500 font-mono font-medium">{item.interaction_time}</span>
                      </div>
                    </td>

                    {/* Priority Badge */}
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${getPriorityBadgeClass(item.priority)}`}>
                        {item.priority}
                      </span>
                    </td>

                    {/* Status badge */}
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${getStatusBadgeClass(item.status)}`}>
                        ● {translateStatus(item.status)}
                      </span>
                    </td>

                    {/* Actions button */}
                    <td className="p-4 text-center">
                      <button
                        onClick={() => setSelectedItem(item)}
                        className="px-3 py-1.5 bg-[#0a0a0b] hover:bg-blue-600 text-[#e4e4e7] hover:text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 mx-auto active:scale-95 border border-[#27272a]/60"
                      >
                        <Eye className="w-4 h-4" />
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 bg-[#0a0a0b] text-[11px] text-[#71717a] flex items-center justify-between border-t border-[#27272a]">
            <span>Total Filtered Interactions: <strong className="text-white">{filtered.length} records</strong></span>
            <span>Chronological Order (Latest First)</span>
          </div>
        </div>
      )}

      {/* High-fidelity Detail Drawer Modal overlay */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-fade-in text-left">
          <div className="bg-[#121214] border border-[#27272a] rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl space-y-6 animate-scale-up text-[#e4e4e7]">
            
            {/* Modal Header */}
            <div className="bg-[#0a0a0b] border-b border-[#27272a] p-5 flex items-center justify-between">
              <div>
                <span className="text-[10px] bg-blue-600/15 text-blue-400 px-2.5 py-0.5 rounded-full border border-blue-500/20 uppercase font-extrabold">
                  {selectedItem.id}
                </span>
                <h3 className="text-md font-bold text-white mt-1">Interaction Details: {selectedItem.customer_name}</h3>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="p-2 text-zinc-400 hover:text-white rounded-xl active:scale-90 transition bg-zinc-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 md:p-8 space-y-6 max-h-[70vh] overflow-y-auto font-sans">
              
              {/* Grid properties */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-[#0a0a0b] p-4 rounded-2xl border border-[#27272a]">
                <div>
                  <span className="text-[10px] text-[#71717a] block font-bold uppercase">Customer & Phone</span>
                  <span className="text-xs font-bold text-white block truncate mt-0.5">{selectedItem.customer_name}</span>
                  <span className="text-[10.5px] font-mono text-zinc-450 mt-0.5 block" dir="ltr">{selectedItem.customer_phone}</span>
                </div>

                <div>
                  <span className="text-[10px] text-[#71717a] block font-bold uppercase">Brand / Company</span>
                  <span className="text-xs font-extrabold text-blue-400 block mt-0.5">{selectedItem.brand}</span>
                  <span className="text-[10px] text-zinc-400 block truncate">{selectedItem.category}</span>
                </div>

                <div>
                  <span className="text-[10px] text-[#71717a] block font-bold uppercase">Date & Time</span>
                  <p className="text-xs font-bold text-zinc-300 font-mono mt-0.5">
                    {selectedItem.interaction_date} {selectedItem.interaction_time}
                  </p>
                </div>

                <div>
                  <span className="text-[10px] text-[#71717a] block font-bold uppercase">Assigned Agent</span>
                  <span className="text-xs font-bold text-zinc-300 block truncate mt-0.5">{selectedItem.agent_name}</span>
                </div>
              </div>

              {/* Status and priorities badges */}
              <div className="flex gap-4">
                <div className="w-1/2 p-3 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                  <span className="text-[10px] text-zinc-450 block font-bold">Channel & Direction:</span>
                  <span className="text-xs font-extrabold text-blue-400 mt-1 block">
                    {selectedItem.communication_type === "Call" ? "📞 Phone Call" : "✏️ Internal Task"} (
                    {selectedItem.call_direction === "Inbound" ? "Inbound" : "Outbound"})
                  </span>
                </div>

                <div className="w-1/2 p-3 bg-[#0a0a0b] border border-[#27272a] rounded-xl">
                  <span className="text-[10px] text-zinc-455 block font-bold">Status & Severity:</span>
                  <div className="flex gap-2 mt-1">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold border ${getPriorityBadgeClass(selectedItem.priority)}`}>
                      {selectedItem.priority}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold border ${getStatusBadgeClass(selectedItem.status)}`}>
                      {translateStatus(selectedItem.status)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Summary text */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-extrabold text-white pb-1 border-b border-[#27272a] flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-blue-500" />
                  Detailed Interaction Summary:
                </h4>
                <div className="bg-[#0a0a0b] p-4 border border-[#27272a]/65 rounded-2xl text-xs text-zinc-350 leading-relaxed font-sans whitespace-pre-line">
                  {selectedItem.summary || "No description logged."}
                </div>
              </div>

              {/* Actions Taken */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-extrabold text-white pb-1 border-b border-[#27272a] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Resolution Action:
                </h4>
                <div className="bg-emerald-950/15 border border-emerald-500/20 p-4 rounded-2xl text-xs text-emerald-300 leading-relaxed font-sans whitespace-pre-line">
                  {selectedItem.action_taken || "No actions logged."}
                </div>
              </div>

              {/* Follow up details if required */}
              {selectedItem.follow_up_required && (
                <div className="p-4 bg-amber-950/15 border border-amber-500/20 text-amber-300 rounded-2xl space-y-1.5">
                  <span className="bg-amber-500/10 text-amber-400 text-[9px] font-extrabold px-2 py-0.5 rounded-full border border-amber-500/20 uppercase">
                    Follow-up Required
                  </span>
                  <div className="flex gap-4 items-center text-xs pt-1.5">
                    <span className="font-bold">Follow-up Date:</span>
                    <span className="font-mono bg-[#0a0a0b] text-white px-2 py-0.5 rounded border border-amber-500/25">{selectedItem.follow_up_date}</span>
                  </div>
                  <p className="text-xs font-medium leading-relaxed mt-1">{selectedItem.follow_up_notes}</p>
                </div>
              )}

              {/* Attachments */}
              {selectedItem.attachments && selectedItem.attachments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-extrabold text-white pb-1 border-b border-[#27272a]">Attached Support Files:</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedItem.attachments.map((att) => (
                      <div key={att.id} className="flex items-center justify-between p-3 bg-[#0a0a0b] border border-[#27272a] rounded-xl text-xs">
                        <span className="text-zinc-300 truncate pl-2 font-medium">{att.file_name}</span>
                        <button
                          onClick={() => downloadFile(att.file_name, att.mime_type, att.file_data)}
                          className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition text-[10px] font-bold flex items-center gap-1 text-center"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>

            {/* Close footer */}
            <div className="p-4 bg-[#0a0a0b] border-t border-[#27272a] flex justify-end">
              <button
                onClick={() => setSelectedItem(null)}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition active:scale-95"
              >
                Close Details
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
