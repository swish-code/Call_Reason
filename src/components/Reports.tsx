import { useState, useEffect } from "react";
import { DailyReportData, MonthlyReportData, User } from "../types.js";
import { FileText, Printer, Download, Sparkles, TrendingUp, Award, Clock, Calendar, CheckSquare, BarChart } from "lucide-react";
import { downloadCSV, formatDate } from "../utils.js";
import { apiFetch } from "../lib/api.ts";

interface ReportsProps {
  currentUser: User;
}

export default function Reports({ currentUser }: ReportsProps) {
  const [activeTab, setActiveTab] = useState<"daily" | "monthly">("daily");
  
  // Daily parameters
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [dailyData, setDailyData] = useState<DailyReportData | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);

  // Monthly parameters
  const [monthlyData, setMonthlyData] = useState<MonthlyReportData | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  const [error, setError] = useState("");

  const fetchDailyReport = async () => {
    try {
      setDailyLoading(true);
      setError("");
      const res = await apiFetch(`/api/reports/daily?date=${selectedDate}`);
      if (!res.ok) throw new Error("Failed to request daily report telemetry.");
      const data = await res.json();
      setDailyData(data);
    } catch (err: any) {
      setError(err.message || "Database connection error.");
    } finally {
      setDailyLoading(false);
    }
  };

  const fetchMonthlyReport = async () => {
    try {
      setMonthlyLoading(true);
      setError("");
      const res = await apiFetch("/api/reports/monthly");
      if (!res.ok) throw new Error("Failed to request monthly analytics data.");
      const data = await res.json();
      setMonthlyData(data);
    } catch (err: any) {
      setError(err.message || "Database connection error.");
    } finally {
      setMonthlyLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "daily") {
      fetchDailyReport();
    } else {
      fetchMonthlyReport();
    }
  }, [activeTab, selectedDate]);

  // Export Daily Report to CSV
  const handleExportDaily = () => {
    if (!dailyData) return;
    const headers = ["Agent Name", "Calls Count", "Service Requests (SR) Count", "Tasks Count"];
    const rows = dailyData.agentProductivity.map((item) => [
      item.name,
      item.calls.toString(),
      item.srs.toString(),
      item.tasks.toString(),
    ]);

    // Add totals row
    rows.push([
      "Grand Total",
      dailyData.totalCalls.toString(),
      dailyData.totalSRs.toString(),
      dailyData.totalTasks.toString(),
    ]);

    downloadCSV(headers, rows, `Daily_Productivity_Report_${selectedDate}`);
  };

  // Export Monthly Report to CSV
  const handleExportMonthly = () => {
    if (!monthlyData) return;
    const headers = ["Brand / المشغل", "Interactions logged", "Resolution Rate"];
    const rows = monthlyData.brandPerformance.map((item) => [
      item.name,
      item.count.toString(),
      `${item.resolvedRate}%`,
    ]);

    downloadCSV(headers, rows, `Monthly_Performance_Report_${new Date().toISOString().substring(0, 7)}`);
  };

  // Print system print window
  const handlePrint = () => {
    window.print();
  };

  const todayFormatted = formatDate(selectedDate);

  return (
    <div className="space-y-6 animate-fade-in print:bg-[#0a0a0b] print:p-0 text-[#e4e4e7]">
      
      {/* Printable Heading Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#121214] p-5 border border-[#27272a] shadow-lg rounded-3xl print:shadow-none print:border-none">
        <div>
          <h2 className="text-md font-extrabold text-white flex items-center gap-2 font-sans">
            <FileText className="w-5 h-5 text-blue-400" />
            Advanced Analytical Reports Hub
          </h2>
          <p className="text-xs text-[#71717a] font-light mt-0.5">
            Extract key performance metrics, agent productivity states, and brand diagnostics with seamless offline CSV output support.
          </p>
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={handlePrint}
            className="px-4 py-2.5 bg-[#0a0a0b] hover:bg-zinc-850 text-zinc-300 border border-[#27272a] font-bold rounded-2xl text-xs flex items-center gap-1.5 transition active:scale-95"
          >
            <Printer className="w-4 h-4" />
            Save Report / PDF
          </button>
        </div>
      </div>

      {/* Tabs list selector */}
      <div className="flex bg-[#121214] p-1.5 border border-[#27272a] rounded-2xl w-fit gap-1 shadow-sm print:hidden">
        <button
          onClick={() => setActiveTab("daily")}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold transition ${
            activeTab === "daily" ? "bg-blue-600 text-white shadow" : "text-zinc-400 hover:bg-[#0a0a0b]"
          }`}
        >
          Daily Productivity Dashboard
        </button>
        <button
          onClick={() => setActiveTab("monthly")}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold transition ${
            activeTab === "monthly" ? "bg-blue-600 text-white shadow" : "text-zinc-400 hover:bg-[#0a0a0b]"
          }`}
        >
          Monthly Quality Analytics
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400">
          {error}
        </div>
      )}

      {/* Daily Report Tab Panel */}
      {activeTab === "daily" && (
        <div className="space-y-6">
          
          {/* Params selector */}
          <div className="bg-[#121214] p-5 border border-[#27272a] rounded-3xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-400" />
              <label className="text-xs font-bold text-zinc-300">Select Target Report Date:</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-4 py-2 bg-[#0a0a0b] text-zinc-300 border border-[#27272a] rounded-xl text-xs font-bold focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {dailyData && (
              <button
                onClick={handleExportDaily}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 active:scale-95 transition shadow shadow-emerald-500/10"
              >
                <Download className="w-4 h-4" />
                Export Report data to CSV
              </button>
            )}
          </div>

          {dailyLoading ? (
            <div className="flex flex-col items-center justify-center p-12">
              <div className="w-8 h-8 border-3 border-blue-650 border-t-transparent rounded-full animate-spin"></div>
              <p className="mt-2 text-xs text-[#71717a]">Assembling daily reports...</p>
            </div>
          ) : dailyData ? (
            <div className="space-y-6">
              
              {/* Report Header for Prints */}
              <div className="hidden print:block text-center space-y-2 border-b pb-4 mb-4 border-[#27272a]">
                <h1 className="text-xl font-bold text-white">Daily CRM Activity Dashboard</h1>
                <p className="text-xs text-zinc-400">Productivity logs for: {todayFormatted} ({selectedDate})</p>
                <p className="text-[10px] text-zinc-500">System generated CRM document</p>
              </div>

              {/* Counters blocks */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-[#121214] p-5 border border-[#27272a] rounded-2xl shadow-sm print:border">
                  <span className="text-[10px] text-zinc-450 block font-bold">Total Phone Calls</span>
                  <p className="text-2xl font-bold text-white tracking-tight font-mono mt-1">{dailyData.totalCalls}</p>
                </div>
                <div className="bg-[#121214] p-5 border border-[#27272a] rounded-2xl shadow-sm print:border">
                  <span className="text-[10px] text-zinc-450 block font-bold">Total Service Requests (SR)</span>
                  <p className="text-2xl font-bold text-white tracking-tight font-mono mt-1">{dailyData.totalSRs}</p>
                </div>
                <div className="bg-[#121214] p-5 border border-[#27272a] rounded-2xl shadow-sm print:border">
                  <span className="text-[10px] text-zinc-450 block font-bold">Total Internal Tasks</span>
                  <p className="text-2xl font-bold text-white tracking-tight font-mono mt-1">{dailyData.totalTasks}</p>
                </div>
                <div className="bg-[#121214] p-5 border border-[#27272a] rounded-2xl shadow-sm print:border">
                  <span className="text-[10px] text-zinc-450 block font-bold">Inbound Call Volume</span>
                  <p className="text-2xl font-bold text-blue-400 tracking-tight font-mono mt-1">{dailyData.inboundCount}</p>
                </div>
                <div className="bg-[#121214] p-5 border border-[#27272a] rounded-2xl shadow-sm print:border">
                  <span className="text-[10px] text-zinc-450 block font-bold">Outbound Call Volume</span>
                  <p className="text-2xl font-bold text-pink-400 tracking-tight font-mono mt-1">{dailyData.outboundCount}</p>
                </div>
              </div>

              {/* Agent Productivity table element */}
              <div className="bg-[#121214] border border-[#27272a] rounded-3xl overflow-hidden shadow-sm print:border">
                <div className="p-4 bg-[#0a0a0b] border-b border-[#27272a]">
                  <h3 className="text-xs font-extrabold text-white flex items-center gap-1.5 font-sans">
                    <Award className="w-4 h-4 text-blue-400" />
                    Agent Productivity Records for: {todayFormatted}
                  </h3>
                </div>

                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0a0a0b] text-[#71717a] font-bold border-b border-[#27272a]">
                    <tr>
                      <th className="p-4">Support Agent Name</th>
                      <th className="p-4 text-center">Logged Calls</th>
                      <th className="p-4 text-center">Service Requests (SR)</th>
                      <th className="p-4 text-center">Other Tasks</th>
                      <th className="p-4 text-center">Grand Total logged</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272a]">
                    {dailyData.agentProductivity.map((itm) => {
                      const sum = itm.calls + itm.srs + itm.tasks;
                      return (
                        <tr key={itm.name} className="hover:bg-[#1c1c1f]/40 transition">
                          <td className="p-4 font-bold text-white">{itm.name}</td>
                          <td className="p-4 text-center font-mono font-medium text-zinc-300">{itm.calls}</td>
                          <td className="p-4 text-center font-mono font-medium text-zinc-300">{itm.srs}</td>
                          <td className="p-4 text-center font-mono font-medium text-zinc-300">{itm.tasks}</td>
                          <td className="p-4 text-center font-mono font-bold text-blue-450 bg-blue-500/5">{sum} interactions</td>
                        </tr>
                      );
                    })}
                    {dailyData.agentProductivity.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-zinc-500 font-medium font-sans">No team actions logged for this selected timestamp.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

            </div>
          ) : null}
        </div>
      )}

      {/* Monthly Report Tab Panel */}
      {activeTab === "monthly" && (
        <div className="space-y-6">
          
          <div className="bg-[#121214] p-5 border border-[#27272a] rounded-3xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
            <div>
              <p className="text-xs font-bold text-zinc-300">Current Month Service Quality Telemetry</p>
              <p className="text-[10px] text-zinc-500 font-light mt-0.5">Analyze task resolution rates, follow-ups needed, and brand categories volume.</p>
            </div>

            {monthlyData && (
              <button
                onClick={handleExportMonthly}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 active:scale-95 transition shadow shadow-emerald-500/10"
              >
                <Download className="w-4 h-4" />
                Export Brand metrics to CSV
              </button>
            )}
          </div>

          {monthlyLoading ? (
            <div className="flex flex-col items-center justify-center p-12">
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="mt-2 text-xs text-[#71717a]">Gleaning monthly high-fidelity KPIs...</p>
            </div>
          ) : monthlyData ? (
            <div className="space-y-6">
              
              {/* Print elements */}
              <div className="hidden print:block text-center space-y-2 border-b pb-4 mb-4 border-[#27272a]">
                <h1 className="text-xl font-bold font-sans text-white">Monthly Quality Indicators & Retention</h1>
                <p className="text-xs text-[#71717a]">Global oversight of brand success rates</p>
              </div>

              {/* Quality Indicators metrics cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-[#121214] p-5 border border-[#27272a] rounded-2xl shadow-sm flex items-center gap-4">
                  <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl">
                    <TrendingUp className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="text-[10px] text-[#71717a] block font-bold">Ticket Resolution Success Rate</span>
                    <p className="text-2xl font-bold text-white font-mono tracking-tight">{monthlyData.resolutionRate}%</p>
                  </div>
                </div>

                <div className="bg-[#121214] p-5 border border-[#27272a] rounded-2xl shadow-sm flex items-center gap-4">
                  <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl">
                    <Clock className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="text-[10px] text-[#71717a] block font-bold">AHT (Avg Handling Time)</span>
                    <p className="text-2xl font-bold text-white font-mono tracking-tight">{monthlyData.averageHandlingTime}</p>
                  </div>
                </div>

                <div className="bg-[#121214] p-5 border border-[#27272a] rounded-2xl shadow-sm flex items-center gap-4">
                  <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
                    <CheckSquare className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="text-[10px] text-[#71717a] block font-bold">Required Follow-up Rate</span>
                    <p className="text-2xl font-bold text-white font-mono tracking-tight">{monthlyData.followUpRate}%</p>
                  </div>
                </div>

                <div className="bg-[#121214] p-5 border border-[#27272a] rounded-2xl shadow-sm flex items-center gap-4">
                  <div className="p-3 bg-purple-500/10 text-purple-400 rounded-xl">
                    <BarChart className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="text-[10px] text-[#71717a] block font-bold">Main Ticket Classification</span>
                    <p className="text-md font-bold text-purple-400 block truncate mt-1">
                      {monthlyData.topCategories.length > 0 ? monthlyData.topCategories[0].name : "N/A"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Brand Breakdown and Top categories list */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pb-6">
                
                {/* Brand breakdown Table */}
                <div className="bg-[#121214] border border-[#27272a] rounded-3xl overflow-hidden shadow-sm lg:col-span-8 flex flex-col justify-between">
                  <div>
                    <div className="p-4 bg-[#0a0a0b] border-b border-[#27272a]">
                      <h3 className="text-xs font-extrabold text-white font-sans">Resolution Performance Mapping per Brand</h3>
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#0a0a0b] text-[#71717a] font-bold border-b border-[#27272a]">
                        <tr>
                          <th className="p-4">Associated Brand Domain</th>
                          <th className="p-4 text-center">Total Interactions Logged</th>
                          <th className="p-4 text-center">Resolution Success Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#27272a]">
                        {monthlyData.brandPerformance.map((brand) => (
                          <tr key={brand.name} className="hover:bg-[#1c1c1f]/40 transition">
                            <td className="p-4 font-bold text-zinc-300">{brand.name}</td>
                            <td className="p-4 text-center font-mono text-zinc-400 font-medium">{brand.count} cases</td>
                            <td className="p-4 text-center font-bold text-emerald-400 font-mono">{brand.resolvedRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="p-4 text-[10px] text-[#71717a] bg-[#0a0a0b] border-t border-[#27272a] flex justify-between">
                    <span>Engine rate formula: (Resolved + Closed) / Total Brand Cases</span>
                    <span>Realtime sync</span>
                  </div>
                </div>

                {/* Top Categories Card */}
                <div className="bg-[#121214] border border-[#27272a] rounded-3xl p-5 shadow-lg lg:col-span-4 space-y-4">
                  <h3 className="text-xs font-extrabold text-white pb-2 border-b border-[#27272a] font-sans">Interactions Distribution by Category</h3>
                  <div className="space-y-3">
                    {monthlyData.topCategories.map((cat, idx) => (
                      <div key={cat.name} className="flex justify-between items-center text-xs">
                        <span className="text-zinc-300 font-medium flex items-center gap-1.5">
                          <span className="w-5 h-5 bg-blue-600/10 text-blue-400 rounded-full flex items-center justify-center font-mono font-bold text-[9px]">
                            {idx + 1}
                          </span>
                          {cat.name}
                        </span>
                        <span className="bg-[#0a0a0b] border border-[#27272a] text-zinc-400 px-2 py-0.5 rounded-lg font-mono font-bold">
                          {cat.count}
                        </span>
                      </div>
                    ))}
                    {monthlyData.topCategories.length === 0 && (
                      <p className="text-zinc-500 text-center py-6 text-[11px] font-sans">Insufficient telemetry details.</p>
                    )}
                  </div>
                </div>

              </div>
              
            </div>
          ) : null}
        </div>
      )}

    </div>
  );
}
