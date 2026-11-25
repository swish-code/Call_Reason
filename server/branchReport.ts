// The Ratings & Reviews branch report: one brand (and one branch of it) over a period — reviews, average, complaints,
// what the complaints are about, and the latest complaints — against the same period for all branches together.
// Days are the review's own day (the same rule as the dashboard). A complaint is a review of 1-2 stars (or 1-3).
import { pool } from "./db.js";
import { REVIEW_DAY, IN_PERIOD } from "./ratingsDashboard.js";
import { REASONS, UNSPECIFIED, reasonsOf } from "./complaintReasons.js";

const LABEL = new Map<string, string>([...REASONS.map((r) => [r.key, r.label] as [string, string]), [UNSPECIFIED.key, UNSPECIFIED.label]]);
const SHORT = new Map<string, string>([...REASONS.map((r) => [r.key, r.short] as [string, string]), [UNSPECIFIED.key, UNSPECIFIED.short]]);
const KEYS = [...REASONS.map((r) => r.key), UNSPECIFIED.key];
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

/** Every brand with the branch names its reviews carry (for the two dropdowns). */
export async function getBranchOptions(): Promise<{ brands: { id: string; name: string; branches: string[] }[] }> {
  const { rows } = await pool.query(
    `SELECT b.id, b.brand_name, array_agg(DISTINCT btrim(r.branch)) FILTER (WHERE r.branch IS NOT NULL AND btrim(r.branch) <> '') AS branches
       FROM ratings r JOIN brands b ON b.id = r.brand_id GROUP BY 1, 2 ORDER BY 2`);
  return { brands: rows.map((r: any) => ({ id: r.id, name: r.brand_name, branches: (r.branches || []).sort((a: string, c: string) => a.localeCompare(c)) })) };
}

export async function getBranchReport(opts: { from: string; to: string; brandId: string | null; branch: string | null; maxStars: number }): Promise<any> {
  const { from, to, brandId, branch, maxStars } = opts;
  const P = [from, to];
  const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const scopeW = (brandId ? ` AND r.brand_id = ${lit(brandId)}` : "") + (branch ? ` AND btrim(r.branch) = ${lit(branch)}` : "");

  // All branches, same period: the yardstick.
  const [co] = (await pool.query(
    `SELECT count(*)::int AS reviews, COALESCE(round(avg(rating)::numeric, 2), 0)::float AS avg, count(*) FILTER (WHERE rating <= ${maxStars})::int AS complaints
       FROM ratings r WHERE ${IN_PERIOD}`, P)).rows;
  const coTexts = (await pool.query(`SELECT review_text FROM ratings r WHERE ${IN_PERIOD} AND rating <= ${maxStars}`, P)).rows;
  const coCount: Record<string, number> = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const t of coTexts) { const rs = reasonsOf(t.review_text); if (!rs.length) coCount.unspecified++; for (const k of rs) coCount[k]++; }

  // This brand / branch.
  const rows = (await pool.query(
    `SELECT r.id, r.rating, r.review_text, r.order_id, btrim(r.branch) AS branch, b.brand_name, p.name AS platform, ${REVIEW_DAY} AS day
       FROM ratings r LEFT JOIN brands b ON b.id = r.brand_id LEFT JOIN platforms p ON p.id = r.platform_id
      WHERE ${IN_PERIOD}${scopeW}
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

  return {
    range: { from, to }, max_stars: maxStars,
    kpi: { reviews, avg, complaints, complaint_rate: rate, main_issue: main && main.count ? (SHORT.get(main.key) || main.label) : "—", status: reviews && rate > coRate ? "ACTION" : "OK" },
    company: { reviews: co.reviews, avg: co.avg, complaints: co.complaints, complaint_rate: coRate },
    reasons, stars,
    complaints: complaintRows.slice(0, CAP).map((r: any) => ({ day: r.day, platform: r.platform || "", order_id: r.order_id, rating: r.rating, reasons: r.reasons.map((k: string) => SHORT.get(k) || k), text: r.review_text || "", branch: r.branch || "", brand: r.brand_name || "" })),
    complaints_total: complaints, cap: CAP,
  };
}
