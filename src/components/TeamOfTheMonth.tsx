import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { Trophy } from "lucide-react";

interface MemberStat { id: string; full_name: string; assigned: number; completed: number; pending: number; avgDurationSeconds: number; }
interface LeaderStat extends MemberStat { department: string | null; team: MemberStat[]; }
interface KpiData { summary: unknown; leaders: LeaderStat[]; }

const kwToday = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const kwMonthStart = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 7) + "-01";

// Shown on the main Dashboard (all roles, including agents, as team motivation) and on the
// Team Leader KPI page. Always the current calendar month, independent of any other filter
// on the page it's embedded in — it fetches its own data.
export default function TeamOfTheMonth() {
  const [champion, setChampion] = useState<LeaderStat | null>(null);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const monthStart = kwMonthStart(), today = kwToday();
        const res = await apiFetch(`/api/reports/team-leader-kpi?from=${monthStart}&to=${today}`);
        if (res.ok) {
          const data: KpiData = await res.json();
          const top = [...data.leaders].sort((a, b) => b.completed - a.completed)[0];
          setChampion(top && top.completed > 0 ? top : null);
        }
        setLabel(new Date(monthStart + "T00:00:00Z").toLocaleString("en-US", { month: "long", year: "numeric" }));
      } catch { /* silent — this widget is a bonus, never blocks the page it's on */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return null;

  if (!champion) return (
    <div className="bg-[var(--surface)] border border-dashed border-[var(--border)] rounded-3xl p-6 text-center text-[var(--muted)] text-sm">
      No completed tasks yet this month{label ? ` (${label})` : ""} — the Team of the Month will appear here once one comes in.
    </div>
  );

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-amber-500/15 via-amber-400/5 to-transparent border border-amber-500/30 rounded-3xl p-6 md:p-8 shadow-xl">
      <div className="flex items-start gap-4">
        <div className="p-4 rounded-2xl bg-amber-500/15 border border-amber-500/30 shrink-0"><Trophy className="w-8 h-8 text-amber-400" /></div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-amber-400 uppercase tracking-wide">Team of the Month · {label}</p>
          <h2 className="text-xl md:text-2xl font-extrabold text-[var(--heading)] mt-1">{champion.full_name}{champion.department ? ` · ${champion.department}` : ""}</h2>
          <p className="text-sm text-[var(--muted)] mt-1">
            {champion.completed} task{champion.completed === 1 ? "" : "s"} completed this month{champion.team.length ? `, leading a team of ${champion.team.length}` : ""}.
          </p>
          {champion.team.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {champion.team.map((m) => (
                <span key={m.id} className="px-2.5 py-1 bg-[var(--surface)] border border-[var(--border)] rounded-full text-[11px] font-bold text-[var(--text)]">{m.full_name}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
