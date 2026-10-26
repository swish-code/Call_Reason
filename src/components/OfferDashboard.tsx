import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { apiFetch } from "../lib/api.ts";
import { OfferCampaign as Campaign, kwToday, stepLabel } from "../lib/offers.ts";
import { Card as ChartCard, GroupedColumns, STYLE as CHART_STYLE, C as CC, type Series } from "./SurveyCharts.tsx";
import { RefreshCw, AlertCircle, PhoneOutgoing, PhoneIncoming, UploadCloud, Sparkles, UserX, Hourglass, CalendarX2, CheckCircle2 } from "lucide-react";

// The campaign dashboard (team leaders and up).
//  - The period: what the calls did, as a funnel (calls ⊇ reached ⊇ accepted — all calls made in the period), and
//    the offer orders by discount step, drawn as a staircase where each step is as tall as its discount.
//  - Right now: where every customer of the campaign stands (each counted once), and what needs a leader.
//  - The agents, and why customers stopped ordering.
// Days are Kuwait days. Numbers count up and bars grow when they change; reduced motion turns that off.

const STYLE = `
.odb { --nc:#d8dee8; --glow:rgba(251,146,60,.22); }
.dark .odb { --nc:#34343a; --glow:rgba(251,146,60,.14); }
@keyframes odb-drift { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-40px,24px) scale(1.15); } }
.odb-drift { animation: odb-drift 14s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .odb-drift { animation: none; } }
`;
// Grain for the vivid panel (an SVG noise tile).
const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`;

// The discount steps get warmer as they climb.
const HEAT = [["#fbbf24", "#f59e0b"], ["#fb923c", "#ea580c"], ["#f43f5e", "#e11d48"], ["#e11d48", "#be123c"], ["#be123c", "#9f1239"]];

// Where a customer stands, wins first, still-in-play in the middle, lost last.
const GROUPS: { label: string; statuses: string[]; color: string }[] = [
  { label: "Ordered", statuses: ["ordered"], color: "#7c3aed" },
  { label: "Accepted the offer", statuses: ["accepted"], color: "#10b981" },
  { label: "Call back later", statuses: ["call_back"], color: "#06b6d4" },
  { label: "No answer / busy", statuses: ["no_answer", "busy"], color: "#60a5fa" },
  { label: "Not called yet", statuses: ["not_called"], color: "var(--nc)" },
  { label: "Not interested", statuses: ["not_interested"], color: "#fb7185" },
  { label: "Wrong number", statuses: ["wrong_number"], color: "#64748b" },
];
const AVATAR = ["#7c3aed", "#0891b2", "#ea580c", "#059669", "#db2777", "#2563eb", "#ca8a04"];
const avatarColor = (name: string) => AVATAR[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR.length];
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** A number that counts from its last value to the new one. */
function useCountUp(value: number, ms = 900) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const cur = useRef(reduce ? value : 0);
  useEffect(() => {
    if (reduce) { cur.current = value; setShown(value); return; }
    const a = cur.current, start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms), e = 1 - Math.pow(1 - p, 3);
      cur.current = Math.round(a + (value - a) * e);
      setShown(cur.current);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, reduce]);
  return shown;
}
const Num = ({ v, className }: { v: number; className?: string }) => <span className={`tabular-nums ${className || ""}`}>{useCountUp(v || 0).toLocaleString()}</span>;

/** True one frame after mount, so widths/heights can grow from 0. */
function useGrown() {
  const [grown, setGrown] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setGrown(true)); return () => cancelAnimationFrame(r); }, []);
  return grown;
}
const GROW = "transition-[width,height] duration-[900ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none";

const inputCls = "px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-violet-500 focus:outline-none";
const PRESETS: [string, string][] = [["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["month", "This month"]];

export default function OfferDashboard({ camp, tick }: { camp: Campaign; tick: number }) {
  const today = kwToday();
  const [range, setRange] = useState({ from: today, to: today, preset: "today" });
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const grown = useGrown();
  const load = useCallback(async () => {
    try {
      setLoading(true); setError("");
      const res = await apiFetch(`/api/offer-campaigns/${camp.id}/dashboard?from=${range.from}&to=${range.to}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load the dashboard.");
      setD(await res.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [camp.id, range.from, range.to]);
  useEffect(() => { load(); }, [load, tick]);
  const preset = (p: string) => {
    const t = kwToday(), dt = new Date(t + "T00:00:00Z");
    const back = (n: number) => new Date(dt.getTime() - n * 86400_000).toISOString().slice(0, 10);
    if (p === "today") setRange({ from: t, to: t, preset: p });
    if (p === "yesterday") setRange({ from: back(1), to: back(1), preset: p });
    if (p === "week") setRange({ from: back((dt.getUTCDay() + 1) % 7), to: t, preset: p });          // Kuwait week starts Saturday
    if (p === "month") setRange({ from: t.slice(0, 8) + "01", to: t, preset: p });
  };
  const inRange = (day: string) => day >= range.from && day <= range.to;
  const sum = (k: string) => (d?.days || []).filter((x: any) => inRange(x.day)).reduce((a: number, x: any) => a + (x[k] || 0), 0);
  const steps: number[] = d?.campaign?.steps || camp.steps;
  const periodText = PRESETS.find(([k]) => k === range.preset)?.[1] || (range.from === range.to ? dayText(range.from) : `${dayText(range.from)} – ${dayText(range.to)}`);
  const t = d?.totals || {};

  const calls = sum("calls"), reached = sum("reached"), accepted = sum("accepted");
  const stepCounts = steps.map((_s, i) => sum(`o${i + 1}`));
  const ordersTotal = stepCounts.reduce((a, b) => a + b, 0);
  const value = sum("value");

  const cats = (d?.days || []).map((x: any) => ({ key: x.day, label: String(Number(x.day.slice(8, 10))) }));
  const dayMap = new Map((d?.days || []).map((x: any) => [x.day, x]));
  const S_CALLS: Series[] = [{ key: "calls", label: "Calls", color: CC.blue }, { key: "reached", label: "Reached", color: CC.aqua }, { key: "accepted", label: "Accepted / ordered", color: CC.orange }];
  const S_ORDERS: Series[] = steps.map((s, i) => ({ key: `o${i + 1}`, label: `${s}% orders`, color: (HEAT[i] || HEAT[HEAT.length - 1])[1] }));

  return (
    <section className="space-y-5 svc odb">
      <style>{CHART_STYLE + STYLE}</style>

      {/* period */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex max-w-full overflow-x-auto p-1 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-sm">
          {PRESETS.map(([k, l]) => (
            <button key={k} onClick={() => preset(k)} className={`relative px-3 sm:px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-violet-500 ${range.preset === k ? "text-white" : "text-[var(--muted)] hover:text-[var(--heading)]"}`}>
              {range.preset === k && <motion.span layoutId="odb-period" className="absolute inset-0 rounded-xl bg-violet-600 shadow-md shadow-violet-600/30" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span className="relative">{l}</span>
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">From<input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value, preset: "" })} className={inputCls} /></label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">To<input type="date" value={range.to} min={range.from} max={today} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value, preset: "" })} className={inputCls} /></label>
        <button onClick={load} title="Refresh" className="ml-auto p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--heading)]"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
      </div>
      {error && <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}

      {!d ? <Skeleton /> : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
            {/* the call funnel — the one loud surface on the page */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
              className="xl:col-span-3 relative overflow-hidden rounded-3xl p-6 sm:p-7 text-white shadow-xl shadow-violet-900/20"
              style={{ background: "radial-gradient(120% 150% at 0% 0%, #8b5cf6 0%, #6d28d9 38%, #3b1d8f 72%, #24145e 100%)" }}>
              <div className="odb-drift pointer-events-none absolute -right-24 -top-28 w-80 h-80 rounded-full bg-fuchsia-400/35 blur-3xl" />
              <div className="pointer-events-none absolute -left-20 bottom-[-6rem] w-72 h-72 rounded-full bg-sky-400/20 blur-3xl" />
              <div className="pointer-events-none absolute inset-0 opacity-[0.14] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
              <div className="relative">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-extrabold">Calls, {range.preset ? periodText.toLowerCase() : periodText}</h2>
                  <span className="text-[11px] text-white/60">Counted on the day the call was made, Kuwait time</span>
                </div>
                <div className="mt-6 space-y-5">
                  <FunnelRow n={calls} label="Calls made" width={calls ? 100 : 0} color="#ffffff" grown={grown} delay={0} />
                  <FunnelRow n={reached} label="Reached the customer" note={calls ? `${pctOf(reached, calls)}% of calls` : ""} width={calls ? (reached / calls) * 100 : 0} color="#5eead4" grown={grown} delay={120} />
                  <FunnelRow n={accepted} label="Accepted the offer" note={reached ? `${pctOf(accepted, reached)}% of reached` : ""} width={calls ? (accepted / calls) * 100 : 0} color="#fcd34d" grown={grown} delay={240} />
                </div>
                <div className="mt-7 flex flex-wrap gap-2">
                  <Chip icon={Sparkles} n={sum("first_calls")} text="first calls" />
                  <Chip icon={PhoneOutgoing} n={sum("outbound")} text="we called" />
                  <Chip icon={PhoneIncoming} n={sum("inbound")} text="called us" />
                  <Chip icon={UploadCloud} n={sum("uploaded")} text="customers uploaded" />
                </div>
              </div>
            </motion.div>

            {/* the offer ladder */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.15 }}
              className="xl:col-span-2 relative overflow-hidden rounded-3xl p-6 sm:p-7 bg-[var(--surface)] border border-[var(--border)] shadow-lg">
              <div className="pointer-events-none absolute -right-20 -top-20 w-64 h-64 rounded-full blur-3xl" style={{ background: "var(--glow)" }} />
              <div className="relative h-full flex flex-col">
                <h2 className="text-lg font-extrabold text-[var(--heading)]">Orders with the offer</h2>
                <p className="text-[11px] text-[var(--muted)]">{periodText}, by the order date. Each step is as tall as its discount.</p>
                <div className="flex-1 flex items-end gap-3 mt-5 min-h-[13rem]">
                  {steps.map((s, i) => {
                    const [c1, c2] = HEAT[i] || HEAT[HEAT.length - 1];
                    const max = Math.max(...steps);
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center justify-end">
                        <Num v={stepCounts[i]} className="text-3xl font-extrabold text-[var(--heading)] leading-none" />
                        <span className="text-[10px] text-[var(--muted)] mt-1 mb-2">{stepCounts[i] === 1 ? "order" : "orders"}</span>
                        <div className={`w-full rounded-t-2xl relative overflow-hidden ${GROW}`} style={{ height: grown ? `${Math.max(2.25, (s / max) * 8.5)}rem` : 0, background: `linear-gradient(180deg, ${c1}, ${c2})`, transitionDelay: `${200 + i * 140}ms`, boxShadow: `0 10px 24px -12px ${c2}` }}>
                          <span className="absolute top-2 inset-x-0 text-center text-white font-extrabold text-base drop-shadow-sm">{s}%</span>
                        </div>
                        <span className="text-[11px] font-bold text-[var(--text)] mt-2">{stepLabel(i + 1)} order</span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-3 border-t border-[var(--border)] flex flex-wrap items-baseline justify-between gap-2 text-xs">
                  <span className="text-[var(--muted)]"><Num v={ordersTotal} className="text-base font-extrabold text-[var(--heading)]" /> offer {ordersTotal === 1 ? "order" : "orders"} in total</span>
                  {value > 0 && <span className="text-[var(--muted)]">worth <b className="text-[var(--heading)]">{value.toFixed(3)} KWD</b></span>}
                </div>
              </div>
            </motion.div>
          </div>

          <RightNow t={t} grown={grown} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <ChartCard reset={d} title="Calls per day" sub={`${dayText(d.window.from)} – ${dayText(d.window.to)}`} legend={S_CALLS}
              table={{ head: ["Day", ...S_CALLS.map((s) => s.label)], rows: d.days.map((x: any) => [x.day, ...S_CALLS.map((s) => String(x[s.key]))]) }}>
              {(setTip) => <GroupedColumns cats={cats} series={S_CALLS} value={(c, s) => (dayMap.get(c) as any)?.[s] || 0} selected={inRange} setTip={setTip} />}
            </ChartCard>
            <ChartCard reset={d} title="Offer orders per day" sub="By discount step, on the order date" legend={S_ORDERS}
              table={{ head: ["Day", ...S_ORDERS.map((s) => s.label)], rows: d.days.map((x: any) => [x.day, ...S_ORDERS.map((s) => String(x[s.key]))]) }}>
              {(setTip) => <GroupedColumns cats={cats} series={S_ORDERS} value={(c, s) => (dayMap.get(c) as any)?.[s] || 0} selected={inRange} setTip={setTip} />}
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <Agents agents={d.agents} grown={grown} periodText={periodText} />
            <Churn churn={d.churn} grown={grown} periodText={periodText} />
          </div>
        </>
      )}
    </section>
  );
}

function FunnelRow({ n, label, note, width, color, grown, delay }: { n: number; label: string; note?: string; width: number; color: string; grown: boolean; delay: number }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] sm:grid-cols-[5.5rem_1fr] items-end gap-4">
      <Num v={n} className="text-4xl sm:text-5xl font-extrabold leading-[0.9] text-right" />
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-1.5">
          <span className="text-sm font-bold text-white/90">{label}</span>
          {note && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/15 text-white">{note}</span>}
        </div>
        <div className="h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,.12)" }}>
          <div className={`h-full rounded-full ${GROW}`} style={{ width: grown ? `${width}%` : 0, background: color, transitionDelay: `${delay}ms`, boxShadow: `0 0 16px ${color}66` }} />
        </div>
      </div>
    </div>
  );
}

function Chip({ icon: Icon, n, text }: { icon: any; n: number; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-2 pr-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-xs text-white/80">
      <Icon className="w-3.5 h-3.5 text-white/70" /><Num v={n} className="font-extrabold text-white" /> {text}
    </span>
  );
}

// ---------------------------------------------------------------- the whole campaign, right now
function RightNow({ t, grown }: { t: any; grown: boolean }) {
  const total = t.customers || 0;
  const by = t.by_status || {};
  const groups = GROUPS.map((g) => ({ ...g, n: g.statuses.reduce((a, s) => a + (by[s] || 0), 0) }));
  const alerts = [
    { n: t.unassigned || 0, text: "without an agent", hint: "Give them out under Customers.", icon: UserX, tone: "amber" },
    { n: t.expiring_3d || 0, text: t.expiring_3d === 1 ? "offer ends within 3 days" : "offers end within 3 days", hint: "Remind them before it runs out.", icon: Hourglass, tone: "rose" },
    { n: t.expired_unused || 0, text: "expired, never used", hint: "The offer ran out with no order.", icon: CalendarX2, tone: "slate" },
  ].filter((a) => a.n > 0);
  const tone: Record<string, string> = { amber: "bg-amber-500/10 border-amber-500/30 text-amber-600", rose: "bg-rose-500/10 border-rose-500/30 text-rose-500", slate: "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text)]" };
  const dot: Record<string, string> = { amber: "bg-amber-500", rose: "bg-rose-500", slate: "bg-slate-400" };
  return (
    <div className="rounded-3xl p-6 sm:p-7 bg-[var(--surface)] border border-[var(--border)] shadow-lg">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-6">
        <div>
          <h2 className="text-lg font-extrabold text-[var(--heading)]">All <Num v={total} /> customers, right now</h2>
          <p className="text-[11px] text-[var(--muted)]">Each customer counted once, by where they stand today.</p>
          <div className="mt-5 h-6 rounded-full overflow-hidden flex bg-[var(--surface-2)]" role="img" aria-label={groups.map((g) => `${g.label}: ${g.n}`).join(", ")}>
            {groups.map((g, i) => g.n > 0 && (
              <div key={g.label} title={`${g.label}: ${g.n}`} className={`h-full ${GROW} ${i ? "border-l-2 border-[var(--surface)]" : ""}`}
                style={{ width: grown && total ? `${(g.n / total) * 100}%` : 0, background: g.color, transitionDelay: `${300 + i * 90}ms` }} />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
            {groups.map((g) => (
              <div key={g.label} className={g.n ? "" : "opacity-45"}>
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color }} />{g.label}</div>
                <div className="flex items-baseline gap-1.5 mt-0.5"><Num v={g.n} className="text-xl font-extrabold text-[var(--heading)]" /><span className="text-[10px] text-[var(--muted)]">{total ? `${pctOf(g.n, total)}%` : ""}</span></div>
              </div>
            ))}
          </div>
        </div>
        <div className="lg:border-l lg:border-[var(--border)] lg:pl-6 space-y-2.5">
          <p className="text-xs font-extrabold text-[var(--heading)]">Needs attention</p>
          {!alerts.length ? (
            <div className="flex items-center gap-2 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 text-xs font-bold"><CheckCircle2 className="w-4 h-4" /> Nothing right now</div>
          ) : alerts.map((a) => (
            <div key={a.text} className={`flex items-start gap-3 p-3 rounded-2xl border ${tone[a.tone]}`}>
              <span className="relative flex w-2.5 h-2.5 mt-1.5 shrink-0">
                {a.tone !== "slate" && <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping motion-reduce:animate-none ${dot[a.tone]}`} />}
                <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${dot[a.tone]}`} />
              </span>
              <div className="text-xs"><b className="text-base tabular-nums">{a.n}</b> {a.text}<div className="text-[10px] opacity-80">{a.hint}</div></div>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Fact n={t.offer_active || 0} label="Offers running" />
            <Fact n={t.redeemed || 0} label="Used the offer" sub={total ? `${pctOf(t.redeemed || 0, total)}% of customers` : ""} />
            <Fact n={t.completed || 0} label="Used every discount" />
            <Fact n={t.open || 0} label="Still to call" />
          </div>
        </div>
      </div>
    </div>
  );
}

const Fact = ({ n, label, sub }: { n: number; label: string; sub?: string }) => (
  <div className="p-3 rounded-2xl bg-[var(--surface-2)]/70">
    <Num v={n} className="text-xl font-extrabold text-[var(--heading)]" />
    <div className="text-[10px] text-[var(--muted)] leading-tight">{label}{sub ? <><br />{sub}</> : null}</div>
  </div>
);

// ---------------------------------------------------------------- agents and churn
function Agents({ agents, grown, periodText }: { agents: any[]; grown: boolean; periodText: string }) {
  const max = Math.max(1, ...agents.map((a) => a.calls));
  return (
    <div className="xl:col-span-2 rounded-3xl p-6 bg-[var(--surface)] border border-[var(--border)] shadow-lg">
      <h3 className="text-sm font-extrabold text-[var(--heading)]">Agents</h3>
      <p className="text-[11px] text-[var(--muted)] mb-4">{periodText}. "Still to call" is everything on their list now.</p>
      {!agents.length ? <div className="text-xs text-[var(--muted)] py-6 text-center">No calls or orders in this period yet.</div> : (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[minmax(10rem,1.3fr)_2fr_repeat(4,4.2rem)] gap-3 px-2 pb-2 text-[10px] font-bold text-[var(--muted)] border-b border-[var(--border)]">
              <span>Agent</span><span>Calls</span><span className="text-center">Reached</span><span className="text-center">Accepted</span><span className="text-center">Orders</span><span className="text-center">To call</span>
            </div>
            {agents.map((a, i) => {
              const name = a.name || "—";
              return (
                <div key={a.user_id || i} className="grid grid-cols-[minmax(10rem,1.3fr)_2fr_repeat(4,4.2rem)] gap-3 items-center px-2 py-2.5 rounded-xl hover:bg-[var(--surface-2)]/60 transition-colors">
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-full grid place-items-center text-[11px] font-extrabold text-white shrink-0 shadow-sm" style={{ background: avatarColor(name) }}>{initials(name)}</span>
                    <span className="text-xs font-bold text-[var(--heading)] truncate">{name}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                      <span className={`block h-full rounded-full ${GROW}`} style={{ width: grown ? `${(a.calls / max) * 100}%` : 0, background: "linear-gradient(90deg,#8b5cf6,#6d28d9)", transitionDelay: `${i * 70}ms` }} />
                    </span>
                    <b className="text-xs tabular-nums text-[var(--heading)] w-7 text-right">{a.calls}</b>
                  </span>
                  <span className="text-center text-xs tabular-nums">{a.reached}</span>
                  <span className="text-center text-xs tabular-nums font-bold text-emerald-600">{a.accepted || <span className="text-[var(--muted)] font-normal">0</span>}</span>
                  <span className="text-center text-xs tabular-nums font-bold text-orange-500">{a.orders || <span className="text-[var(--muted)] font-normal">0</span>}</span>
                  <span className="text-center text-xs tabular-nums text-[var(--muted)]">{a.open}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Churn({ churn, grown, periodText }: { churn: any[]; grown: boolean; periodText: string }) {
  const max = Math.max(1, ...churn.map((c) => c.n));
  const total = churn.reduce((a, c) => a + c.n, 0);
  return (
    <div className="rounded-3xl p-6 bg-[var(--surface)] border border-[var(--border)] shadow-lg">
      <h3 className="text-sm font-extrabold text-[var(--heading)]">Why they stopped ordering</h3>
      <p className="text-[11px] text-[var(--muted)] mb-4">{periodText}, as the customers told the agents.</p>
      {!churn.length ? <div className="text-xs text-[var(--muted)] py-6 text-center">No reasons recorded in this period.</div> : (
        <div className="space-y-3">
          {churn.map((c, i) => (
            <div key={c.reason}>
              <div className="flex justify-between gap-2 text-[11px]"><span className="text-[var(--text)]">{c.reason}</span><span className="text-[var(--heading)] font-bold tabular-nums">{c.n} <span className="text-[var(--muted)] font-normal">({pctOf(c.n, total)}%)</span></span></div>
              <div className="h-2 bg-[var(--surface-2)] rounded-full overflow-hidden mt-1">
                <div className={`h-full rounded-full ${GROW}`} style={{ width: grown ? `${(c.n / max) * 100}%` : 0, background: "linear-gradient(90deg,#fb923c,#f43f5e)", transitionDelay: `${i * 70}ms` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <div className="xl:col-span-3 h-80 rounded-3xl bg-violet-500/20" />
        <div className="xl:col-span-2 h-80 rounded-3xl bg-[var(--surface-2)]" />
      </div>
      <div className="h-56 rounded-3xl bg-[var(--surface-2)]" />
    </div>
  );
}
