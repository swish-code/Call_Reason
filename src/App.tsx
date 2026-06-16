import React, { useState, useEffect } from "react";
import { User, UserRole } from "./types.js";
import Dashboard from "./components/Dashboard.tsx";
import InteractionForm from "./components/InteractionForm.tsx";
import InteractionsList from "./components/InteractionsList.tsx";
import Reports from "./components/Reports.tsx";
import AdminSettings from "./components/AdminSettings.tsx";
import UsersManagement from "./components/UsersManagement.tsx";
import CallReason from "./components/CallReason.tsx";
import AgentLogs from "./components/AgentLogs.tsx";
import Configuration from "./components/Configuration.tsx";
import { apiFetch } from "./lib/api.ts";
import {
  Phone,
  PhoneCall,
  ClipboardList,
  SlidersHorizontal,
  BarChart3,
  History,
  FileText,
  Settings,
  LogOut,
  User as UserIcon,
  Lock,
  Building2,
  HelpCircle,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  ShieldAlert
} from "lucide-react";

type ActivePage = "dashboard" | "form" | "list" | "reports" | "settings" | "users" | "callreason" | "agentlogs" | "configuration";

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activePage, setActivePage] = useState<ActivePage>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Login inputs
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Check if session exists in localStorage
  useEffect(() => {
    const saved = localStorage.getItem("crm-user-session");
    if (saved) {
      try {
        setCurrentUser(JSON.parse(saved));
      } catch (e) {
        localStorage.removeItem("crm-user-session");
      }
    }
  }, []);

  // Submit log in authentication
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setLoginError("Please enter your email or username and password.");
      return;
    }

    try {
      setLoginLoading(true);
      setLoginError("");

      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to connect to the authentication server.");
      }

      const userData: User = await res.json();
      setCurrentUser(userData);
      localStorage.setItem("crm-user-session", JSON.stringify(userData));
      setActivePage("dashboard");
    } catch (err: any) {
      setLoginError(err.message || "Sorry, a network error occurred during login.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem("crm-user-session");
  };

  // Render Login page if not authenticated
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center p-4 relative overflow-hidden font-sans select-none text-[#e4e4e7]">
        
        {/* Background graphic designs */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600 rounded-full filter blur-3xl opacity-5 -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-900 rounded-full filter blur-3xl opacity-5 -ml-20 -mb-20"></div>

        <div className="w-full max-w-md bg-[#121214] border border-[#27272a] rounded-3xl overflow-hidden shadow-2xl relative z-10 p-6 md:p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-gradient-to-tr from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-blue-500/20">
              <Building2 className="w-8 h-8 text-white stroke-[2.2]" />
            </div>
            
            <h1 className="text-lg font-extrabold text-white tracking-tight">Advanced CRM & Support System</h1>
            <p className="text-xs text-[#71717a] font-light max-w-sm mx-auto">
              Portal for logging, managing communication interactions, and monitoring support tickets.
            </p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            {loginError && (
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-xs text-rose-300 font-bold flex items-center gap-2">
                <Lock className="w-4 h-4 shrink-0" />
                <p>{loginError}</p>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-300 block">Email or Username:</label>
              <input
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. admin or agent1@crm.com"
                className="w-full px-4 py-3 bg-[#1c1c1f] text-white placeholder:text-zinc-600 border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-600 focus:outline-none transition text-left text-[#e4e4e7]"
                dir="ltr"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-300 block">Password:</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-[#1c1c1f] text-white placeholder:text-zinc-600 border border-[#27272a] rounded-2xl text-xs focus:ring-2 focus:ring-blue-600 focus:outline-none transition text-left text-[#e4e4e7]"
                dir="ltr"
              />
            </div>

            <button
               type="submit"
               disabled={loginLoading}
               className="w-full py-3.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 text-white font-extrabold rounded-2xl text-xs transition duration-150 transform hover:scale-101 active:scale-95 shadow-lg shadow-blue-600/10"
            >
              {loginLoading ? "Verifying credentials..." : "Log In to System"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Get localized role string
  const getLocalizedRole = (role: UserRole) => {
    switch (role) {
      case "admin": return "System Admin (Admin)";
      case "leader": return "Team Leader (TL)";
      default: return "Support Agent (Agent)";
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0b] flex flex-col md:flex-row relative font-sans text-[#e4e4e7]">
      
      {/* ----------------------------------------------------
          Sidebar Menu navigation
          ---------------------------------------------------- */}
      <aside
        className={`bg-[#121214] text-[#e4e4e7] z-40 flex flex-col justify-between transition-all duration-300 shrink-0 ${
          sidebarOpen ? "w-64" : "w-0 md:w-20"
        } overflow-hidden border-r border-[#27272a] h-screen fixed md:sticky top-0`}
      >
        <div className="flex flex-col space-y-8 p-4">
          
          {/* Logo banner */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600/20 text-blue-400 border border-blue-500/20 rounded-xl flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            {sidebarOpen && (
              <div className="truncate">
                <h2 className="text-xs font-extrabold text-white leading-tight truncate">CRM Portal</h2>
                <span className="text-[10px] text-blue-400 font-bold block mt-0.5 leading-none">Local Edition</span>
              </div>
            )}
          </div>

          {/* User Session Profile Card */}
          <div className="bg-[#1c1c1f] border border-[#27272a] p-3 rounded-2xl flex items-center gap-2.5 overflow-hidden shrink-0">
            <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow shadow-blue-500/10">
              {currentUser.name.substring(0, 2)}
            </div>
            {sidebarOpen && (
              <div className="truncate text-left">
                <h4 className="text-[11px] font-bold text-white truncate leading-tight">{currentUser.name}</h4>
                <span className="text-[10px] text-emerald-400 font-bold block mt-0.5 leading-none">{getLocalizedRole(currentUser.role)}</span>
              </div>
            )}
          </div>

          {/* Nav Buttons links */}
          <nav className="flex flex-col gap-1">
            <button
              onClick={() => setActivePage("dashboard")}
              className={`w-full py-3 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
                activePage === "dashboard"
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-950/40"
                  : "text-[#71717a] hover:text-white hover:bg-[#1c1c1f]"
              }`}
            >
              <BarChart3 className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span className="truncate">Dashboard</span>}
            </button>

            <button
              onClick={() => setActivePage("form")}
              className={`w-full py-3 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
                activePage === "form"
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-950/40"
                  : "text-[#71717a] hover:text-white hover:bg-[#1c1c1f]"
              }`}
            >
              <Phone className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span className="truncate">Log New Interaction</span>}
            </button>

            <button
              onClick={() => setActivePage("list")}
              className={`w-full py-3 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
                activePage === "list"
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-950/40"
                  : "text-[#71717a] hover:text-white hover:bg-[#1c1c1f]"
              }`}
            >
              <History className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span className="truncate">Interaction Ledger</span>}
            </button>

            {/* Reports limited to Admin & TL */}
            {currentUser?.role !== "agent" && (
              <button
                onClick={() => setActivePage("reports")}
                className={`w-full py-3 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
                  activePage === "reports"
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-950/40"
                    : "text-[#71717a] hover:text-white hover:bg-[#1c1c1f]"
                }`}
              >
                <FileText className="w-4 h-4 shrink-0" />
                {sidebarOpen && <span className="truncate">Reports & CSV Export</span>}
              </button>
            )}

            {/* Options limited to Admin & TL */}
            {currentUser?.role !== "agent" && (
              <button
                onClick={() => setActivePage("settings")}
                className={`w-full py-3 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
                  activePage === "settings"
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-950/40"
                    : "text-[#71717a] hover:text-white hover:bg-[#1c1c1f]"
                }`}
              >
                <Settings className="w-4 h-4 shrink-0" />
                {sidebarOpen && <span className="truncate">Settings & Brands</span>}
              </button>
            )}

            {/* Users Management: Strictly LIMITED to Admin */}
            {currentUser?.role === "admin" && (
              <button
                onClick={() => setActivePage("users")}
                className={`w-full py-3 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
                  activePage === "users"
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-950/40"
                    : "text-[#71717a] hover:text-white hover:bg-[#1c1c1f]"
                }`}
              >
                <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
                {sidebarOpen && <span className="truncate text-amber-200">User Management</span>}
              </button>
            )}

            {/* Call Reason: Admin only */}
            {currentUser?.role === "admin" && (
              <button
                onClick={() => setActivePage("callreason")}
                className={`w-full py-3 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
                  activePage === "callreason"
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-950/40"
                    : "text-[#71717a] hover:text-white hover:bg-[#1c1c1f]"
                }`}
              >
                <PhoneCall className="w-4 h-4 shrink-0" />
                {sidebarOpen && <span className="truncate">Call Reason</span>}
              </button>
            )}

            {/* Agent Logs: Admin only */}
            {currentUser?.role === "admin" && (
              <button
                onClick={() => setActivePage("agentlogs")}
                className={`w-full py-3 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
                  activePage === "agentlogs"
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-950/40"
                    : "text-[#71717a] hover:text-white hover:bg-[#1c1c1f]"
                }`}
              >
                <ClipboardList className="w-4 h-4 shrink-0" />
                {sidebarOpen && <span className="truncate">Agent Logs</span>}
              </button>
            )}

            {/* Configuration: Admin only */}
            {currentUser?.role === "admin" && (
              <button
                onClick={() => setActivePage("configuration")}
                className={`w-full py-3 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
                  activePage === "configuration"
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-950/40"
                    : "text-[#71717a] hover:text-white hover:bg-[#1c1c1f]"
                }`}
              >
                <SlidersHorizontal className="w-4 h-4 shrink-0" />
                {sidebarOpen && <span className="truncate">Configuration</span>}
              </button>
            )}
          </nav>
        </div>

        {/* Logout bottom */}
        <div className="p-4 border-t border-[#27272a]">
          <button
            onClick={handleLogout}
            className="w-full py-3 px-3.5 rounded-xl text-xs font-bold text-[#71717a] hover:text-rose-400 hover:bg-rose-500/10 transition flex items-center gap-3 active:scale-95"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span className="truncate">Log Out</span>}
          </button>
        </div>
      </aside>

      {/* ----------------------------------------------------
          Main Page Content area
          ---------------------------------------------------- */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        
        {/* Top Navbar Header */}
        <header className="sticky top-0 bg-[#0a0a0b]/85 backdrop-blur-md border-b border-[#27272a] p-4 flex items-center justify-between z-30 print:hidden shadow-xs">
          
          <div className="flex items-center gap-3">
            {/* Toggle sidebar button */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-[#1c1c1f] rounded-xl transition active:scale-90"
            >
              <Menu className="w-4 h-4 text-[#e4e4e7]" />
            </button>

            <h1 className="text-xs md:text-sm font-extrabold text-[#e4e4e7]">
              {activePage === "dashboard" && "Dashboard Overview"}
              {activePage === "form" && "Interaction Logging Form"}
              {activePage === "list" && "Interactions Log Directory"}
              {activePage === "reports" && "Analytic Reports & Performance Export"}
              {activePage === "settings" && "Brand and Category Configuration"}
              {activePage === "users" && "User and Access Role Management"}
              {activePage === "callreason" && "Call Reason — Log a Call"}
              {activePage === "agentlogs" && "Agent Logs by Team"}
              {activePage === "configuration" && "System Configuration"}
            </h1>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {/* Role indicator banner */}
            <div className="hidden sm:flex items-center gap-1.5 bg-[#121214] text-blue-400 px-3.5 py-1.5 rounded-2xl border border-[#27272a]/80 font-bold">
              <UserCheck className="w-3.5 h-3.5" />
              <span>Logged in as: <strong>{getLocalizedRole(currentUser.role)}</strong></span>
            </div>
            
            <button
              onClick={handleLogout}
              className="p-2 bg-[#121214] hover:bg-rose-500/10 text-[#71717a] hover:text-rose-400 border border-[#27272a] rounded-xl transition active:scale-95"
              title="Quick Log Out"
            >
              <LogOut className="w-4.5 h-4.5 md:w-3.5 md:h-3.5" />
            </button>
          </div>
        </header>

        {/* Dynamic Main view switcher */}
        <main className="p-4 md:p-8 flex-1 max-w-7xl mx-auto w-full">
          {activePage === "dashboard" && (
            <Dashboard onNavigateToForm={() => setActivePage("form")} />
          )}
          {activePage === "form" && (
            <InteractionForm currentUser={currentUser} onSuccess={() => setActivePage("list")} />
          )}
          {activePage === "list" && (
            <InteractionsList currentUser={currentUser} />
          )}
          {activePage === "reports" && (
            <Reports currentUser={currentUser} />
          )}
          {activePage === "settings" && (
            <AdminSettings currentUser={currentUser} />
          )}
          {activePage === "users" && (
            <UsersManagement currentUser={currentUser} />
          )}
          {activePage === "callreason" && (
            <CallReason currentUser={currentUser} onSuccess={() => setActivePage("agentlogs")} />
          )}
          {activePage === "agentlogs" && (
            <AgentLogs currentUser={currentUser} />
          )}
          {activePage === "configuration" && (
            <Configuration currentUser={currentUser} />
          )}
        </main>
      </div>

    </div>
  );
}
