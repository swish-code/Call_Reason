import { useState } from "react";
import { Clock, Download } from "lucide-react";
import { apiFetch } from "../lib/api.ts";
import { downloadXlsx } from "../lib/xlsx.ts";

// Best time to call: when customers pick up. Our outbound calls of the period by Kuwait hour (and weekday), with the share
// that was answered. "Answered" = the customer picked up (call back later, not interested, accepted, ordered); no answer,
// busy / switched off and wrong number are not.
export interface Slot { dow: number; hour: number; calls: number; answered: number }

const MIN_CALLS = 5;                                   // fewer calls than this is too little to rank an hour
const DAYS: [number, string][] = [[6, "Sat"], [0, "Sun"], [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"]];   // Kuwait week starts Saturday
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export default function OfferBestTime({ slots, from, to, campId, periodText }: { slots: Slot[]; from: string; to: string; campId: string; periodText: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const byHour = new Map<number, { calls: number; answered: number }>();
  for (const s of slots) { const h = byHour.get(s.hour) || { calls: 0, answered: 0 }; h.calls += s.calls; h.answered += s.answered; byHour.set(s.hour, h); }
  const hours = [...byHour.keys()].sort((a, b) => a - b);
  const lo = hours.length ? hours[0] : 9, hi = hours.length ? hours[hours.length - 1] : 21;
  const all: number[] = []; for (let h = lo; h <= hi; h++) all.push(h);
  const total = slots.reduce((a, s) => a + s.calls, 0), answered = slots.reduce((a, s) => a + s.answered, 0);
  const ranked = hours.map((h) => ({ h, ...byHour.get(h)! })).filter((x) => x.calls >= MIN_CALLS).sort((a, b) => b.answered / b.calls - a.answered / a.calls || b.calls - a.calls);
  const best = ranked.slice(0, 3);
  const bestH = new Set(best.map((x) => x.h));
  const cell = new Map(slots.map((s) => [`${s.dow}:${s.hour}`, s]));

  const exportCalls = async () => {
    setBusy(true); setErr("");
    try {
      const res = await apiFetch(`/api/offer-campaigns/${campId}/calls?from=${from}&to=${to}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error || "Could not load the calls."); return; }
      await downloadXlsx(
        ["Date", "Time (Kuwait)", "Day", "Customer", "Phone", "Agent", "Direction", "Result", "Answered", "Churn reason", "Comment"],
        d.rows.map((r: any) => [r.date, r.time, r.weekday, r.customer_name || "", r.phone, r.agent || "", r.direction, r.result || r.call_status, r.answered ? "Yes" : "No", r.churn_reason || "", r.comment || ""]),
        `Shakir_calls_${from}_${to}`, "Calls");
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-3xl p-6 bg-[var(--surface)] border border-[var(--border)] shadow-lg">
      <div className="flex flex-wrap items-start gap-3">
        <div className="p-2 bg-sky-500/10 text-sky-500 rounded-xl"><Clock className="w-5 h-5" /></div>
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold text-[var(--heading)]">Best time to call</h3>
          <p className="text-[11px] text-[var(--muted)]">{periodText}. Our outbound calls by hour (Kuwait time) and how many customers picked up. Hours with fewer than {MIN_CALLS} calls are too thin to rank.</p>
        </div>
        <button onClick={exportCalls} disabled={busy} title="Every call of the period with its date and time" className="ml-auto px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600/20 text-emerald-500 border border-emerald-500/30 disabled:opacity-50 flex items-center gap-1"><Download className="w-3.5 h-3.5" /> {busy ? "Preparing…" : "Calls (Excel)"}</button>
      </div>
      {err && <div className="mt-3 text-[11px] text-rose-400">{err}</div>}

      {!total ? <div className="text-xs text-[var(--muted)] py-8 text-center">No outbound calls in this period yet.</div> : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {best.length ? best.map((x, i) => (
              <span key={x.h} className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-600">
                {i === 0 ? "Best: " : ""}{hh(x.h)}–{hh(x.h + 1)} · {pct(x.answered, x.calls)}% answered <span className="font-normal opacity-70">({x.answered}/{x.calls})</span>
              </span>
            )) : <span className="text-[11px] text-[var(--muted)]">Not enough calls in any single hour yet to name a best time.</span>}
            <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-[var(--surface-2)] text-[var(--text)]">Overall {pct(answered, total)}% answered <span className="font-normal opacity-70">({answered}/{total})</span></span>
          </div>

          <div className="mt-5 overflow-x-auto">
            <div className="min-w-[560px]">
              <div className="flex items-end gap-1.5 h-40">
                {all.map((h) => {
                  const v = byHour.get(h), r = v ? pct(v.answered, v.calls) : 0, thin = !v || v.calls < MIN_CALLS;
                  return (
                    <div key={h} className="flex-1 flex flex-col items-center justify-end h-full min-w-0" title={v ? `${hh(h)}–${hh(h + 1)}: ${v.answered} answered of ${v.calls} calls (${r}%)` : `${hh(h)}: no calls`}>
                      <span className="text-[10px] tabular-nums text-[var(--muted)] mb-1">{v ? `${r}%` : ""}</span>
                      <div className="w-full rounded-t-lg transition-[height] duration-700" style={{ height: `${Math.max(v ? 4 : 0, r * 0.95)}%`, background: bestH.has(h) ? "linear-gradient(180deg,#34d399,#059669)" : thin ? "var(--surface-2)" : "linear-gradient(180deg,#60a5fa,#2563eb)", border: thin && v ? "1px dashed var(--border)" : undefined }} />
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-1.5 mt-1">
                {all.map((h) => <div key={h} className="flex-1 min-w-0 text-center"><div className="text-[10px] text-[var(--muted)] tabular-nums">{String(h).padStart(2, "0")}</div><div className="text-[9px] text-[var(--muted)]/70 tabular-nums">{byHour.get(h)?.calls ?? 0}</div></div>)}
              </div>
              <p className="text-[10px] text-[var(--muted)] mt-1">Bars: share answered. Under each hour: how many calls we made. Green = the best hours, dashed = too few calls.</p>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            <p className="text-xs font-extrabold text-[var(--heading)] mb-2">By weekday and hour <span className="font-normal text-[var(--muted)]">— answered / calls</span></p>
            <table className="text-[10px] border-separate border-spacing-1">
              <thead><tr><th />{all.map((h) => <th key={h} className="font-bold text-[var(--muted)] tabular-nums min-w-9">{String(h).padStart(2, "0")}</th>)}</tr></thead>
              <tbody>
                {DAYS.map(([dow, name]) => (
                  <tr key={dow}>
                    <td className="font-bold text-[var(--muted)] pr-2">{name}</td>
                    {all.map((h) => {
                      const c = cell.get(`${dow}:${h}`);
                      const r = c ? c.answered / c.calls : 0;
                      return <td key={h} title={c ? `${name} ${hh(h)}: ${c.answered} answered of ${c.calls} (${pct(c.answered, c.calls)}%)` : ""}
                        className="h-8 rounded-md text-center tabular-nums" style={{ background: !c ? "transparent" : c.calls < 3 ? "var(--surface-2)" : `rgba(16,185,129,${0.12 + r * 0.7})`, color: c && c.calls >= 3 && r > 0.55 ? "#fff" : "var(--text)" }}>
                        {c ? `${c.answered}/${c.calls}` : ""}
                      </td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
