import { useState, useEffect, useCallback } from "react";
import { User, SurveyRecord, SurveyRecordType, Brand } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import {
  Database, RefreshCw, Upload, FileDown, X, AlertCircle,
} from "lucide-react";

interface SurveysDataProps { currentUser: User; }
interface UploadResult {
  total: number; inserted: number; answered: number;
  no_answer: number; invalid: number; errors: { row: number; message: string }[];
}

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

const downloadBase64 = (b64: string, filename: string) => {
  const a = document.createElement('a');
  a.href = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + b64;
  a.download = filename;
  a.click();
};

const readFileBase64 = (file: File): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

const inputCls = "px-3 py-2.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none";
const selCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";

const LEADER_ROLES = ['admin', 'owner', 'manager', 'supervisor', 'leader'];

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

  // Upload modal
  const [showUpload, setShowUpload] = useState(false);
  const [uploadType, setUploadType] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState("");

  const canUpload =
    LEADER_ROLES.includes(currentUser.role) || (currentUser as any).can_upload === true;

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

  const openUpload = () => {
    setShowUpload(true);
    setUploadType(types[0]?.key || "");
    setUploadFile(null);
    setUploadResult(null);
    setUploadError("");
  };

  const handleTemplate = async () => {
    if (!uploadType) return;
    const res = await apiFetch(`/api/survey-records/${uploadType}/template`);
    if (!res.ok) return;
    const data = await res.json();
    downloadBase64(data.file, data.filename);
  };

  const handleUpload = async () => {
    if (!uploadType || !uploadFile) return;
    setUploading(true);
    setUploadError("");
    setUploadResult(null);
    try {
      const b64 = await readFileBase64(uploadFile);
      const res = await apiFetch(`/api/survey-records/${uploadType}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: b64 }),
      });
      const data = await res.json();
      if (!res.ok) { setUploadError(data.error || "Upload failed."); return; }
      setUploadResult(data);
      fetchRecords();
    } catch (e: any) {
      setUploadError(e.message || "Upload error.");
    } finally {
      setUploading(false);
    }
  };

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
          {canUpload && (
            <button
              onClick={openUpload}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 transition"
            >
              <Upload className="w-4 h-4" /> Upload Survey Data
            </button>
          )}
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

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
              <h3 className="text-sm font-extrabold text-[var(--heading)] flex items-center gap-2">
                <Upload className="w-4 h-4 text-blue-400" /> Upload Survey Data
              </h3>
              <button onClick={() => setShowUpload(false)} className="p-1.5 hover:bg-[var(--surface-2)] text-[var(--muted)] rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--text)]">Type</label>
              <select value={uploadType} onChange={e => { setUploadType(e.target.value); setUploadResult(null); }} className={`w-full ${selCls}`}>
                <option value="">— Select Type —</option>
                {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>

            <button
              onClick={handleTemplate}
              disabled={!uploadType}
              className="w-full px-4 py-2.5 bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95 disabled:opacity-50"
            >
              <FileDown className="w-4 h-4" /> Download Template
            </button>

            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--text)]">File (.xlsx / .xls)</label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-[var(--text)] file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-600 file:text-white hover:file:bg-blue-700 file:cursor-pointer"
              />
            </div>

            {uploadError && (
              <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {uploadError}
              </div>
            )}

            {uploadResult && (
              <div className="p-4 bg-emerald-950/20 border border-emerald-500/20 rounded-xl space-y-2">
                <p className="text-xs font-extrabold text-emerald-400">Upload Complete</p>
                <div className="grid grid-cols-2 gap-1 text-[11px] text-[var(--text)]">
                  <span className="text-[var(--muted)]">Total rows:</span><span className="font-bold">{uploadResult.total}</span>
                  <span className="text-[var(--muted)]">Inserted:</span><span className="font-bold text-emerald-400">{uploadResult.inserted}</span>
                  <span className="text-[var(--muted)]">Answered:</span><span className="font-bold">{uploadResult.answered}</span>
                  <span className="text-[var(--muted)]">No answer:</span><span className="font-bold">{uploadResult.no_answer}</span>
                  <span className="text-[var(--muted)]">Invalid:</span><span className="font-bold">{uploadResult.invalid}</span>
                </div>
                {uploadResult.errors.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-[11px] font-bold text-rose-400">Errors ({uploadResult.errors.length})</p>
                    <div className="max-h-28 overflow-y-auto space-y-1">
                      {uploadResult.errors.map((e, i) => (
                        <div key={i} className="text-[11px] text-rose-300">Row {e.row}: {e.message}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowUpload(false)} className="px-4 py-2 bg-[var(--surface-2)] text-[var(--text)] rounded-xl text-xs font-bold transition">
                Close
              </button>
              <button
                onClick={handleUpload}
                disabled={!uploadType || !uploadFile || uploading}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition"
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
