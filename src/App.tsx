import React, { useState, useEffect } from "react";
import { User, UserRole } from "./types.js";
import UsersManagement from "./components/UsersManagement.tsx";
import Configuration from "./components/Configuration.tsx";
import OpsLogForm from "./components/OpsLogForm.tsx";
import OpsLogsList from "./components/OpsLogsList.tsx";
import OpsDashboard from "./components/OpsDashboard.tsx";
import OpsReports from "./components/OpsReports.tsx";
import HistoryLogs from "./components/HistoryLogs.tsx";
import { apiFetch } from "./lib/api.ts";
import {
  Phone,
  PhoneCall,
  ClipboardList,
  FilePlus2,
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
  ShieldAlert,
  Loader2,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Zap,
  BarChart2
} from "lucide-react";

type ActivePage = "dashboard" | "reports" | "users" | "configuration" | "newlog" | "logs" | "history";

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activePage, setActivePage] = useState<ActivePage>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Login inputs
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
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
      <div className="min-h-screen bg-[#050506] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden font-sans select-none text-[#e4e4e7]">

        {/* Animated ambient background */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-32 -right-24 w-[34rem] h-[34rem] bg-blue-600 rounded-full filter blur-[140px] opacity-20 animate-pulse"></div>
          <div className="absolute -bottom-40 -left-24 w-[34rem] h-[34rem] bg-indigo-700 rounded-full filter blur-[140px] opacity-15 animate-pulse" style={{ animationDelay: "1.2s" }}></div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] bg-sky-500 rounded-full filter blur-[160px] opacity-[0.07]"></div>
          {/* subtle grid */}
          <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "44px 44px" }}></div>
        </div>

        <div className="w-full max-w-5xl grid lg:grid-cols-2 bg-[#0d0d0f]/80 backdrop-blur-2xl border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl shadow-black/60 relative z-10 animate-fade-in">

          {/* Left — brand / marketing panel */}
          <div className="hidden lg:flex flex-col justify-between p-10 relative bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-900 overflow-hidden">
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, #fff 1px, transparent 1px)", backgroundSize: "26px 26px" }}></div>
            <div className="absolute -bottom-20 -right-20 w-72 h-72 bg-white/10 rounded-full blur-2xl"></div>

            <div className="relative z-10">
              <div className="w-14 h-14 bg-white/15 backdrop-blur rounded-2xl flex items-center justify-center border border-white/20 shadow-lg">
                <Building2 className="w-7 h-7 text-white stroke-[2.2]" />
              </div>
              <h2 className="text-3xl font-black text-white mt-8 leading-tight tracking-tight">Swish Tasks</h2>
              <p className="text-blue-100/80 text-sm mt-4 font-light leading-relaxed max-w-xs">
                One workspace for your call center, technical and complaints teams — log activities, track performance, and stay in control.
              </p>
            </div>

            <div className="relative z-10 space-y-4 mt-10">
              {[
                { icon: Zap, t: "Fast department-scoped logging" },
                { icon: BarChart2, t: "Live dashboards & KPIs" },
                { icon: ShieldCheck, t: "Full audit trail & role access" },
              ].map((f) => (
                <div key={f.t} className="flex items-center gap-3 text-white/90">
                  <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0"><f.icon className="w-4.5 h-4.5" /></div>
                  <span className="text-sm font-medium">{f.t}</span>
                </div>
              ))}
            </div>

            <div className="relative z-10 text-[11px] text-blue-100/50 font-medium mt-10">© {new Date().getFullYear()} Swish Tasks · Secure Access</div>
          </div>

          {/* Right — login form */}
          <div className="p-8 sm:p-10 md:p-12 flex flex-col justify-center">
            {/* Mobile logo */}
            <div className="lg:hidden flex items-center gap-3 mb-8">
              <div className="w-12 h-12 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Building2 className="w-6 h-6 text-white stroke-[2.2]" />
              </div>
              <span className="text-lg font-black text-white tracking-tight">Swish Tasks</span>
            </div>

            <div className="mb-8">
              <h1 className="text-2xl font-black text-white tracking-tight">Welcome back</h1>
              <p className="text-sm text-[#71717a] mt-1.5 font-light">Sign in to continue to your workspace.</p>
            </div>

            <form onSubmit={handleLoginSubmit} className="space-y-5">
              {loginError && (
                <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-xs text-rose-300 font-bold flex items-center gap-2 animate-fade-in">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <p>{loginError}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-300 block">Username</label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-zinc-500 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your username"
                    className="w-full pl-11 pr-4 py-3.5 bg-[#16161a] text-white placeholder:text-zinc-600 border border-[#27272a] rounded-2xl text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none transition"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-300 block">Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-500 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPwd ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-11 pr-11 py-3.5 bg-[#16161a] text-white placeholder:text-zinc-600 border border-[#27272a] rounded-2xl text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none transition"
                    dir="ltr"
                  />
                  <button type="button" onClick={() => setShowPwd((s) => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition" tabIndex={-1}>
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="group w-full py-3.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:opacity-60 text-white font-extrabold rounded-2xl text-sm transition duration-150 active:scale-[0.98] shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2"
              >
                {loginLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</>
                ) : (
                  <>Log In to System <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" /></>
                )}
              </button>
            </form>

            <p className="text-[11px] text-zinc-600 mt-8 text-center">Protected system · authorized personnel only</p>
          </div>
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
                <h2 className="text-xs font-extrabold text-white leading-tight truncate">Swish Tasks</h2>
                <span className="text-[10px] text-blue-400 font-bold block mt-0.5 leading-none">Operations & Logs</span>
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
              onClick={() => setActivePage("newlog")}
              className={`w-full py-3 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
                activePage === "newlog"
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-950/40"
                  : "text-[#71717a] hover:text-white hover:bg-[#1c1c1f]"
              }`}
            >
              <FilePlus2 className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span className="truncate">New Log</span>}
            </button>

            <button
              onClick={() => setActivePage("logs")}
              className={`w-full py-3 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
                activePage === "logs"
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-950/40"
                  : "text-[#71717a] hover:text-white hover:bg-[#1c1c1f]"
              }`}
            >
              <ClipboardList className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span className="truncate">{currentUser.role === "agent" ? "My Logs" : currentUser.role === "leader" ? "Department Logs" : "All Logs"}</span>}
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
                {sidebarOpen && <span className="truncate">Reports & Export</span>}
              </button>
            )}

            {/* History Logs (audit) limited to Admin & TL */}
            {currentUser?.role !== "agent" && (
              <button
                onClick={() => setActivePage("history")}
                className={`w-full py-3 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
                  activePage === "history"
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-950/40"
                    : "text-[#71717a] hover:text-white hover:bg-[#1c1c1f]"
                }`}
              >
                <History className="w-4 h-4 shrink-0" />
                {sidebarOpen && <span className="truncate">History Logs</span>}
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
              {activePage === "reports" && "Reports & Export"}
              {activePage === "users" && "User and Access Role Management"}
              {activePage === "configuration" && "System Configuration"}
              {activePage === "newlog" && "New Log"}
              {activePage === "logs" && "Operations Logs"}
              {activePage === "history" && "History Logs — Audit Trail"}
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
            <OpsDashboard currentUser={currentUser} />
          )}
          {activePage === "reports" && (
            <OpsReports currentUser={currentUser} />
          )}
          {activePage === "history" && (
            <HistoryLogs currentUser={currentUser} />
          )}
          {activePage === "users" && (
            <UsersManagement currentUser={currentUser} />
          )}
          {activePage === "configuration" && (
            <Configuration currentUser={currentUser} />
          )}
          {activePage === "newlog" && (
            <OpsLogForm currentUser={currentUser} onDone={() => setActivePage("logs")} />
          )}
          {activePage === "logs" && (
            <OpsLogsList currentUser={currentUser} />
          )}
        </main>
      </div>

    </div>
  );
}
