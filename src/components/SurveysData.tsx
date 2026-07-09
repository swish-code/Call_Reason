import { useState, useEffect, useCallback } from "react";
import { User, SurveyRecord, SurveyRecordType, Brand } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { Database, RefreshCw, AlertCircle } from "lucide-react";
import SurveyDataUploadButton from "./SurveyDataUploadButton.tsx";

interface SurveysDataProps { currentUser: User; }

const KW_MS = 3 * 60 * 60 * 1000;
const fmtDate = (ts?: string) => {
  if (!ts) return '—';
  const t = new Date(ts).getTime();
  if (isNaN(t)) return String(ts);
  return new Date(t + KW_MS).toISOString().replace('T', ' ').slice(0, 16);
};

const feedbackColor = (f?: string) => {
  const v = (f || '').toLowerCase();
  if (v === 'positive') return 'text-emerald-400';
  if (v === 'negative') return 'text-rose-400';
  if (v === 'neutral') return 'text-amber-400';
  return 'text-[var(--muted)]';
};

const Stars = ({ n }: { n: number }) => (
  <span className="flex gap-0.5 text-sm">
    {[1, 2, 3, 4, 5].map(i => (
      <span key={i} className={i <= n ? (n <= 3 ? 'text-rose-400' : 'text-amber-400') : 'text-[var(--border)]'}>★</span>
    ))}
  </span>
);

const inputCls = "px-3 py-2.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none";
const selCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";

export default function SurveysData({ currentUser }: SurveysDataProps) {
  const [types, setTypes] = useState<SurveyRecordType[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [records, setRecords] = useState<SurveyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [type, setType] = useState("");
  const [brandId, setBrandId] = useState("");
  const [answered, setAnswered] = useState(""); // "", "answered", "no_answer"
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const typeLabel = useCallback((key?: string) => {
    const t = types.find(x => x.key === key);
    return t?.label || key || '—';
  }, [types]);

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (type) p.set('type', type);
    if (brandId) p.set('brand_id', brandId);
    if (answered === 'answered') p.set('answered', 'true');
    else if (answered === 'no_answer') p.set('answered', 'false');
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p.toString();
  }, [type, brandId, answered, from, to]);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/survey-records?${buildQuery()}`);
      if (!res.ok) throw new Error("Failed to load survey data.");
      setRecords(await res.json());
    } catch (e: any) {
      setError(e.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    apiFetch('/api/survey-records/types').then(r => r.ok ? r.json() : []).then(setTypes).catch(() => {});
    apiFetch('/api/brands').then(r => r.ok ? r.json() : []).then(setBrands).catch(() => {});
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      {/* Header */}
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-teal-500/10 text-teal-400 rounded-2xl">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">Survey Data</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">{records.length} record(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchRecords}
            className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <SurveyDataUploadButton currentUser={currentUser} onUploaded={fetchRecords} />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={type} onChange={e => setType(e.target.value)} className={selCls}>
          <option value="">All Types</option>
          {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={brandId} onChange={e => setBrandId(e.target.value)} className={selCls}>
          <option value="">All Brands</option>
          {brands.map(b => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
        </select>
        <select value={answered} onChange={e => setAnswered(e.target.value)} className={selCls}>
          <option value="">All</option>
          <option value="answered">Answered</option>
          <option value="no_answer">No Answer</option>
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} title="From" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} title="To" />
      </div>

      {error && (
        <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[240px]">
          <div className="w-10 h-10 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg)] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                <tr>
                  <th className="p-4">Type</th>
                  <th className="p-4">Brand</th>
                  <th className="p-4">Item / Order</th>
                  <th className="p-4">Phone</th>
                  <th className="p-4">Rate</th>
                  <th className="p-4">Feedback</th>
                  <th className="p-4">Served By</th>
                  <th className="p-4 text-center">Answered</th>
                  <th className="p-4">Uploaded By</th>
                  <th className="p-4">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {records.map(r => (
                  <tr key={r.id} className="hover:bg-[var(--surface-2)]/40 transition align-middle">
                    <td className="p-4 font-bold text-[var(--heading)]">{typeLabel(r.record_type)}</td>
                    <td className="p-4 text-[var(--text)]">{r.brand_name || r.brand_label || '—'}</td>
                    <td className="p-4 text-[var(--text)]">{r.item_name || r.order_id || '—'}</td>
                    <td className="p-4 font-mono text-[11px] text-[var(--muted)]">{r.phone || '—'}</td>
                    <td className="p-4">
                      {typeof r.rate === 'number' && r.rate > 0 ? <Stars n={r.rate} /> : <span className="text-[var(--muted)]">—</span>}
                    </td>
                    <td className="p-4">
                      {r.product_feedback
                        ? <span className={`font-bold ${feedbackColor(r.product_feedback)}`}>{r.product_feedback}</span>
                        : <span className="text-[var(--muted)]">—</span>}
                    </td>
                    <td className="p-4 text-[var(--muted)]">{r.served_by || '—'}</td>
                    <td className="p-4 text-center">
                      {r.answered
                        ? <span className="text-emerald-400 font-bold">Yes</span>
                        : <span className="text-[var(--muted)]">No</span>}
                    </td>
                    <td className="p-4 text-[var(--muted)] text-[11px]">{r.uploaded_by_name || '—'}</td>
                    <td className="p-4 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-[var(--muted)]">No survey data found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
