// One customer, three call lists: Ratings & Reviews, Surveys and the Shakir campaign each call from their own list, so
// the same person can be rung by all three. This module reads the three lists side by side (read-only):
//   - the Shared Numbers report: every number that sits in two or three of them, and where it stands in each
//   - the "also in…" warning an agent sees before calling: the number's other open tasks and its recent calls
// A number is matched on its last 8 digits (the same key Do Not Call uses), so "+965 9xxx xxxx" and "9xxxxxxx" are one.
import { pool } from "./db.js";

export type Source = "reviews" | "surveys" | "shakir";
export const RECENT_CALL_DAYS = 10;   // "called lately" for the warning — the same span the survey upload already uses

const KEY = (col: string) => `right(regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g'), 8)`;

// Every record of the three lists as one row. $KEYW is an extra condition per list ("" for all, or a key match).
const entriesSql = (w: { reviews: string; surveys: string; shakir: string }) => `
  SELECT 'reviews' AS source, r.id, ${KEY("r.customer_phone")} AS key, r.customer_phone AS phone, r.customer_name AS name,
         concat_ws(' · ', b.brand_name, p.name) AS label, r.action_status AS status, r.action_status IN ('pending','in_progress') AS open,
         u.full_name AS agent, r.uploaded_at AS created_at,
         COALESCE(lc.created_at, CASE WHEN r.recorded_by IS NOT NULL THEN r.resolved_at END) AS contacted_at,
         COALESCE(lc.outcome, CASE WHEN r.recorded_by IS NOT NULL THEN r.action_status END) AS result, lc.agent_name AS contacted_by
    FROM ratings r
    LEFT JOIN brands b ON b.id = r.brand_id LEFT JOIN platforms p ON p.id = r.platform_id LEFT JOIN users u ON u.id = r.assigned_agent_id
    LEFT JOIN LATERAL (SELECT c.created_at, c.outcome, c.agent_name FROM rating_call_attempts c WHERE c.rating_id = r.id ORDER BY c.created_at DESC LIMIT 1) lc ON true
   WHERE r.requires_action AND length(${KEY("r.customer_phone")}) = 8 ${w.reviews}
  UNION ALL
  SELECT 'surveys', a.id, ${KEY("a.customer_phone")}, a.customer_phone, a.customer_name,
         concat_ws(' · ', b.brand_name, t.name), a.status, a.status IN ('pending','in_progress'),
         u.full_name, a.created_at,
         CASE WHEN a.status = 'cancelled' THEN NULL ELSE COALESCE(lc.created_at, a.completed_at) END,
         CASE WHEN a.status = 'cancelled' THEN NULL ELSE COALESCE(lc.outcome, CASE WHEN a.completed_at IS NOT NULL THEN a.status END) END, lu.full_name
    FROM survey_assignments a
    LEFT JOIN survey_campaigns c ON c.id = a.campaign_id LEFT JOIN survey_templates t ON t.id = c.template_id
    LEFT JOIN brands b ON b.id = a.brand_id LEFT JOIN users u ON u.id = a.assigned_agent_id
    LEFT JOIN LATERAL (SELECT s.created_at, s.outcome, s.agent_id FROM survey_call_attempts s WHERE s.assignment_id = a.id ORDER BY s.created_at DESC LIMIT 1) lc ON true
    LEFT JOIN users lu ON lu.id = lc.agent_id
   WHERE length(${KEY("a.customer_phone")}) = 8 ${w.surveys}
  UNION ALL
  SELECT 'shakir', oc.id, oc.phone_key, oc.phone, oc.customer_name,
         oc2.name, COALESCE(oc.call_result, oc.call_status), oc.call_status IN ('not_called','no_answer','busy','call_back'),
         u.full_name, oc.uploaded_at, oc.last_call_at,
         CASE WHEN oc.last_call_at IS NOT NULL THEN COALESCE(oc.call_result, oc.call_status) END, le.user_name
    FROM offer_customers oc
    LEFT JOIN offer_campaigns oc2 ON oc2.id = oc.campaign_id LEFT JOIN users u ON u.id = oc.assigned_agent_id
    LEFT JOIN LATERAL (SELECT e.user_name FROM offer_events e WHERE e.customer_id = oc.id AND e.kind = 'call' ORDER BY e.created_at DESC LIMIT 1) le ON true
   WHERE length(oc.phone_key) = 8 ${w.shakir}`;

/** Numbers that are in two or three of the lists. Looks at records that are still open, or were added / called in the last `days` days. */
export async function getSharedNumbers(days: number): Promise<{ days: number; numbers: any[]; cap: number; capped: boolean }> {
  const CAP = 30000;
  const fresh = (created: string, contacted: string, open: string) => `AND (${open} OR ${created} >= now() - ($1 || ' days')::interval OR ${contacted} >= now() - ($1 || ' days')::interval)`;
  const sql = `
    WITH e AS (${entriesSql({
      reviews: fresh("r.uploaded_at", "COALESCE(lc.created_at, r.resolved_at)", "r.action_status IN ('pending','in_progress')"),
      surveys: fresh("a.created_at", "COALESCE(lc.created_at, a.completed_at)", "a.status IN ('pending','in_progress')"),
      shakir: fresh("oc.uploaded_at", "oc.last_call_at", "oc.call_status IN ('not_called','no_answer','busy','call_back')"),
    })}),
    k AS (SELECT key FROM e GROUP BY key HAVING count(DISTINCT source) >= 2)
    SELECT e.* FROM e JOIN k USING (key) ORDER BY e.key, e.created_at DESC LIMIT ${CAP + 1}`;
  const rows = (await pool.query(sql, [String(days)])).rows;
  const capped = rows.length > CAP;
  const byKey = new Map<string, any>();
  for (const r of rows.slice(0, CAP)) {
    let n = byKey.get(r.key);
    if (!n) byKey.set(r.key, (n = { key: r.key, phone: r.phone, name: null as string | null, entries: [] as any[] }));
    if (!n.name && r.name) n.name = r.name;
    n.entries.push({ source: r.source, id: r.id, label: r.label, status: r.status, open: r.open, agent: r.agent, created_at: r.created_at, contacted_at: r.contacted_at, result: r.result, contacted_by: r.contacted_by });
  }
  const numbers = [...byKey.values()].map((n) => {
    const sources = [...new Set(n.entries.map((e: any) => e.source))] as Source[];
    const openSources = [...new Set(n.entries.filter((e: any) => e.open).map((e: any) => e.source))] as Source[];
    const calls = n.entries.map((e: any) => e.contacted_at).filter(Boolean).map((d: any) => new Date(d).getTime());
    return { ...n, sources, open_sources: openSources, calls: calls.length, last_contacted_at: calls.length ? new Date(Math.max(...calls)).toISOString() : null };
  }).sort((a, b) => b.open_sources.length - a.open_sources.length || b.sources.length - a.sources.length || String(b.last_contacted_at || "").localeCompare(String(a.last_contacted_at || "")));
  return { days, numbers, cap: CAP, capped };
}

/** What an agent should know before calling this number: its other open tasks, and calls made to it in the last days. */
export async function getOtherContacts(phone: string, except: { source: string; id: string }): Promise<{ key: string; days: number; items: any[] }> {
  const key = String(phone || "").replace(/\D/g, "").slice(-8);
  if (key.length !== 8) return { key, days: RECENT_CALL_DAYS, items: [] };
  const rows = (await pool.query(`
    WITH e AS (${entriesSql({ reviews: `AND ${KEY("r.customer_phone")} = $1`, surveys: `AND ${KEY("a.customer_phone")} = $1`, shakir: `AND oc.phone_key = $1` })})
    SELECT * FROM e WHERE NOT (source = $2 AND id = $3) AND (open OR contacted_at >= now() - interval '${RECENT_CALL_DAYS} days')
     ORDER BY contacted_at DESC NULLS LAST, created_at DESC LIMIT 20`, [key, except.source, except.id])).rows;
  return { key, days: RECENT_CALL_DAYS, items: rows.map((r: any) => ({ source: r.source, id: r.id, label: r.label, status: r.status, open: r.open, agent: r.agent, contacted_at: r.contacted_at, result: r.result, contacted_by: r.contacted_by })) };
}

/** The same check for a whole list at once (the mark beside each number in a queue): per record, in which other lists
 *  the number is still waiting and where it was called in the last days. Records with nothing are left out. */
export async function getOtherContactFlags(source: string, items: { id: string; phone: string }[]): Promise<Record<string, { waiting: string[]; called: { source: string; at: string; by: string | null; result: string | null }[] }>> {
  const keyed = items.map((i) => ({ id: String(i.id), key: String(i.phone || "").replace(/\D/g, "").slice(-8) })).filter((i) => i.key.length === 8);
  if (!keyed.length) return {};
  const keys = [...new Set(keyed.map((i) => i.key))];
  const rows = (await pool.query(`
    WITH e AS (${entriesSql({ reviews: `AND ${KEY("r.customer_phone")} = ANY($1)`, surveys: `AND ${KEY("a.customer_phone")} = ANY($1)`, shakir: `AND oc.phone_key = ANY($1)` })})
    SELECT source, id, key, open, contacted_at, contacted_by, result FROM e
     WHERE open OR contacted_at >= now() - interval '${RECENT_CALL_DAYS} days'`, [keys])).rows;
  const byKey = new Map<string, any[]>();
  for (const r of rows) { if (!byKey.has(r.key)) byKey.set(r.key, []); byKey.get(r.key)!.push(r); }
  const out: Record<string, any> = {};
  for (const it of keyed) {
    const others = (byKey.get(it.key) || []).filter((r) => !(r.source === source && r.id === it.id));
    if (!others.length) continue;
    const called = others.filter((r) => r.contacted_at).sort((a, b) => new Date(b.contacted_at).getTime() - new Date(a.contacted_at).getTime())
      .map((r) => ({ source: r.source, at: new Date(r.contacted_at).toISOString(), by: r.contacted_by || null, result: r.result || null }));
    const waiting = [...new Set(others.filter((r) => r.open && !r.contacted_at).map((r) => r.source))];
    out[it.id] = { waiting, called };
  }
  return out;
}
