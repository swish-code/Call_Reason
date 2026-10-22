import { useState } from "react";
import { User } from "../types.js";
import NetSales from "./NetSales.tsx";
import TalabatReports, { STYLE } from "./TalabatReports.tsx";
import KeetaReports from "./KeetaReports.tsx";
import { BarChart3, ShoppingBag, Store } from "lucide-react";

// One admin-only page for the delivery platforms: the company-wide Net sales dashboard (Talabat + Keeta) and each
// platform's own reports (orders, partial refunds, cancellations).
type View = "all" | "talabat" | "keeta";
const VIEWS: { key: View; label: string; icon: any; color: string }[] = [
  { key: "all", label: "Net sales · all platforms", icon: BarChart3, color: "var(--t-aqua)" },
  { key: "talabat", label: "Talabat", icon: ShoppingBag, color: "var(--t-orange)" },
  { key: "keeta", label: "Keeta", icon: Store, color: "var(--t-violet)" },
];

export default function DeliveryPlatforms({ currentUser }: { currentUser: User }) {
  const [view, setView] = useState<View>(() => { try { const v = localStorage.getItem("delivery-platforms-view"); return v === "talabat" || v === "keeta" ? v : "all"; } catch { return "all"; } });
  const pick = (v: View) => { setView(v); try { localStorage.setItem("delivery-platforms-view", v); } catch { /* storage blocked */ } };
  return (
    <div className="tlb space-y-5 text-[var(--text)]">
      <style>{STYLE}</style>
      <div className="relative overflow-hidden bg-gradient-to-r from-[var(--surface)] via-[var(--surface-2)] to-[var(--bg)] border border-[var(--border)] p-5 rounded-3xl shadow-xl flex flex-wrap items-center gap-4">
        <div className="absolute -top-16 -right-10 w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none" style={{ background: "var(--t-violet)" }} />
        <div className="relative">
          <span className="text-xs font-bold px-3 py-1 rounded-full border" style={{ color: "var(--t-orange)", borderColor: "color-mix(in srgb, var(--t-orange) 40%, transparent)", background: "color-mix(in srgb, var(--t-orange) 12%, transparent)" }}>Delivery platforms · Admin only</span>
          <h1 className="text-2xl font-extrabold text-[var(--heading)] tracking-tight mt-2">Delivery Platforms</h1>
        </div>
        <span className="flex-1" />
        <div className="relative flex items-center gap-1 p-1 bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg flex-wrap" role="tablist">
          {VIEWS.map((v) => (
            <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => pick(v.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition ${view === v.key ? "text-white shadow-md" : "text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface-2)]"}`} style={view === v.key ? { background: v.color } : undefined}>
              <v.icon className="w-4 h-4" /> {v.label}
            </button>
          ))}
        </div>
      </div>
      {view === "all" && <NetSales />}
      {view === "talabat" && <TalabatReports currentUser={currentUser} />}
      {view === "keeta" && <KeetaReports />}
    </div>
  );
}
