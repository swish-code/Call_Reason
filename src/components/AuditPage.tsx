import { useState } from "react";
import { User } from "../types.js";
import AuditUploads from "./AuditUploads.tsx";
import AuditActivity from "./AuditActivity.tsx";
import { UploadCloud, PhoneCall, Star, Gift } from "lucide-react";

// The Audit page: what was uploaded, and a full action log for surveys and for ratings & reviews.
type Tab = "uploads" | "surveys" | "ratings" | "offers";
const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: "uploads", label: "Uploads", icon: UploadCloud },
  { key: "surveys", label: "Surveys", icon: PhoneCall },
  { key: "ratings", label: "Ratings & Reviews", icon: Star },
  { key: "offers", label: "Shakir Campaign", icon: Gift },
];

export default function AuditPage({ currentUser }: { currentUser: User }) {
  const [tab, setTab] = useState<Tab>(() => {
    try { const t = sessionStorage.getItem("audit_tab"); return t === "surveys" || t === "ratings" || t === "offers" ? t : "uploads"; } catch { return "uploads"; }
  });
  const pick = (t: Tab) => { setTab(t); try { sessionStorage.setItem("audit_tab", t); } catch { /* remembering the tab is optional */ } };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-3">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => pick(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition ${tab === key ? "bg-blue-600/20 text-blue-300 border-blue-500/40" : "bg-[var(--surface)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)]"}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>
      {tab === "uploads" && <AuditUploads currentUser={currentUser} />}
      {tab === "surveys" && (
        <>
          <div className="px-1">
            <h2 className="text-lg font-extrabold text-[var(--heading)]">Survey activity</h2>
            <p className="text-[var(--muted)] text-xs mt-1">Every click on a survey: opened, saved, call attempts, assigned or reassigned (from → to), outcome edits, campaigns, templates and uploads.</p>
          </div>
          <AuditActivity area="surveys" />
        </>
      )}
      {tab === "ratings" && (
        <>
          <div className="px-1">
            <h2 className="text-lg font-extrabold text-[var(--heading)]">Ratings &amp; reviews activity</h2>
            <p className="text-[var(--muted)] text-xs mt-1">Every click on a rating or review: opened, status changes, call attempts, assignments, bulk actions, deletions and uploads.</p>
          </div>
          <AuditActivity area="ratings" />
        </>
      )}
      {tab === "offers" && (
        <>
          <div className="px-1">
            <h2 className="text-lg font-extrabold text-[var(--heading)]">Shakir Campaign activity</h2>
            <p className="text-[var(--muted)] text-xs mt-1">Every action in the offer campaign: uploads, assignments, calls (status before → after), orders with the discount used, removed orders, approvals and settings changes.</p>
          </div>
          <AuditActivity area="offers" />
        </>
      )}
    </div>
  );
}
