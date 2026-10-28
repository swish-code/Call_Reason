// The Ratings & Reviews dashboard (the Reviews page → Dashboard tab), built like the Surveys dashboard: what is waiting
// right now, what the period brought in and what agents closed in it, per day, per agent, per platform and brand, and
// the commented reviews themselves. Days are Kuwait days.
import { pool } from "./db.js";

const DAY = (col: string) => `(${col} AT TIME ZONE 'Asia/Kuwait')::date`;
const CLOSED = `('resolved','no_action_needed','unreachable')`;

export async function getRatingsDashboard(from: string, to: string, agentId: string | null): Promise<any> {
  const P = [from, to];
  const agentW = agentId ? `AND r.assigned_agent_id = '${agentId.replace(/'/g, "''")}'` : "";
  const q = async (sql: string, params: any[] = P) => (await pool.query(sql, params)).rows;

  // Right now: open tasks, unaffected by the period.
  const [live] = await q(`
    SELECT count(*) FILTER (WHERE requires_action AND action_status = 'pending' AND assigned_agent_id IS NULL)::int AS unassigned,
           count(*) FILTER (WHERE requires_action AND action_status = 'pending' AND assigned_agent_id IS NOT NULL)::int AS pending,
           count(*) FILTER (WHERE requires_action AND action_status = 'in_progress')::int AS in_progress,
           count(*) FILTER (WHERE requires_action AND action_status IN ('pending','in_progress') AND customer_phone IS NULL)::int AS no_phone,
           count(*) FILTER (WHERE requires_action AND action_status IN ('pending','in_progress') AND uploaded_at < now() - interval '3 days')::int AS older_3d
      FROM ratings`, []);
  const liveAgents = await q(`
    SELECT u.full_name AS agent, r.assigned_agent_id AS agent_id,
           count(*) FILTER (WHERE r.action_status = 'pending')::int AS pending,
           count(*) FILTER (WHERE r.action_status = 'in_progress')::int AS in_progress,
           count(*) FILTER (WHERE r.action_status IN ('pending','in_progress') AND r.uploaded_at < now() - interval '3 days')::int AS older_3d
      FROM ratings r JOIN users u ON u.id = r.assigned_agent_id
     WHERE r.requires_action AND r.action_status IN ('pending','in_progress')
     GROUP BY 1, 2 ORDER BY (count(*)) DESC`, []);

  // The period, by upload day: what came in.
  const [up] = await q(`
    SELECT count(*)::int AS uploaded, count(*) FILTER (WHERE requires_action)::int AS tasks,
           count(*) FILTER (WHERE NOT requires_action)::int AS auto_closed,
           count(*) FILTER (WHERE review_text IS NOT NULL AND btrim(review_text) <> '')::int AS with_comment,
           COALESCE(round(avg(rating)::numeric, 2), 0)::float AS avg_rating,
           count(*) FILTER (WHERE rating = 1)::int AS s1, count(*) FILTER (WHERE rating = 2)::int AS s2, count(*) FILTER (WHERE rating = 3)::int AS s3,
           count(*) FILTER (WHERE rating = 4)::int AS s4, count(*) FILTER (WHERE rating = 5)::int AS s5
      FROM ratings r WHERE ${DAY("r.uploaded_at")} BETWEEN $1::date AND $2::date ${agentW}`);
  // The period, by closing day: what people finished (recorded_by = a person closed it; the upload's own closures have none).
  const [done] = await q(`
    SELECT count(*)::int AS closed,
           count(*) FILTER (WHERE action_status = 'resolved')::int AS resolved,
           count(*) FILTER (WHERE action_status = 'no_action_needed')::int AS no_action,
           count(*) FILTER (WHERE action_status = 'unreachable')::int AS unreachable,
           COALESCE(round(avg(EXTRACT(EPOCH FROM (resolved_at - uploaded_at)) / 3600)::numeric, 1), 0)::float AS avg_hours
      FROM ratings r WHERE r.recorded_by IS NOT NULL AND ${DAY("r.resolved_at")} BETWEEN $1::date AND $2::date ${agentW}`);
  const attempts = await q(`
    SELECT count(*)::int AS n, count(*) FILTER (WHERE outcome = 'answered')::int AS answered
      FROM rating_call_attempts c JOIN ratings r ON r.id = c.rating_id
     WHERE ${DAY("c.created_at")} BETWEEN $1::date AND $2::date ${agentId ? "AND c.agent_id = $3" : ""}`, agentId ? [...P, agentId] : P);

  const days = await q(`
    WITH d AS (SELECT generate_series($1::date, $2::date, '1 day')::date AS day),
         u AS (SELECT ${DAY("r.uploaded_at")} AS day, count(*)::int AS uploaded, count(*) FILTER (WHERE requires_action)::int AS tasks
                 FROM ratings r WHERE ${DAY("r.uploaded_at")} BETWEEN $1::date AND $2::date ${agentW} GROUP BY 1),
         c AS (SELECT ${DAY("r.resolved_at")} AS day, count(*)::int AS closed
                 FROM ratings r WHERE r.recorded_by IS NOT NULL AND ${DAY("r.resolved_at")} BETWEEN $1::date AND $2::date ${agentW} GROUP BY 1)
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(u.uploaded, 0) AS uploaded, COALESCE(u.tasks, 0) AS tasks, COALESCE(c.closed, 0) AS closed
      FROM d LEFT JOIN u USING (day) LEFT JOIN c USING (day) ORDER BY d.day`);

  // Per agent in the period: closed by them (by closing day) and the calls they logged.
  const agents = await q(`
    WITH cl AS (SELECT r.recorded_by AS agent_id, count(*)::int AS closed,
                       count(*) FILTER (WHERE action_status = 'resolved')::int AS resolved,
                       count(*) FILTER (WHERE action_status = 'no_action_needed')::int AS no_action,
                       count(*) FILTER (WHERE action_status = 'unreachable')::int AS unreachable,
                       COALESCE(round(avg(EXTRACT(EPOCH FROM (resolved_at - uploaded_at)) / 3600)::numeric, 1), 0)::float AS avg_hours
                  FROM ratings r WHERE r.recorded_by IS NOT NULL AND ${DAY("r.resolved_at")} BETWEEN $1::date AND $2::date GROUP BY 1),
         at AS (SELECT agent_id, count(*)::int AS attempts, count(*) FILTER (WHERE outcome = 'answered')::int AS answered
                  FROM rating_call_attempts c WHERE ${DAY("c.created_at")} BETWEEN $1::date AND $2::date GROUP BY 1),
         op AS (SELECT assigned_agent_id AS agent_id, count(*)::int AS open FROM ratings
                 WHERE requires_action AND action_status IN ('pending','in_progress') AND assigned_agent_id IS NOT NULL GROUP BY 1),
         ids AS (SELECT agent_id FROM cl UNION SELECT agent_id FROM at UNION SELECT agent_id FROM op)
    SELECT ids.agent_id, u.full_name AS agent, COALESCE(cl.closed, 0) AS closed, COALESCE(cl.resolved, 0) AS resolved, COALESCE(cl.no_action, 0) AS no_action,
           COALESCE(cl.unreachable, 0) AS unreachable, COALESCE(cl.avg_hours, 0) AS avg_hours, COALESCE(at.attempts, 0) AS attempts, COALESCE(at.answered, 0) AS answered, COALESCE(op.open, 0) AS open
      FROM ids LEFT JOIN cl USING (agent_id) LEFT JOIN at USING (agent_id) LEFT JOIN op USING (agent_id) LEFT JOIN users u ON u.id = ids.agent_id
     WHERE ids.agent_id IS NOT NULL ORDER BY closed DESC, open DESC, agent`);

  const platforms = await q(`
    SELECT COALESCE(p.name, '—') AS name, count(*)::int AS reviews, count(*) FILTER (WHERE requires_action)::int AS tasks,
           COALESCE(round(avg(rating)::numeric, 2), 0)::float AS avg, count(*) FILTER (WHERE rating <= 2)::int AS low
      FROM ratings r LEFT JOIN platforms p ON p.id = r.platform_id
     WHERE ${DAY("r.uploaded_at")} BETWEEN $1::date AND $2::date ${agentW} GROUP BY 1 ORDER BY reviews DESC`);
  const brands = await q(`
    SELECT COALESCE(b.brand_name, '—') AS name, count(*)::int AS reviews, count(*) FILTER (WHERE requires_action)::int AS tasks,
           COALESCE(round(avg(rating)::numeric, 2), 0)::float AS avg, count(*) FILTER (WHERE rating <= 2)::int AS low
      FROM ratings r LEFT JOIN brands b ON b.id = r.brand_id
     WHERE ${DAY("r.uploaded_at")} BETWEEN $1::date AND $2::date ${agentW} GROUP BY 1 ORDER BY reviews DESC`);
  const branches = await q(`
    SELECT COALESCE(b.brand_name, '—') AS brand, COALESCE(NULLIF(btrim(r.branch), ''), '— No branch —') AS name, count(*)::int AS reviews,
           COALESCE(round(avg(rating)::numeric, 2), 0)::float AS avg, count(*) FILTER (WHERE rating <= 2)::int AS low
      FROM ratings r LEFT JOIN brands b ON b.id = r.brand_id
     WHERE ${DAY("r.uploaded_at")} BETWEEN $1::date AND $2::date ${agentW} GROUP BY 1, 2 ORDER BY low DESC, reviews DESC LIMIT 40`);

  // The reviews people had to handle in the period (newest first), with how they ended.
  const CAP = 300;
  const results = await q(`
    SELECT r.id, r.rating, r.review_text, r.order_id, r.customer_name, r.customer_phone, r.branch, r.action_status, r.action_note,
           r.uploaded_at, r.resolved_at, b.brand_name, p.name AS platform_name, ua.full_name AS agent_name, ur.full_name AS closed_by,
           (SELECT count(*)::int FROM rating_call_attempts c WHERE c.rating_id = r.id) AS attempts
      FROM ratings r LEFT JOIN brands b ON b.id = r.brand_id LEFT JOIN platforms p ON p.id = r.platform_id
      LEFT JOIN users ua ON ua.id = r.assigned_agent_id LEFT JOIN users ur ON ur.id = r.recorded_by
     WHERE r.requires_action AND ${DAY("r.uploaded_at")} BETWEEN $1::date AND $2::date ${agentW}
     ORDER BY r.uploaded_at DESC LIMIT ${CAP}`);

  return {
    range: { from, to }, live, liveAgents,
    period: { ...up, ...done, attempts: attempts[0]?.n || 0, answered: attempts[0]?.answered || 0 },
    days, agents, platforms, brands, branches, results, resultsCap: CAP,
  };
}
