import { useEffect, useState } from "react";
import { Tags, Download, Check, AlertCircle } from "lucide-react";
import { apiFetch } from "../lib/api.ts";

// Admin editor for the other ways each brand and branch is written in uploaded files (aliases).
// A branch name only ever matches inside its own brand, so a name can repeat across brands but not within one.
interface CatBranch { id: string; name: string; aliases: string[] }
interface CatBrand { id: string; name: string; aliases: string[]; branches: CatBranch[] }

const inp = "w-full bg-[var(--bg)] border border-[var(--border)] rounded-xl px-2.5 py-1.5 text-[11px] text-[var(--text)]";
const toText = (a: string[]) => a.join(", ");
const fromText = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

export default function NameAliasesEditor() {
  const [cat, setCat] = useState<CatBrand[]>([]);
  const [brandId, setBrandId] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const r = await apiFetch("/api/name-registry");
    if (!r.ok) return;
    const d: CatBrand[] = await r.json();
    setCat(d); setBrandId((cur) => cur || d[0]?.id || "");
    const next: Record<string, string> = {};
    for (const b of d) { next[`brand:${b.id}`] = toText(b.aliases); for (const x of b.branches) next[`branch:${x.id}`] = toText(x.aliases); }
    setDraft(next);
  };
  useEffect(() => { load(); }, []);

  const save = async (kind: "brand" | "branch", id: string) => {
    setError(""); setSaved("");
    const res = await apiFetch("/api/name-registry/aliases", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, aliases: fromText(draft[`${kind}:${id}`] || "") }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error || "Could not save."); return; }
    setSaved(`${kind}:${id}`);
  };

  const exportAliases = async () => {
    const r = await apiFetch("/api/name-registry/export");
    if (!r.ok) return;
    const blob = new Blob([JSON.stringify(await r.json(), null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "learned-aliases.json"; a.click(); URL.revokeObjectURL(a.href);
  };

  const brand = cat.find((b) => b.id === brandId);
  return (
    <div className="md:col-span-2 xl:col-span-3 bg-[var(--surface)] border border-[var(--border)] shadow-lg rounded-3xl p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="p-2 bg-violet-500/10 text-violet-400 rounded-xl"><Tags className="w-5 h-5" /></div>
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold text-[var(--heading)]">Brand &amp; branch spellings</h3>
          <p className="text-[11px] text-[var(--muted)]">Other ways a name is written in uploaded files (separate with commas). The names themselves never change.</p>
        </div>
        <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="ml-auto bg-[var(--bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)]">
          {cat.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button onClick={exportAliases} title="Everything taught so far, to keep in the repo as server/learned-aliases.json" className="px-3 py-2 rounded-xl text-xs font-bold bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--heading)] flex items-center gap-1"><Download className="w-3.5 h-3.5" /> Export</button>
      </div>
      {error && <div className="p-2 text-[11px] text-rose-400 bg-rose-950/20 border border-rose-500/20 rounded-xl flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {error}</div>}
      {brand && (
        <div className="space-y-2">
          {[{ kind: "brand" as const, id: brand.id, name: `${brand.name} (the brand)` }, ...brand.branches.map((x) => ({ kind: "branch" as const, id: x.id, name: x.name }))].map((row) => {
            const k = `${row.kind}:${row.id}`;
            return (
              <div key={k} className="grid grid-cols-1 sm:grid-cols-[12rem_1fr_auto] items-center gap-2">
                <span className="text-xs font-bold text-[var(--heading)] truncate">{row.name}</span>
                <input className={inp} value={draft[k] ?? ""} placeholder="no other spellings" onChange={(e) => { setDraft((p) => ({ ...p, [k]: e.target.value })); setSaved(""); }} />
                <button onClick={() => save(row.kind, row.id)} className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold flex items-center gap-1">{saved === k ? <><Check className="w-3 h-3" /> Saved</> : "Save"}</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
