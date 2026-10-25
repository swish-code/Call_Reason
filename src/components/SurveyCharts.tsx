import { useCallback, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { apiFetch } from "../lib/api.ts";
import { BarChart3, Filter, Table2, AlertCircle } from "lucide-react";

// Survey performance charts for the Surveys Dashboard: uploaded vs reached / refused / not reached, by month and
// by day, new-item vs normal-order surveys, per brand, and the answers per question.
//
// Every number counts the survey numbers by the day they were UPLOADED (Kuwait time), so each percentage has the
// uploaded total as its denominator. Reached % = (reached + refused) / uploaded; Not reached % = not reached / uploaded;
// "waiting" numbers (uploaded, not finished yet) are in neither.

interface Counts { uploaded: number; reached: number; refused: number; not_reached: number; waiting: number; normal: number; new_item: number; other: number }
interface MonthRow extends Counts { month: string }
interface DayRow extends Counts { day: string }
interface BrandDay { day: string; brand_id: string | null; n: number }
interface BrandInfo { id: string; name: string; total: number }
interface AnswerRow { qid: string; text: string; answer_type: string; q_order: number; template: string | null; value: string; n: number }
interface Analytics { from: string; to: string; month: string; kpi: Counts; months: MonthRow[]; days: DayRow[]; brandDays: BrandDay[]; brands: BrandInfo[]; answers: AnswerRow[] }

const EMPTY: Counts = { uploaded: 0, reached: 0, refused: 0, not_reached: 0, waiting: 0, normal: 0, new_item: 0, other: 0 };
const KW_MS = 3 * 3600_000;
const kwToday = () => new Date(Date.now() + KW_MS).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
const lastDayOf = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const addMonths = (month: string, n: number) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const monthLong = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(v >= 10 || v === 0 ? 0 : 1)}%`);
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : String(n));
const reachedPct = (c: Counts) => pct(c.reached + c.refused, c.uploaded);
const notReachedPct = (c: Counts) => pct(c.not_reached, c.uploaded);

// Series colors: the validated categorical order (blue, aqua, orange, violet, ...) — light and dark steps.
// Shared with other dashboards (e.g. the offer campaign page): wrap the section in className="svc" and render <style>{STYLE}</style>.
export const STYLE = `
.svc { --c-blue:#2a78d6; --c-aqua:#1baf7a; --c-orange:#eb6834; --c-violet:#6250d6; --c-yellow:#eda100; --c-magenta:#e87ba4; --c-green:#008300; --c-other:#9ca3af; }
.dark .svc { --c-blue:#3987e5; --c-aqua:#199e70; --c-orange:#d95926; --c-violet:#9085e9; --c-yellow:#c98500; --c-magenta:#d55181; --c-green:#008300; --c-other:#71717a; }
`;
export const C = { blue: "var(--c-blue)", aqua: "var(--c-aqua)", orange: "var(--c-orange)", violet: "var(--c-violet)", yellow: "var(--c-yellow)", magenta: "var(--c-magenta)", green: "var(--c-green)", other: "var(--c-other)" };
const BRAND_COLORS = [C.blue, C.orange, C.aqua, C.yellow, C.magenta, C.green, C.violet];

export type Series = { key: string; label: string; color: string };
export type Cat = { key: string; label: string };
export interface Tip { x: number; y: number; title: string; rows: { color?: string; label: string; value: string }[] }

// ---------------------------------------------------------------- chart frame (title, legend, table view, tooltip)
export function Card({ title, sub, legend, table, children, right, reset }: { reset?: unknown; title: string; sub?: string; legend?: Series[]; table?: { head: string[]; rows: string[][] }; children: (setTip: (t: Tip | null) => void) => ReactNode; right?: ReactNode }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [asTable, setAsTable] = useState(false);
  // new data under the mouse: drop the old tooltip instead of showing stale numbers
  useEffect(() => { setTip(null); }, [reset]);
  return (
    <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--heading)]">{title}</h3>
          {sub && <p className="text-[11px] text-[var(--muted)] mt-0.5">{sub}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {right}
          {table && <button onClick={() => setAsTable(!asTable)} title="Show the numbers as a table" className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition ${asTable ? "bg-violet-600/20 text-violet-300 border-violet-500/40" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)]"}`}><Table2 className="w-3 h-3" /> Table</button>}
        </div>
      </div>
      {legend && legend.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
          {legend.map((s) => <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-[var(--text)]"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
      <div className="relative" onMouseLeave={() => setTip(null)}>
        {asTable && table ? (
          <div className="overflow-auto max-h-[300px]">
            <table className="w-full text-[11px]">
              <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]">{table.head.map((h, i) => <th key={i} className={`py-1.5 px-2 ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
              <tbody>{table.rows.map((r, i) => <tr key={i} className="border-b border-[var(--border)]/40">{r.map((v, j) => <td key={j} className={`py-1.5 px-2 ${j ? "text-right font-mono" : "text-left"}`}>{v}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : children(setTip)}
        {tip && !asTable && (
          <div className="pointer-events-none absolute z-20 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl text-[11px] min-w-[140px]"
            style={{ left: tip.x, top: tip.y, transform: `translate(${tip.x > 340 ? "calc(-100% - 12px)" : "12px"}, -50%)` }}>
            <div className="font-bold text-[var(--heading)] mb-1">{tip.title}</div>
            {tip.rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-4 text-[var(--text)]">
                <span className="flex items-center gap-1.5">{r.color && <span className="inline-block w-2 h-2 rounded-sm" style={{ background: r.color }} />}{r.label}</span>
                <span className="font-mono font-bold text-[var(--heading)]">{r.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- plot geometry
const W = 720, H = 250, ML = 44, MR = 12, MT = 12, MB = 30;
const PW = W - ML - MR, PH = H - MT - MB;
function niceMax(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  return { top: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => i * step) };
}
function Axes({ ticks, top, fmt = compact }: { ticks: number[]; top: number; fmt?: (n: number) => string }) {
  return (
    <g>
      {ticks.map((t) => {
        const y = MT + PH - (t / top) * PH;
        return (
          <g key={t}>
            <line x1={ML} x2={W - MR} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
            <text x={ML - 8} y={y + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)">{fmt(t)}</text>
          </g>
        );
      })}
    </g>
  );
}
// Column with a 4px rounded top and a square bottom.
const colPath = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
};
// Which category labels to print so they never collide.
const labelEvery = (n: number) => (n <= 12 ? 1 : n <= 24 ? 2 : 3);

/** Grouped columns: one group per category, one column per series. */
export function GroupedColumns({ cats, series, value, selected, setTip, labelBars }: { cats: Cat[]; series: Series[]; value: (cat: string, s: string) => number; selected?: (cat: string) => boolean; setTip: (t: Tip | null) => void; labelBars?: boolean }) {
  const max = Math.max(0, ...cats.flatMap((c) => series.map((s) => value(c.key, s.key))));
  const { top, ticks } = niceMax(max);
  const band = PW / Math.max(cats.length, 1);
  const bw = Math.min(18, (band * 0.8 - (series.length - 1) * 2) / series.length);
  const gw = bw * series.length + (series.length - 1) * 2;
  const every = labelEvery(cats.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
      <Axes ticks={ticks} top={top} />
      {cats.map((c, i) => {
        const x0 = ML + i * band + (band - gw) / 2;
        const sel = selected?.(c.key);
        return (
          <g key={c.key}>
            {sel && <rect x={ML + i * band} y={MT} width={band} height={PH} fill="var(--border)" opacity={0.45} rx={4} />}
            {series.map((s, k) => {
              const v = value(c.key, s.key), h = (v / top) * PH;
              const x = x0 + k * (bw + 2);
              return (
                <g key={s.key}>
                  {v > 0 && <path d={colPath(x, MT + PH - h, bw, h)} fill={s.color} />}
                  {labelBars && v > 0 && bw >= 12 && <text x={x + bw / 2} y={MT + PH - h - 4} textAnchor="middle" fontSize={9} fill="var(--text)">{compact(v)}</text>}
                </g>
              );
            })}
            {i % every === 0 && <text x={ML + i * band + band / 2} y={H - 10} textAnchor="middle" fontSize={10} fill={sel ? "var(--heading)" : "var(--muted)"} fontWeight={sel ? 700 : 400}>{c.label}</text>}
            <rect x={ML + i * band} y={MT} width={band} height={PH + MB} fill="transparent"
              onMouseMove={(e) => { const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); const px = ((ML + i * band + band / 2) / W) * r.width; setTip({ x: px, y: Math.max(40, e.clientY - r.top), title: c.label, rows: series.map((s) => ({ color: s.color, label: s.label, value: value(c.key, s.key).toLocaleString() })) }); }} />
          </g>
        );
      })}
    </svg>
  );
}

/** Lines on a 0-100 % axis, one point per category (a gap where nothing was uploaded). */
function PercentLines({ cats, series, selected, setTip }: { cats: Cat[]; series: (Series & { values: (number | null)[] })[]; selected?: (cat: string) => boolean; setTip: (t: Tip | null) => void }) {
  const band = PW / Math.max(cats.length, 1);
  const px = (i: number) => ML + i * band + band / 2;
  const py = (v: number) => MT + PH - (v / 100) * PH;
  const every = labelEvery(cats.length);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" onMouseLeave={() => { setHover(null); setTip(null); }}>
      <Axes ticks={[0, 25, 50, 75, 100]} top={100} fmt={(n) => `${n}%`} />
      {cats.map((c, i) => (
        <g key={c.key}>
          {selected?.(c.key) && <rect x={ML + i * band} y={MT} width={band} height={PH} fill="var(--border)" opacity={0.45} rx={4} />}
          {i % every === 0 && <text x={px(i)} y={H - 10} textAnchor="middle" fontSize={10} fill={selected?.(c.key) ? "var(--heading)" : "var(--muted)"} fontWeight={selected?.(c.key) ? 700 : 400}>{c.label}</text>}
        </g>
      ))}
      {hover !== null && <line x1={px(hover)} x2={px(hover)} y1={MT} y2={MT + PH} stroke="var(--muted)" strokeWidth={1} opacity={0.6} />}
      {series.map((s) => {
        // break the line where a category has no data
        const segs: string[][] = [[]];
        s.values.forEach((v, i) => { if (v === null) segs.push([]); else segs[segs.length - 1].push(`${px(i)},${py(v)}`); });
        const last = [...s.values].map((v, i) => ({ v, i })).filter((p) => p.v !== null).pop();
        return (
          <g key={s.key}>
            {segs.filter((p) => p.length > 1).map((p, i) => <polyline key={i} points={p.join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
            {s.values.map((v, i) => v !== null && (cats.length <= 16 || hover === i) && <circle key={i} cx={px(i)} cy={py(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />)}
            {last && last.v !== null && <text x={Math.min(px(last.i) + 8, W - 30)} y={py(last.v) - 8} fontSize={10} fontWeight={700} fill="var(--heading)" textAnchor={px(last.i) > W - 60 ? "end" : "start"}>{fmtPct(last.v)}</text>}
          </g>
        );
      })}
      {cats.map((c, i) => (
        <rect key={c.key} x={ML + i * band} y={MT} width={band} height={PH + MB} fill="transparent"
          onMouseMove={(e) => { setHover(i); const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setTip({ x: (px(i) / W) * r.width, y: Math.max(40, e.clientY - r.top), title: c.label, rows: series.map((s) => ({ color: s.color, label: s.label, value: fmtPct(s.values[i]) })) }); }} />
      ))}
    </svg>
  );
}

/** Stacked columns (per brand per day), 2px surface gap between segments. */
function StackedColumns({ cats, series, value, setTip }: { cats: Cat[]; series: Series[]; value: (cat: string, s: string) => number; setTip: (t: Tip | null) => void }) {
  const totals = cats.map((c) => series.reduce((a, s) => a + value(c.key, s.key), 0));
  const { top, ticks } = niceMax(Math.max(0, ...totals));
  const band = PW / Math.max(cats.length, 1);
  const bw = Math.min(18, band * 0.7);
  const every = labelEvery(cats.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
      <Axes ticks={ticks} top={top} />
      {cats.map((c, i) => {
        const x = ML + i * band + (band - bw) / 2;
        let y = MT + PH;
        const segs = series.map((s) => ({ s, v: value(c.key, s.key) })).filter((p) => p.v > 0);
        return (
          <g key={c.key}>
            {segs.map(({ s, v }, k) => {
              const h = (v / top) * PH, hh = Math.max(h - (k < segs.length - 1 || segs.length > 1 ? 2 : 0), 1);
              y -= h;
              return k === segs.length - 1 ? <path key={s.key} d={colPath(x, y + (h - hh), bw, hh)} fill={s.color} /> : <rect key={s.key} x={x} y={y + (h - hh)} width={bw} height={hh} fill={s.color} />;
            })}
            {i % every === 0 && <text x={ML + i * band + band / 2} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--muted)">{c.label}</text>}
            <rect x={ML + i * band} y={MT} width={band} height={PH + MB} fill="transparent"
              onMouseMove={(e) => { const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setTip({ x: ((ML + i * band + band / 2) / W) * r.width, y: Math.max(40, e.clientY - r.top), title: `${c.label} — ${totals[i].toLocaleString()} surveys`, rows: series.filter((s) => value(c.key, s.key) > 0).map((s) => ({ color: s.color, label: s.label, value: value(c.key, s.key).toLocaleString() })) }); }} />
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------- the section
type Kind = "today" | "yesterday" | "this_month" | "month" | "day";
const RATING_SCALE: Record<string, number> = { rating_1_5: 5, rating_1_10: 10 };

export default function SurveyCharts() {
  const [kind, setKind] = useState<Kind>("today");
  const [month, setMonth] = useState(kwToday().slice(0, 7));
  const [day, setDay] = useState(kwToday());
  const [brandId, setBrandId] = useState("");
  const [data, setData] = useState<Analytics | null>(null);
  const [brands, setBrands] = useState<BrandInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [g4, setG4] = useState<"daily" | "monthly">("daily");
  const [showAllQ, setShowAllQ] = useState(false);

  const range = useMemo(() => {
    const t = kwToday();
    if (kind === "today") return { from: t, to: t };
    if (kind === "yesterday") { const y = addDays(t, -1); return { from: y, to: y }; }
    if (kind === "this_month") return { from: t.slice(0, 7) + "-01", to: t };
    if (kind === "month") return { from: month + "-01", to: lastDayOf(month) };
    return { from: day, to: day };
  }, [kind, month, day]);

  const reqId = useRef(0);
  const load = useCallback(async () => {
    const id = ++reqId.current;
    try {
      setLoading(true); setError("");
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (brandId) qs.set("brand_id", brandId);
      const res = await apiFetch(`/api/surveys/analytics?${qs}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load the charts.");
      const d: Analytics = await res.json();
      if (id !== reqId.current) return;             // a newer filter is already loading
      setData(d);
      setBrands((prev) => (d.brands.length >= prev.length ? d.brands : prev));
    } catch (e: any) { if (id === reqId.current) setError(e.message); } finally { if (id === reqId.current) setLoading(false); }
  }, [range.from, range.to, brandId]);
  useEffect(() => { load(); }, [load]);

  // ---- derived series
  const selMonth = (data?.month) || range.to.slice(0, 7);
  const today = kwToday();
  const monthCats = useMemo(() => {
    const first = data?.months[0]?.month;
    const start = first && first > addMonths(selMonth, -11) ? first : addMonths(selMonth, -11);
    const out: Cat[] = [];
    for (let m = start; m <= selMonth; m = addMonths(m, 1)) out.push({ key: m, label: monthLabel(m) });
    return out;
  }, [data, selMonth]);
  const monthMap = useMemo(() => new Map((data?.months || []).map((m) => [m.month, m])), [data]);
  const dayCats = useMemo(() => {
    const out: Cat[] = [];
    const end = selMonth === today.slice(0, 7) ? today : lastDayOf(selMonth);
    for (let d = selMonth + "-01"; d <= end; d = addDays(d, 1)) out.push({ key: d, label: String(Number(d.slice(8, 10))) });
    return out;
  }, [selMonth, today]);
  const dayMap = useMemo(() => new Map((data?.days || []).map((d) => [d.day, d])), [data]);
  const mc = (m: string): Counts => monthMap.get(m) || EMPTY;
  const dc = (d: string): Counts => dayMap.get(d) || EMPTY;
  const inRange = (d: string) => d >= range.from && d <= range.to;

  const kpi = data?.kpi || EMPTY;
  const rangeLabel = range.from === range.to ? dayLabel(range.from) + " " + range.from.slice(0, 4) : `${dayLabel(range.from)} – ${dayLabel(range.to)} ${range.to.slice(0, 4)}`;
  const brandName = brandId ? brands.find((b) => b.id === brandId)?.name || "" : "";

  const S_COUNTS: Series[] = [
    { key: "uploaded", label: "Uploaded", color: C.blue }, { key: "reached", label: "Reached", color: C.aqua },
    { key: "refused", label: "Refused", color: C.orange }, { key: "not_reached", label: "Not reached", color: C.violet },
  ];
  const S_KIND: Series[] = [
    { key: "normal", label: "Normal orders", color: C.blue }, { key: "new_item", label: "New item", color: C.orange }, { key: "other", label: "Other marketing", color: C.aqua },
  ];
  const showOther = (data?.months || []).some((m) => m.other > 0) || (data?.days || []).some((d) => d.other > 0);
  const kindSeries = showOther ? S_KIND : S_KIND.slice(0, 2);

  // brand colors follow the brand (its all-time size), never its rank in the current filter
  const brandSeries: Series[] = useMemo(() => {
    const top = brands.slice(0, BRAND_COLORS.length);
    const present = new Set((data?.brandDays || []).map((b) => b.brand_id));
    const s: Series[] = top.filter((b) => present.has(b.id)).map((b) => ({ key: b.id, label: b.name, color: BRAND_COLORS[top.indexOf(b)] }));
    if ((data?.brandDays || []).some((b) => !top.some((t) => t.id === b.brand_id))) s.push({ key: "__other", label: "Other brands", color: C.other });
    return s;
  }, [brands, data]);
  const brandVal = useMemo(() => {
    const top = new Set(brands.slice(0, BRAND_COLORS.length).map((b) => b.id));
    const m = new Map<string, number>();
    for (const r of data?.brandDays || []) { const k = r.day + "|" + (r.brand_id && top.has(r.brand_id) ? r.brand_id : "__other"); m.set(k, (m.get(k) || 0) + r.n); }
    return (d: string, s: string) => m.get(d + "|" + s) || 0;
  }, [brands, data]);

  // ---- answers per question, grouped by template
  const questions = useMemo(() => {
    const byQ = new Map<string, { qid: string; text: string; type: string; template: string; order: number; values: Map<string, number>; total: number }>();
    for (const a of data?.answers || []) {
      let q = byQ.get(a.qid);
      if (!q) { q = { qid: a.qid, text: a.text, type: a.answer_type, template: a.template || "Template", order: a.q_order, values: new Map(), total: 0 }; byQ.set(a.qid, q); }
      q.values.set(a.value, (q.values.get(a.value) || 0) + a.n); q.total += a.n;
    }
    return [...byQ.values()].sort((a, b) => a.template.localeCompare(b.template) || a.order - b.order);
  }, [data]);

  const inputCls = "px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-violet-500 focus:outline-none";
  const presetCls = (on: boolean) => `px-4 py-2 rounded-xl text-xs font-bold border transition ${on ? "bg-violet-600 text-white border-violet-500" : "bg-[var(--bg)] text-[var(--text)] border-[var(--border)] hover:text-[var(--heading)]"}`;

  const noData = !loading && kpi.uploaded === 0 && !(data?.months.length);
  return (
    <section className="space-y-5 svc">
      <style>{STYLE}</style>
      <div>
        <h2 className="text-lg font-extrabold text-[var(--heading)] flex items-center gap-2"><BarChart3 className="w-5 h-5 text-violet-400" /> Survey performance</h2>
        <p className="text-xs text-[var(--muted)] mt-1">Counted by the day each number was uploaded. Reached % = (reached + refused) ÷ uploaded · Not reached % = not reached ÷ uploaded. Numbers still waiting to be called are in neither.</p>
      </div>

      {/* Filters */}
      <div className="bg-[var(--surface)] p-4 border border-[var(--border)] shadow-lg rounded-2xl flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-[var(--heading)] font-bold text-sm mr-1"><Filter className="w-4 h-4 text-violet-400" /> Filter</div>
        <button onClick={() => setKind("today")} className={presetCls(kind === "today")}>Today</button>
        <button onClick={() => setKind("yesterday")} className={presetCls(kind === "yesterday")}>Yesterday</button>
        <button onClick={() => setKind("this_month")} className={presetCls(kind === "this_month")}>This month</button>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">Month
          <input type="month" value={month} max={today.slice(0, 7)} onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setKind("month"); } }} className={inputCls + (kind === "month" ? " ring-2 ring-violet-500" : "")} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">Day
          <input type="date" value={day} max={today} onChange={(e) => { if (e.target.value) { setDay(e.target.value); setKind("day"); } }} className={inputCls + (kind === "day" ? " ring-2 ring-violet-500" : "")} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--muted)]">Brand
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className={inputCls + " font-bold [&>option]:bg-[var(--surface)] min-w-[10rem]"}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <div className="ml-auto text-[11px] text-[var(--muted)]">Showing <b className="text-[var(--heading)]">{rangeLabel}</b>{brandName && <> · <b className="text-[var(--heading)]">{brandName}</b></>}</div>
      </div>

      {error && <div className="p-3 rounded-xl text-xs border bg-rose-950/20 border-rose-500/20 text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>}

      {/* Totals of the selected period */}
      <div className={`grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 transition-opacity ${loading ? "opacity-50" : ""}`}>
        {[
          { l: "Uploaded", v: kpi.uploaded.toLocaleString(), c: C.blue },
          { l: "Reached", v: kpi.reached.toLocaleString(), c: C.aqua },
          { l: "Refused", v: kpi.refused.toLocaleString(), c: C.orange },
          { l: "Not reached", v: kpi.not_reached.toLocaleString(), c: C.violet },
          { l: "Waiting", v: kpi.waiting.toLocaleString(), c: C.other },
          { l: "Reached %", v: fmtPct(reachedPct(kpi)), c: C.aqua },
          { l: "Not reached %", v: fmtPct(notReachedPct(kpi)), c: C.violet },
        ].map((k) => (
          <div key={k.l} className="bg-[var(--surface)] px-4 py-3 border border-[var(--border)] rounded-2xl">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: k.c }} />{k.l}</div>
            <div className="text-2xl font-extrabold text-[var(--heading)] mt-1">{k.v}</div>
          </div>
        ))}
      </div>

      {noData ? <div className="text-center py-10 text-[var(--muted)] text-xs bg-[var(--surface)] border border-[var(--border)] rounded-2xl">No survey numbers were uploaded for this selection.</div> : (
        <div className={`grid grid-cols-1 xl:grid-cols-2 gap-5 transition-opacity ${loading ? "opacity-50" : ""}`}>
          {/* Graph 1 */}
          <Card reset={data} title="1 · Monthly — uploaded, reached, refused, not reached" sub={`Last months up to ${monthLong(selMonth)}`} legend={S_COUNTS}
            table={{ head: ["Month", ...S_COUNTS.map((s) => s.label)], rows: monthCats.map((c) => [monthLabel(c.key), ...S_COUNTS.map((s) => String((mc(c.key) as any)[s.key]))]) }}>
            {(setTip) => <GroupedColumns cats={monthCats} series={S_COUNTS} value={(c, s) => (mc(c) as any)[s]} selected={(c) => c === selMonth} setTip={setTip} labelBars={monthCats.length <= 6} />}
          </Card>

          {/* Graph 2 */}
          <Card reset={data} title="2 · Monthly — reached % and not reached %" sub="Reached % counts refused as reached (they picked up)" legend={[{ key: "r", label: "Reached % (reached + refused)", color: C.aqua }, { key: "n", label: "Not reached %", color: C.violet }]}
            table={{ head: ["Month", "Reached %", "Not reached %"], rows: monthCats.map((c) => [monthLabel(c.key), fmtPct(reachedPct(mc(c.key))), fmtPct(notReachedPct(mc(c.key)))]) }}>
            {(setTip) => <PercentLines cats={monthCats} selected={(c) => c === selMonth} setTip={setTip}
              series={[{ key: "r", label: "Reached %", color: C.aqua, values: monthCats.map((c) => reachedPct(mc(c.key))) }, { key: "n", label: "Not reached %", color: C.violet, values: monthCats.map((c) => notReachedPct(mc(c.key))) }]} />}
          </Card>

          {/* Graph 3 */}
          <Card reset={data} title={`3a · Daily — surveys uploaded (${monthLong(selMonth)})`} sub="One column per day"
            table={{ head: ["Day", "Uploaded"], rows: dayCats.map((c) => [dayLabel(c.key), String(dc(c.key).uploaded)]) }}>
            {(setTip) => <GroupedColumns cats={dayCats} series={[S_COUNTS[0]]} value={(c) => dc(c).uploaded} selected={inRange} setTip={setTip} />}
          </Card>
          <Card reset={data} title={`3b · Daily — reached % and not reached % (${monthLong(selMonth)})`} legend={[{ key: "r", label: "Reached %", color: C.aqua }, { key: "n", label: "Not reached %", color: C.violet }]}
            table={{ head: ["Day", "Uploaded", "Reached %", "Not reached %"], rows: dayCats.map((c) => [dayLabel(c.key), String(dc(c.key).uploaded), fmtPct(reachedPct(dc(c.key))), fmtPct(notReachedPct(dc(c.key)))]) }}>
            {(setTip) => <PercentLines cats={dayCats} selected={inRange} setTip={setTip}
              series={[{ key: "r", label: "Reached %", color: C.aqua, values: dayCats.map((c) => reachedPct(dc(c.key))) }, { key: "n", label: "Not reached %", color: C.violet, values: dayCats.map((c) => notReachedPct(dc(c.key))) }]} />}
          </Card>

          {/* Graph 4 */}
          <Card reset={data} title={`4 · New item vs normal orders — ${g4 === "daily" ? `daily (${monthLong(selMonth)})` : "monthly"}`}
            sub="Normal orders = daily campaigns · New item = item surveys" legend={kindSeries}
            right={<div className="flex rounded-lg overflow-hidden border border-[var(--border)]">{(["daily", "monthly"] as const).map((m) => <button key={m} onClick={() => setG4(m)} className={`px-2.5 py-1.5 text-[10px] font-bold ${g4 === m ? "bg-violet-600 text-white" : "bg-[var(--bg)] text-[var(--muted)]"}`}>{m === "daily" ? "Daily" : "Monthly"}</button>)}</div>}
            table={{ head: [g4 === "daily" ? "Day" : "Month", ...kindSeries.map((s) => s.label)], rows: (g4 === "daily" ? dayCats : monthCats).map((c) => [g4 === "daily" ? dayLabel(c.key) : monthLabel(c.key), ...kindSeries.map((s) => String(((g4 === "daily" ? dc(c.key) : mc(c.key)) as any)[s.key]))]) }}>
            {(setTip) => g4 === "daily"
              ? <GroupedColumns cats={dayCats} series={kindSeries} value={(c, s) => (dc(c) as any)[s]} selected={inRange} setTip={setTip} />
              : <GroupedColumns cats={monthCats} series={kindSeries} value={(c, s) => (mc(c) as any)[s]} selected={(c) => c === selMonth} setTip={setTip} labelBars={monthCats.length <= 6} />}
          </Card>

          {/* Graph 5 */}
          <Card reset={data} title={`5 · Daily surveys per brand (${monthLong(selMonth)})`} sub={brandName ? `Only ${brandName}` : "Stacked by brand; pick a brand above to see one"} legend={brandSeries}
            table={{ head: ["Day", ...brandSeries.map((s) => s.label)], rows: dayCats.map((c) => [dayLabel(c.key), ...brandSeries.map((s) => String(brandVal(c.key, s.key)))]) }}>
            {(setTip) => <StackedColumns cats={dayCats} series={brandSeries} value={brandVal} setTip={setTip} />}
          </Card>
        </div>
      )}

      {/* Graph 6 */}
      <div className={`bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl transition-opacity ${loading ? "opacity-50" : ""}`}>
        <h3 className="text-sm font-bold text-[var(--heading)]">6 · Answers per question</h3>
        <p className="text-[11px] text-[var(--muted)] mt-0.5 mb-4">Answers saved by surveys finished {rangeLabel}{brandName ? ` · ${brandName}` : ""}. Each bar is how many customers gave that answer.</p>
        {questions.length === 0 ? <div className="text-center py-6 text-[var(--muted)] text-xs">No answers in this selection.</div> : (
          <div className="space-y-6">
            {(showAllQ ? questions : questions.slice(0, 8)).map((q, qi, arr) => {
              const scale = RATING_SCALE[q.type];
              const vals: [string, number][] = scale
                ? Array.from({ length: scale }, (_, i) => [String(i + 1), q.values.get(String(i + 1)) || 0] as [string, number])
                : [...q.values.entries()].sort((a, b) => b[1] - a[1]);
              const max = Math.max(1, ...vals.map((v) => v[1]));
              const avg = scale ? vals.reduce((a, [v, n]) => a + Number(v) * n, 0) / Math.max(q.total, 1) : null;
              return (
                <div key={q.qid}>
                  {(qi === 0 || arr[qi - 1].template !== q.template) && <div className="text-[10px] font-bold uppercase tracking-wider text-violet-400 mb-2">{q.template}</div>}
                  <div className="flex items-baseline justify-between gap-3 mb-1.5">
                    <div dir="auto" className="text-xs font-bold text-[var(--heading)]">{q.text}</div>
                    <div className="text-[11px] text-[var(--muted)] shrink-0">{q.total.toLocaleString()} answer{q.total === 1 ? "" : "s"}{avg !== null && <> · avg <b className="text-[var(--heading)]">{avg.toFixed(2)}</b></>}</div>
                  </div>
                  {q.type === "free_text" ? <div className="text-[11px] text-[var(--muted)]">Free-text comments — {q.total.toLocaleString()} written.</div> : (
                    <div className="space-y-1">
                      {vals.map(([v, n]) => (
                        <div key={v} className="flex items-center gap-2 text-[11px]">
                          <div className="w-28 sm:w-40 truncate text-[var(--text)]" title={v}>{scale === 5 ? `${v} ★` : v}</div>
                          <div className="flex-1 h-[14px] bg-[var(--bg)] rounded-sm overflow-hidden"><div style={{ width: `${(n / max) * 100}%`, background: C.blue }} className="h-full rounded-r-[4px]" /></div>
                          <div className="w-24 text-right font-mono text-[var(--heading)]">{n.toLocaleString()} <span className="text-[var(--muted)]">({fmtPct(pct(n, q.total))})</span></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {questions.length > 8 && <button onClick={() => setShowAllQ(!showAllQ)} className="px-4 py-2 rounded-xl text-xs font-bold bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] hover:text-[var(--heading)]">{showAllQ ? "Show fewer" : `Show all ${questions.length} questions`}</button>}
          </div>
        )}
      </div>
    </section>
  );
}
