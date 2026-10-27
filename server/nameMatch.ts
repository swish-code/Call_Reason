// Brand / branch name matching for uploaded files. Pure functions only (no database), so they are unit-testable.
// Every source writes the same branch differently ("Ardhiya", "Ardiyah", "ARD", "Tabel, Ardhiya"); the system keeps one
// canonical name per branch and decides which canonical branch an incoming spelling refers to. Matching is ALWAYS scoped
// to one brand: "Ardiya" exists under many brands and must never be matched across them.

export interface NameBrand { id: string; name: string; aliases: string[] }
export interface NameBranch { id: string; name: string; aliases: string[] }
export interface BranchSuggestion { id: string; name: string; score: number }
export interface BranchMatch {
  /** matched = safe to link; suggest = a human confirms; unknown = nothing close. */
  status: "matched" | "suggest" | "unknown";
  branch: NameBranch | null;
  score: number;
  suggestions: BranchSuggestion[];
}

export const AUTO_LINK = 0.7;
export const SUGGEST_FROM = 0.5;

/** Aliases are stored as JSON text; one reader that never throws (bad JSON gives an empty list). */
export function parseAliases(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.map(String).filter(Boolean) : []; } catch { return []; }
}

/** Merge names into an alias list (never replaces; case/space-insensitive duplicates are dropped). */
export function mergeAliases(existing: string[], add: string[]): string[] {
  const out = [...existing];
  const seen = new Set(out.map(normalize));
  for (const a of add) { const t = String(a).trim().replace(/\s+/g, " "); if (t && !seen.has(normalize(t))) { out.push(t); seen.add(normalize(t)); } }
  return out;
}

export const normalize = (s: string) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

const SEP_CLASS = "[\\s,\\-\\u2013\\u2014(\\uFF08:!.]";
const SEP_RE = new RegExp("^" + SEP_CLASS);
const LEADING_SEPS = new RegExp("^" + SEP_CLASS + "+");
const isSep = (ch: string) => SEP_RE.test(ch);

/** Brand part and the rest of a cell that fuses both ("BBT（Ardiya）", "Tabel - Qortuba", "Yelo! Pizza Zahra"). */
export function resolveBrand(text: string, brands: NameBrand[]): { brand: NameBrand; rest: string } | null {
  const t = normalize(text);
  if (!t) return null;
  const orig = String(text).trim().replace(/\s+/g, " ");   // same length as t: only the case differs
  const cands: { key: string; brand: NameBrand }[] = [];
  for (const b of brands) for (const n of [b.name, ...b.aliases]) { const k = normalize(n); if (k) cands.push({ key: k, brand: b }); }
  const exact = cands.find((c) => c.key === t);
  if (exact) return { brand: exact.brand, rest: "" };
  const restOf = (len: number) => cleanRest(orig.slice(len));
  cands.sort((a, b) => b.key.length - a.key.length);
  for (const c of cands) {
    if (!t.startsWith(c.key)) continue;
    const next = t.charAt(c.key.length);
    if (next === "" || isSep(next)) return { brand: c.brand, rest: restOf(c.key.length) };
  }
  return null;
}

const cleanRest = (s: string) => s.replace(LEADING_SEPS, "").replace(/[)）\s]+$/, "").trim();

const TOKEN_ALIAS: Record<string, string> = {};
const alias = (canon: string, variants: string) => { for (const v of variants.split(",")) TOKEN_ALIAS[v.trim()] = canon; };
alias("khiran", "khairan,khiran");
alias("qurtuba", "qortuba,qurtuba,qortoba,qurtoba");
alias("ardiya", "ardhiya,ardiya,ardiyah,adriya,ard");
alias("adailiya", "adailiay,ediliya,adiliya,adailiya,adaliya");
alias("mishref", "mishrif,mishref");
alias("hawally", "hawalli,hawaly,hawally,hawaliy,haw");
alias("maidan", "midan,maidan");
alias("mahboula", "mahboula,mah");
alias("salmiya", "salmiya,smy");
alias("abdullah", "abdallah,abdulla,abdullah");
alias("andalus", "andalous,andalus");
alias("ahmed", "ahmad,ahmed");
alias("um", "om,um,umm");
alias("haiman", "himan,haiman,hayman,hyman");
alias("shuyoukh", "shuyukh,shuyoukh,shyoukh");
alias("jleeb", "jleeb,jeleeb");
alias("kabir", "kabeer,kabir");
alias("qar", "gar,qar,algar");
alias("salem", "alsalem,alsalim,salim,salem");
alias("fnaitees", "fnaites,fnaitees,fnaitess");
alias("egaila", "eqaila,egaila");
alias("ishbiliya", "ashbeliah,ishbiliya,ishbilya");
alias("dahiya", "dhahia,dahiya");
alias("khaitan", "khaithan,khaitan");

const FILLER = new Set("al the a of co op coop ind industrial area mall metro residential core complex markets market aswaq tgo tmp".split(" "));
const NEVER_EQ = new Set(["khaitan|khiran", "jahra|zahra", "salmiya|salwa", "salmiya|shamiya", "rai|reggai", "adailiya|adan"].map((p) => p.split("|").sort().join("|")));
const PHRASES: [RegExp, string][] = [[/\bs abdullah\b/g, "saad abdullah"], [/\bs abdallah\b/g, "saad abdullah"], [/\bs salem\b/g, "sabah salem"], [/\bw abdullah\b/g, "west abdullah"], [/\bw abdallah\b/g, "west abdullah"]];

export function tokenize(text: string): string[] {
  let s = normalize(text).replace(/[–—/\\\-_.,()（）!:;'"]/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  const out: string[] = [];
  for (const raw of s.split(" ")) {
    if (!raw) continue;
    const tok = TOKEN_ALIAS[raw] || raw;
    if (FILLER.has(tok)) continue;
    if (/^\d+$/.test(tok) || /^\d+[a-z]$/.test(tok) || /^[a-z]\d+$/.test(tok)) continue;   // branch codes
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (NEVER_EQ.has([a, b].sort().join("|"))) return 0;
  const len = Math.min(a.length, b.length);
  if (len < 5) return 0;
  const d = lev(a, b);
  if (len >= 8 ? d <= 2 : d <= 1) return 0.85;
  return 0;
}

/** 0.5 x jaccard + 0.5 x containment over one-to-one paired tokens; also how many pairs were identical. */
export function scoreTokens(a: string[], b: string[]): { score: number; exact: number } {
  if (!a.length || !b.length) return { score: 0, exact: 0 };
  const usedA = new Set<number>(), usedB = new Set<number>();
  let overlap = 0, exact = 0;
  for (let i = 0; i < a.length; i++) { const j = b.findIndex((t, k) => !usedB.has(k) && t === a[i]); if (j >= 0) { usedA.add(i); usedB.add(j); overlap += 1; exact++; } }
  const pairs: { i: number; j: number; s: number }[] = [];
  for (let i = 0; i < a.length; i++) if (!usedA.has(i)) for (let j = 0; j < b.length; j++) if (!usedB.has(j)) { const s = tokenSimilarity(a[i], b[j]); if (s > 0) pairs.push({ i, j, s }); }
  pairs.sort((x, y) => y.s - x.s);
  for (const p of pairs) if (!usedA.has(p.i) && !usedB.has(p.j)) { usedA.add(p.i); usedB.add(p.j); overlap += p.s; }
  const jaccard = overlap / (a.length + b.length - overlap);
  const containment = overlap / Math.min(a.length, b.length);
  return { score: 0.5 * jaccard + 0.5 * containment, exact };
}

/** A cell for a brand we do not know yet: the first part is the brand name, the rest is the branch ("Zorro Wraps, Jahra"). */
export function splitVendor(text: string): { brand: string; rest: string } {
  const s = String(text ?? "").trim().replace(/\s+/g, " ");
  const m = s.match(/\s*(?:[,（(]|\s[-–—]\s)\s*/);
  if (!m || m.index === undefined || m.index === 0) return { brand: s, rest: "" };
  return { brand: s.slice(0, m.index).trim(), rest: cleanRest(s.slice(m.index + m[0].length)) };
}

const signature = (s: string) => tokenize(s).sort().join(" ");

/**
 * Which branch of ONE brand does this text mean?
 * 1) exact on canonical name or alias; 2) strip the brand's own name and try exact again; 3) fuzzy tokens.
 * `neverAutoLink`: store names that genuinely name two branches at once — they only ever get suggested.
 */
export function matchBranch(text: string, brand: { name: string; aliases: string[] }, branches: NameBranch[], neverAutoLink: string[] = []): BranchMatch {
  const t = normalize(text);
  const none: BranchMatch = { status: "unknown", branch: null, score: 0, suggestions: [] };
  if (!t) return none;
  const keysOf = (b: NameBranch) => [b.name, ...b.aliases];
  const exactIn = (x: string) => branches.find((b) => keysOf(b).some((k) => normalize(k) === x));

  let hit = exactIn(t);
  if (hit) return { status: "matched", branch: hit, score: 1, suggestions: [{ id: hit.id, name: hit.name, score: 1 }] };

  let stripped = t;
  const brandKeys = [brand.name, ...brand.aliases].map(normalize).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const k of brandKeys) {
    if (t.startsWith(k) && (t.length === k.length || isSep(t.charAt(k.length)))) { stripped = cleanRest(t.slice(k.length)); break; }
  }
  if (stripped !== t) {
    hit = exactIn(stripped);
    if (hit) return { status: "matched", branch: hit, score: 1, suggestions: [{ id: hit.id, name: hit.name, score: 1 }] };
  }
  const q = tokenize(stripped);
  if (!q.length) return none;

  const scored = branches.map((b) => {
    let best = { score: 0, exact: 0 };
    for (const k of keysOf(b)) { const r = scoreTokens(q, tokenize(k)); if (r.score > best.score || (r.score === best.score && r.exact > best.exact)) best = r; }
    return { b, ...best };
  }).sort((x, y) => y.score - x.score || y.exact - x.exact);

  const suggestions = scored.filter((x) => x.score >= SUGGEST_FROM).slice(0, 3).map((x) => ({ id: x.b.id, name: x.b.name, score: Math.round(x.score * 100) / 100 }));
  const top = scored[0];
  if (!top || top.score < SUGGEST_FROM) return none;
  const twoAtOnce = neverAutoLink.some((n) => signature(n) === q.slice().sort().join(" "));
  if (top.score >= AUTO_LINK && !twoAtOnce) return { status: "matched", branch: top.b, score: top.score, suggestions };
  return { status: "suggest", branch: top.b, score: top.score, suggestions };
}
