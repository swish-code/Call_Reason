// Database side of brand / branch name matching (the matching itself is in nameMatch.ts and has no database).
import fs from "fs";
import path from "path";
import { pool } from "./db.js";
import { BRANCH_REGISTRY } from "./branchRegistry.js";
import { matchBranch, mergeAliases, normalize, parseAliases, resolveBrand, type BranchMatch, type NameBranch, type NameBrand } from "./nameMatch.js";

export interface Catalog {
  brands: NameBrand[];
  branches: Map<string, NameBranch[]>;        // brand id -> its branches
  neverAutoLink: Map<string, string[]>;       // brand id -> names that mean two branches at once
}

export async function loadCatalog(): Promise<Catalog> {
  const [b, br] = await Promise.all([
    pool.query("SELECT id, brand_name, aliases FROM brands ORDER BY brand_name"),
    pool.query("SELECT id, branch_name, brand, aliases FROM branches ORDER BY branch_name"),
  ]);
  const brands: NameBrand[] = b.rows.map((r: any) => ({ id: r.id, name: r.brand_name, aliases: parseAliases(r.aliases) }));
  const byName = new Map(brands.map((x) => [normalize(x.name), x.id]));
  const branches = new Map<string, NameBranch[]>();
  for (const r of br.rows as any[]) {
    const bid = byName.get(normalize(r.brand || ""));
    if (!bid) continue;
    if (!branches.has(bid)) branches.set(bid, []);
    branches.get(bid)!.push({ id: r.id, name: r.branch_name, aliases: parseAliases(r.aliases) });
  }
  const neverAutoLink = new Map<string, string[]>();
  for (const reg of BRANCH_REGISTRY) { const id = byName.get(normalize(reg.brand)); if (id && reg.neverAutoLink) neverAutoLink.set(id, reg.neverAutoLink); }
  return { brands, branches, neverAutoLink };
}

export interface ResolvedNames {
  brand: NameBrand | null;
  /** The branch text as the file wrote it (empty when the file had none). */
  rawBranch: string;
  match: BranchMatch | null;
}

/** One cell may carry brand and branch together ("Tabel, Ardhiya"); a separate Branch cell wins when there is one. */
export function resolveNames(cat: Catalog, brandCell: string, branchCell: string): ResolvedNames {
  const hit = resolveBrand(brandCell, cat.brands);
  if (!hit) return { brand: null, rawBranch: String(branchCell || "").trim(), match: null };
  const rawBranch = String(branchCell || "").trim() || hit.rest;
  const match = rawBranch ? matchBranch(rawBranch, hit.brand, cat.branches.get(hit.brand.id) || [], cat.neverAutoLink.get(hit.brand.id) || []) : null;
  return { brand: hit.brand, rawBranch, match };
}

/** Merge the registry (and the learned-aliases file) into the stored aliases. Never renames, replaces or creates. */
export async function seedNameRegistry(): Promise<{ brandsTouched: number; branchesTouched: number }> {
  let brandsTouched = 0, branchesTouched = 0;
  const brandRows = (await pool.query("SELECT id, brand_name, aliases FROM brands")).rows as any[];
  const branchRows = (await pool.query("SELECT id, branch_name, brand, aliases FROM branches")).rows as any[];
  const learned = readLearnedFile();

  const setBrand = async (row: any, add: string[]) => {
    const cur = parseAliases(row.aliases), next = mergeAliases(cur, add);
    if (next.length !== cur.length) { await pool.query("UPDATE brands SET aliases = $1 WHERE id = $2", [JSON.stringify(next), row.id]); row.aliases = JSON.stringify(next); brandsTouched++; }
  };
  const setBranch = async (row: any, add: string[]) => {
    const cur = parseAliases(row.aliases), next = mergeAliases(cur, add);
    if (next.length !== cur.length) { await pool.query("UPDATE branches SET aliases = $1 WHERE id = $2", [JSON.stringify(next), row.id]); row.aliases = JSON.stringify(next); branchesTouched++; }
  };
  const brandByName = (n: string) => brandRows.find((r) => normalize(r.brand_name) === normalize(n));
  const branchOf = (brand: string, n: string) => branchRows.find((r) => normalize(r.brand || "") === normalize(brand) && normalize(r.branch_name) === normalize(n));

  for (const reg of BRANCH_REGISTRY) {
    const b = brandByName(reg.brand);
    if (!b) continue;
    if (reg.brandAliases?.length) await setBrand(b, reg.brandAliases);
    for (const br of reg.branches || []) { const row = branchOf(reg.brand, br.name); if (row) await setBranch(row, br.aliases); }
  }
  for (const [name, list] of Object.entries(learned.brands || {})) { const b = brandByName(name); if (b) await setBrand(b, list); }
  for (const [key, list] of Object.entries(learned.branches || {})) {
    const i = key.indexOf("/"); if (i < 0) continue;
    const row = branchOf(key.slice(0, i), key.slice(i + 1)); if (row) await setBranch(row, list);
  }
  return { brandsTouched, branchesTouched };
}

type Learned = { brands?: Record<string, string[]>; branches?: Record<string, string[]> };
function readLearnedFile(): Learned {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), "server", "learned-aliases.json"), "utf8")); } catch { return {}; }
}

/** Every alias in the database, in the learned-aliases.json shape (keep that file in the repo so a rebuilt database loses nothing). */
export async function exportAliases(): Promise<Learned> {
  const out: Learned = { brands: {}, branches: {} };
  for (const r of (await pool.query("SELECT brand_name, aliases FROM brands")).rows as any[]) { const a = parseAliases(r.aliases); if (a.length) out.brands![r.brand_name] = a; }
  for (const r of (await pool.query("SELECT branch_name, brand, aliases FROM branches")).rows as any[]) { const a = parseAliases(r.aliases); if (a.length && r.brand) out.branches![`${r.brand}/${r.branch_name}`] = a; }
  return out;
}

/** Mark a stored rating with how its branch name was resolved (called right after the upsert). */
export async function stampRatingNames(key: { brand_id: string; platform_id: string; order_id: string }, v: { branch: string | null; branch_raw: string | null; branch_id: string | null; status: "matched" | "unmatched" | null }) {
  await pool.query(
    "UPDATE ratings SET branch = COALESCE($1, branch), branch_raw = $2, branch_id = $3, name_status = $4 WHERE brand_id = $5 AND platform_id = $6 AND order_id = $7",
    [v.branch, v.branch_raw, v.branch_id, v.status, key.brand_id, key.platform_id, key.order_id],
  );
}

/** Keep a row whose brand is not known yet, with everything needed to import it later (one copy per order). */
export async function holdRatingRow(batchId: string, rawBrand: string, data: Record<string, any>) {
  const dup = await pool.query(
    "SELECT 1 FROM rating_held_rows WHERE status = 'open' AND raw_brand = $1 AND row_data->>'order_id' = $2 AND row_data->>'platform_id' = $3 LIMIT 1",
    [rawBrand, String(data.order_id), String(data.platform_id)],
  );
  if (dup.rowCount) return;
  await pool.query("INSERT INTO rating_held_rows (id, batch_id, raw_brand, row_data) VALUES ($1,$2,$3,$4)",
    ["held-" + Date.now() + "-" + Math.floor(Math.random() * 99999), batchId, rawBrand, JSON.stringify(data)]);
}
