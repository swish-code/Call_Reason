import { useCallback, useEffect, useState } from "react";
import { Wand2, Check, AlertCircle } from "lucide-react";
import { apiFetch } from "../lib/api.ts";

// Brand / branch spellings the system could not match by itself after an upload. Staff upload files as they are;
// whoever manages reviews says here what each spelling is, once. Fixing a name also fixes every stored order with it.
interface Suggestion { id: string; name: string; score: number }
interface PendingBranch { brand_id: string; brand_name: string; raw: string; count: number; suggestions: Suggestion[] }
interface Pending { branches: PendingBranch[]; held_brands: { raw: string; count: number }[]; total_unmatched: number; total_held: number }
interface CatBrand { id: string; name: string; branches: { id: string; name: string }[] }

const sel = "bg-[var(--bg)] border border-[var(--border)] rounded-xl px-2 py-1.5 text-[11px] text-[var(--text)]";
const NEW = "__new__";

export default function NamesToFix({ onChanged, refreshKey }: { onChanged?: () => void; refreshKey?: number }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [cat, setCat] = useState<CatBrand[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([apiFetch("/api/name-registry/pending"), apiFetch("/api/name-registry")]);
      if (p.ok) setPending(await p.json());
      if (c.ok) setCat(await c.json());
    } catch { /* the panel just stays hidden */ }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const post = async (path: string, body: any, key: string) => {
    setBusy(key); setError(""); setMsg("");
    try {
      const res = await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Could not save."); return null; }
      return d;
    } finally { setBusy(""); }
  };

  const fixBranch = async (b: PendingBranch) => {
    const k = `b:${b.brand_id}:${b.raw}`;
    const choice = pick[k] || b.suggestions[0]?.id || "";
    const body: any = { brand_id: b.brand_id, raw: b.raw, remember: true };
    if (choice === NEW) body.new_branch_name = newName[k] || b.raw; else body.branch_id = choice;
    const d = await post("/api/name-registry/resolve-branch", body, k);
    if (d) { setMsg(`"${b.raw}" is now ${d.branch.name} — ${d.fixed} order(s) fixed. It will link by itself next time.`); await load(); onChanged?.(); }
  };
  const fixBrand = async (raw: string) => {
    const k = `h:${raw}`;
    if (!pick[k]) return;
    const d = await post("/api/name-registry/resolve-brand", { raw, brand_id: pick[k], remember: true }, k);
    if (d) { setMsg(`"${raw}": ${d.imported} review(s) imported${d.branch_unmatched ? `, ${d.branch_unmatched} still need a branch name` : ""}.`); await load(); onChanged?.(); }
  };

  if (!pending || (!pending.total_unmatched && !pending.total_held && !msg)) return null;

  return (
    <div className="bg-[var(--surface)] border border-amber-500/30 shadow-lg rounded-3xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl"><Wand2 className="w-5 h-5" /></div>
        <div>
          <h3 className="text-sm font-extrabold text-[var(--heading)]">Names to fix</h3>
          <p className="text-[11px] text-[var(--muted)]">
            {pending.total_unmatched + pending.total_held
              ? <><b className="text-[var(--heading)]">{pending.total_unmatched}</b> review(s) with a branch name we could not match, <b className="text-[var(--heading)]">{pending.total_held}</b> kept waiting for an unknown brand. Say what each name is once — it is remembered and the stored reviews are corrected.</>
              : "All names are matched."}
          </p>
        </div>
      </div>
      {error && <div className="p-2 text-[11px] text-rose-400 bg-rose-950/20 border border-rose-500/20 rounded-xl flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {error}</div>}
      {msg && <div className="p-2 text-[11px] text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> {msg}</div>}

      {pending.held_brands.map((h) => {
        const k = `h:${h.raw}`;
        return (
          <div key={k} className="flex flex-wrap items-center gap-2 p-3 bg-[var(--bg)] border border-[var(--border)] rounded-2xl text-xs">
            <span className="font-bold text-[var(--heading)]">"{h.raw}"</span>
            <span className="text-[var(--muted)]">unknown brand — {h.count} review(s) waiting</span>
            <select className={sel + " ml-auto"} value={pick[k] || ""} onChange={(e) => setPick((p) => ({ ...p, [k]: e.target.value }))}>
              <option value="">Which brand is it?</option>
              {cat.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button onClick={() => fixBrand(h.raw)} disabled={!pick[k] || busy === k} className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold disabled:opacity-50">Save</button>
          </div>
        );
      })}

      {pending.branches.map((b) => {
        const k = `b:${b.brand_id}:${b.raw}`;
        const brand = cat.find((x) => x.id === b.brand_id);
        const value = pick[k] ?? b.suggestions[0]?.id ?? "";
        return (
          <div key={k} className="flex flex-wrap items-center gap-2 p-3 bg-[var(--bg)] border border-[var(--border)] rounded-2xl text-xs">
            <span className="font-bold text-[var(--heading)]">{b.brand_name}</span>
            <span className="text-[var(--text)]">"{b.raw}"</span>
            <span className="text-[var(--muted)]">{b.count} review(s)</span>
            {b.suggestions[0] && <span className="text-[10px] text-amber-500">best guess: {b.suggestions[0].name} ({Math.round(b.suggestions[0].score * 100)}%)</span>}
            <select className={sel + " ml-auto"} value={value} onChange={(e) => setPick((p) => ({ ...p, [k]: e.target.value }))}>
              <option value="">Which branch is it?</option>
              {(brand?.branches || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              <option value={NEW}>+ A new branch…</option>
            </select>
            {value === NEW && <input className={sel + " w-40"} placeholder="New branch name" value={newName[k] ?? b.raw} onChange={(e) => setNewName((p) => ({ ...p, [k]: e.target.value }))} />}
            <button onClick={() => fixBranch(b)} disabled={!value || busy === k} className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold disabled:opacity-50">Save</button>
          </div>
        );
      })}
    </div>
  );
}
