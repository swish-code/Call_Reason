// The Ratings & Reviews branch report: one brand (and one branch of it) over a period — reviews, average, complaints,
// what the complaints are about, and the latest complaints — against the same period for all branches together.
// Days are the review's own day (the same rule as the dashboard). A complaint is a review of 1-2 stars (or 1-3).
import { pool } from "./db.js";
import { REVIEW_DAY, IN_PERIOD } from "./ratingsDashboard.js";
import { REASONS, UNSPECIFIED, reasonsOf } from "./complaintReasons.js";
import { loadCatalog } from "./nameRegistry.js";
import { matchBranch, tokenize } from "./nameMatch.js";

const LABEL = new Map<string, string>([...REASONS.map((r) => [r.key, r.label] as [string, string]), [UNSPECIFIED.key, UNSPECIFIED.label]]);
const SHORT = new Map<string, string>([...REASONS.map((r) => [r.key, r.short] as [string, string]), [UNSPECIFIED.key, UNSPECIFIED.short]]);
const KEYS = [...REASONS.map((r) => r.key), UNSPECIFIED.key];
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

// Reviews carry the branch as it was spelled when they were uploaded ("Adailiya", "Adailiay", "Ardhiya" / "Ardiya"...).
// One branch must be ONE entry: a spelling that the name registry knows becomes the branch's own name; the rest are
// grouped by their words (the same spelling rules the registry uses), named after their commonest spelling.
interface Canon { of(brandId: string, raw: string): string; variants(brandId: string, name: string): string[]; names(brandId: string): string[] }
async function loadCanon(): Promise<Canon> {
  const cat = await loadCatalog();
  const pairs = (await pool.query(`SELECT brand_id, btrim(branch) AS raw, count(*)::int AS n FROM ratings WHERE branch IS NOT NULL AND btrim(branch) <> '' AND brand_id IS NOT NULL GROUP BY 1, 2`)).rows as { brand_id: string; raw: string; n: number }[];
  const byBrand = new Map<string, Map<string, string[]>>();       // brand -> canonical name -> raw spellings
  const canonOf = new Map<string, string>();                      // brand|raw -> canonical name
  const groups = new Map<string, { brand_id: string; items: { raw: string; n: number }[] }>(); // brand|signature -> unmatched spellings
  for (const pr of pairs) {
    const brand = cat.brands.find((bb) => bb.id === pr.brand_id);
    const m = brand ? matchBranch(pr.raw, brand, cat.branches.get(brand.id) || [], cat.neverAutoLink.get(brand.id) || []) : null;
    if (m && m.status === "matched" && m.branch) { canonOf.set(pr.brand_id + "|" + pr.raw, m.branch.name); continue; }
    const key = pr.brand_id + "|" + tokenize(pr.raw).sort().join(" ");
    if (!groups.has(key)) groups.set(key, { brand_id: pr.brand_id, items: [] });
    groups.get(key)!.items.push({ raw: pr.raw, n: pr.n });
  }
  for (const g of groups.values()) {
    const label = [...g.items].sort((x, y) => y.n - x.n)[0].raw;
    for (const x of g.items) canonOf.set(g.brand_id + "|" + x.raw, label);
  }
  for (const pr of pairs) {
    const name = canonOf.get(pr.brand_id + "|" + pr.raw) || pr.raw;
    if (!byBrand.has(pr.brand_id)) byBrand.set(pr.brand_id, new Map());
    const m = byBrand.get(pr.brand_id)!;
    if (!m.has(name)) m.set(name, []);
    m.get(name)!.push(pr.raw);
  }
  return {
    of: (brandId, raw) => canonOf.get(brandId + "|" + String(raw || "").trim()) || String(raw || "").trim(),
    variants: (brandId, name) => byBrand.get(brandId)?.get(name) || [name],
    names: (brandId) => [...(byBrand.get(brandId)?.keys() || [])].sort((a, b) => a.localeCompare(b)),
  };
}

/** Every brand with its branches, each branch once (for the two dropdowns). */
export async function getBranchOptions(): Promise<{ brands: { id: string; name: string; branches: string[] }[]; platforms: { id: string; name: string }[] }> {
  const canon = await loadCanon();
  const { rows } = await pool.query(`SELECT DISTINCT b.id, b.brand_name FROM ratings r JOIN brands b ON b.id = r.brand_id ORDER BY 2`);
  const pl = (await pool.query(`SELECT DISTINCT p.id, p.name FROM ratings r JOIN platforms p ON p.id = r.platform_id ORDER BY 2`)).rows;
  return { brands: rows.map((r: any) => ({ id: r.id, name: r.brand_name, branches: canon.names(r.id) })), platforms: pl.map((p: any) => ({ id: p.id, name: p.name })) };
}

export async function getBranchReport(opts: { from: string; to: string; brandId: string | null; branch: string | null; platformId?: string | null; maxStars: number }): Promise<any> {
  const { from, to, brandId, branch, maxStars } = opts;
  const P = [from, to];
  const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const canon = await loadCanon();
  // The picked branch is one name; its reviews carry every spelling of it.
  const spellings = branch && brandId ? canon.variants(brandId, branch) : branch ? [branch] : [];
  const scopeW = (brandId ? ` AND r.brand_id = ${lit(brandId)}` : "") + (spellings.length ? ` AND btrim(r.branch) IN (${spellings.map(lit).join(",")})` : "");

  // The aggregator filter narrows both the branch and the all-branch yardstick, so the comparison stays like for like.
  const platW = opts.platformId ? ` AND r.platform_id = ${lit(opts.platformId)}` : "";
  // All branches, same period: the yardstick.
  const [co] = (await pool.query(
    `SELECT count(*)::int AS reviews, COALESCE(round(avg(rating)::numeric, 2), 0)::float AS avg, count(*) FILTER (WHERE rating <= ${maxStars})::int AS complaints
       FROM ratings r WHERE ${IN_PERIOD}${platW}`, P)).rows;
  const coTexts = (await pool.query(`SELECT review_text FROM ratings r WHERE ${IN_PERIOD}${platW} AND rating <= ${maxStars}`, P)).rows;
  const coCount: Record<string, number> = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const t of coTexts) { const rs = reasonsOf(t.review_text); if (!rs.length) coCount.unspecified++; for (const k of rs) coCount[k]++; }

  // This brand / branch.
  const rows = (await pool.query(
    `SELECT r.id, r.rating, r.review_text, r.order_id, btrim(r.branch) AS branch, r.brand_id, b.brand_name, p.name AS platform, ${REVIEW_DAY} AS day
       FROM ratings r LEFT JOIN brands b ON b.id = r.brand_id LEFT JOIN platforms p ON p.id = r.platform_id
      WHERE ${IN_PERIOD}${scopeW}${platW}
      ORDER BY ${REVIEW_DAY} DESC, r.uploaded_at DESC`, P)).rows;

  const reviews = rows.length;
  const avg = reviews ? Math.round((rows.reduce((a: number, r: any) => a + r.rating, 0) / reviews) * 100) / 100 : 0;
  const complaintRows = rows.filter((r: any) => r.rating <= maxStars).map((r: any) => ({ ...r, reasons: reasonsOf(r.review_text) }));
  const complaints = complaintRows.length;
  const count: Record<string, number> = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const r of complaintRows) { if (!r.reasons.length) count.unspecified++; for (const k of r.reasons) count[k]++; }

  const reasons = KEYS.map((k) => ({ key: k, label: LABEL.get(k)!, count: count[k], pct_branch: Math.round((count[k] / (complaints || 1)) * 100), pct_all: Math.round((coCount[k] / (co.complaints || 1)) * 100) }));
  const main = [...reasons].filter((r) => r.key !== "unspecified").sort((a, b) => b.count - a.count)[0];
  const rate = pct(complaints, reviews), coRate = pct(co.complaints, co.reviews);
  const CAP = 500;
  const stars = [1, 2, 3, 4, 5].map((n) => rows.filter((r: any) => r.rating === n).length);
  // Written = the customer left words; rating only = stars with no comment.
  const written = rows.filter((r: any) => String(r.review_text || "").trim() !== "").length;
  const byPlat = new Map<string, { total: number; sum: number; neg: number }>();
  for (const r of rows) {
    const k = r.platform || "—";
    const x = byPlat.get(k) || { total: 0, sum: 0, neg: 0 };
    x.total++; x.sum += r.rating; if (r.rating <= maxStars) x.neg++;
    byPlat.set(k, x);
  }
  const platforms = [...byPlat.entries()].map(([name, x]) => ({ name, total: x.total, avg: Math.round((x.sum / x.total) * 100) / 100, negative: x.neg, rate: pct(x.neg, x.total) })).sort((a, b) => b.total - a.total);

  return {
    range: { from, to }, max_stars: maxStars,
    platforms,
    kpi: { reviews, written, rating_only: reviews - written, avg, complaints, complaint_rate: rate, main_issue: main && main.count ? (SHORT.get(main.key) || main.label) : "—", status: reviews && rate > coRate ? "ACTION" : "OK" },
    company: { reviews: co.reviews, avg: co.avg, complaints: co.complaints, complaint_rate: coRate },
    reasons, stars,
    complaints: complaintRows.slice(0, CAP).map((r: any) => ({ day: r.day, platform: r.platform || "", order_id: r.order_id, rating: r.rating, reasons: r.reasons.map((k: string) => SHORT.get(k) || k), text: r.review_text || "", branch: r.brand_id ? canon.of(r.brand_id, r.branch) : (r.branch || ""), brand: r.brand_name || "" })),
    complaints_total: complaints, cap: CAP,
  };
}
