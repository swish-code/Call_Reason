// ---------------------------------------------------------------------------
//  Call verification for Ratings & Reviews and the Shakir Campaign.
//
//  The same question the Surveys dashboard asks (server/xontel.ts): the employee logged a call —
//  is there a call from THEIR OWN XonTel user to that customer's number? Here the unit is one
//  logged call (a review's call attempt, a campaign call), not a finished task, so the window is
//  short: the call must sit within the two hours before the entry was saved (or 15 minutes after).
//  Calls come from Swipr's copy of XonTel, exactly as for surveys. Nothing is blocked or closed by
//  this: it is a report for Team Leaders, Supervisors and Admins.
// ---------------------------------------------------------------------------
import { pool } from "./db.js";
import {
  askSwipr, syncLinks, indexCalls, judgeSurvey, surveyWindow, last8, xontelConfigured, kwTime,
  MIN_TALK_SECONDS, PENDING_GRACE_MS, LOOKAHEAD_MS, STALE_COPY_MS,
} from "./xontel.js";

export type AttemptSource = "ratings" | "offers";
export const ATTEMPT_SOURCES: AttemptSource[] = ["ratings", "offers"];

// One logged call: who logged it, when, the customer's number, and whether they claim the customer was reached.
// `reached` for a review = the "answered" outcome; for the campaign = call back / not interested / accepted / ordered.
const BASE: Record<AttemptSource, { at: string; sql: string }> = {
  ratings: {
    at: "c.created_at",
    sql: `SELECT c.id, c.created_at AS at, (c.outcome = 'answered') AS reached, c.outcome, r.customer_phone AS phone,
                 c.agent_id AS user_id, COALESCE(u.full_name, c.agent_name, '(unknown)') AS agent_name, r.order_id AS ref,
                 (l.user_id IS NOT NULL) AS linked,
                 k.result, k.talk_seconds, k.call_time, k.xontel_agent, k.agent_relation, k.checked_at
            FROM rating_call_attempts c
            JOIN ratings r ON r.id = c.rating_id
            LEFT JOIN users u ON u.id = c.agent_id
            LEFT JOIN xontel_agent_links l ON l.user_id = c.agent_id
            LEFT JOIN call_checks k ON k.source = 'ratings' AND k.ref_id = c.id
           WHERE c.outcome <> 'no_phone' AND COALESCE(btrim(r.customer_phone), '') <> ''`,
  },
  offers: {
    at: "c.created_at",
    sql: `SELECT c.id, c.created_at AS at, (c.call_status IN ('call_back','not_interested','accepted','ordered')) AS reached, c.call_status AS outcome, oc.phone AS phone,
                 c.user_id AS user_id, COALESCE(u.full_name, c.user_name, '(unknown)') AS agent_name, oc.customer_name AS ref,
                 (l.user_id IS NOT NULL) AS linked,
                 k.result, k.talk_seconds, k.call_time, k.xontel_agent, k.agent_relation, k.checked_at
            FROM offer_events c
            JOIN offer_customers oc ON oc.id = c.customer_id
            LEFT JOIN users u ON u.id = c.user_id
            LEFT JOIN xontel_agent_links l ON l.user_id = c.user_id
            LEFT JOIN call_checks k ON k.source = 'offers' AND k.ref_id = c.id
           WHERE c.kind = 'call' AND c.user_id IS NOT NULL`,
  },
};

type Status = { lastRunAt: string | null; lastError: string | null; lastChecked: number; lastWritten: number; running: boolean; warnings: string[] };
const blank = (): Status => ({ lastRunAt: null, lastError: null, lastChecked: 0, lastWritten: 0, running: false, warnings: [] });
export const attemptStatus: Record<AttemptSource, Status> = { ratings: blank(), offers: blank() };

const RECHECK_HOURS = 36;
const SMALL_RUN_MIN = 10, MIN_GLOBAL_MATCH = 0.2, OTHER_AGENT_MIN = 5, OTHER_AGENT_SHARE = 0.8, NO_MATCH_AT_ALL_MIN = 10;

/** Entries of a period that still need a verdict (never checked, or a "not confirmed" taken too early). */
async function pending(source: AttemptSource, fromISO: string, toISO: string, force: boolean): Promise<any[]> {
  const b = BASE[source];
  const { rows } = await pool.query(`${b.sql}
     AND l.user_id IS NOT NULL AND ${b.at} >= $1 AND ${b.at} <= $2
     AND ( k.ref_id IS NULL
           OR (k.result <> 'answered' AND k.checked_at < ${b.at} + interval '1 hour'
               AND ($3::boolean OR (${b.at} > now() - interval '${RECHECK_HOURS} hours' AND k.checked_at < now() - interval '19 minutes'))) )
   ORDER BY ${b.at} DESC LIMIT 2500`, [fromISO, toISO, force]);
  return rows;
}

async function save(source: AttemptSource, rows: any[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    await pool.query(
      `INSERT INTO call_checks (source, ref_id, checked_at, result, talk_seconds, calls_found, call_id, call_time, call_direction, xontel_agent, agent_relation)
       SELECT $1, t.ref_id, now(), t.result, t.talk, t.calls, t.call_id, t.call_time, t.direction, t.xontel_agent, t.relation
         FROM UNNEST($2::text[], $3::text[], $4::int[], $5::int[], $6::text[], $7::timestamptz[], $8::text[], $9::text[], $10::text[])
              AS t(ref_id, result, talk, calls, call_id, call_time, direction, xontel_agent, relation)
       ON CONFLICT (source, ref_id) DO UPDATE SET checked_at = now(), result = EXCLUDED.result, talk_seconds = EXCLUDED.talk_seconds,
         calls_found = EXCLUDED.calls_found, call_id = EXCLUDED.call_id, call_time = EXCLUDED.call_time,
         call_direction = EXCLUDED.call_direction, xontel_agent = EXCLUDED.xontel_agent, agent_relation = EXCLUDED.agent_relation`,
      [source, part.map((r) => r.id), part.map((r) => r.result), part.map((r) => r.talk), part.map((r) => r.calls), part.map((r) => r.call_id),
        part.map((r) => (r.call_time ? new Date(r.call_time).toISOString() : null)), part.map((r) => r.direction), part.map((r) => r.xontel_agent), part.map((r) => r.relation)]);
  }
}

/** Looks the calls up for logged calls of one list and stores the verdicts. auto = the last 36 hours, on the timer. */
export async function runAttemptCallChecks(source: AttemptSource, opts: { mode: "auto" | "manual"; fromISO?: string | null; toISO?: string | null } = { mode: "auto" }): Promise<{ checked: number; written: number; error?: string }> {
  const st = attemptStatus[source];
  if (!xontelConfigured()) return { checked: 0, written: 0, error: "XonTel is not configured" };
  if (st.running) return { checked: 0, written: 0, error: "a check is already running" };
  st.running = true;
  let checked = 0, written = 0;
  const warnings: string[] = [];
  let fatal: string | null = null;
  try {
    const now = Date.now();
    const items = await pending(source, opts.fromISO ?? new Date(now - RECHECK_HOURS * 3600_000).toISOString(), opts.toISO ?? new Date(now).toISOString(), opts.mode === "manual");
    checked = items.length;
    if (!items.length) return { checked, written };

    let from = Infinity, to = -Infinity;
    const phones = new Set<string>();
    for (const it of items) {
      const w = surveyWindow("successful", new Date(it.at).getTime());
      from = Math.min(from, w.from); to = Math.max(to, w.to);
      const k = last8(it.phone); if (k) phones.add(k);
    }
    const ans = await askSwipr(from, Math.min(to, now + LOOKAHEAD_MS), [...phones]);
    if (ans.truncated) throw new Error("too many calls in that period to read at once — pick a shorter period");
    const index = indexCalls(ans.calls);
    const copyTo = ans.syncedAt ?? 0;
    if (!ans.syncedAt) warnings.push("Swipr has not reported reading XonTel's calls yet — missing calls are not recorded as \"no call\" until it does");
    else if (now - ans.syncedAt > STALE_COPY_MS) warnings.push(`Swipr last read XonTel's calls at ${kwTime(ans.syncedAt)} (Kuwait time)${ans.lastError ? ` — ${ans.lastError}` : ""}. Entries saved after that wait; nothing is recorded as "no call" for them`);

    const links = await syncLinks(ans.agents);
    const groups = new Map<string, { agentId: string; name: string; items: any[] }>();
    for (const it of items) {
      const agentId = links.valid.get(String(it.user_id));
      if (!agentId) continue;                       // XonTel user not seen lately: not judged (the Surveys dashboard lists them)
      let g = groups.get(agentId);
      if (!g) { g = { agentId, name: it.agent_name || agentId, items: [] }; groups.set(agentId, g); }
      g.items.push(it);
    }

    const all: any[] = [];
    for (const g of groups.values()) {
      const rows: any[] = [];
      for (const it of g.items) {
        const atMs = new Date(it.at).getTime();
        if (!last8(it.phone)) continue;             // no usable number: nothing to look for, never a "no call"
        // "successful" = the short window (two hours before the entry), whatever the outcome that was logged.
        const j = judgeSurvey(index, { phone: it.phone, status: "successful", completedMs: atMs, agentId: g.agentId });
        if (j.result === "no_call" && (now - atMs < PENDING_GRACE_MS || copyTo < atMs + LOOKAHEAD_MS)) continue;
        rows.push({ id: it.id, ...j, reached: !!it.reached });
      }
      const noCall = rows.filter((r) => r.reached && r.result === "no_call");
      const matched = rows.filter((r) => r.result !== "no_call").length;
      const byOther = new Map<string, number>();
      for (const r of noCall) if (r.relation === "other" && r.xontel_agent) byOther.set(r.xontel_agent, (byOther.get(r.xontel_agent) || 0) + 1);
      const top = [...byOther.entries()].sort((a, b) => b[1] - a[1])[0];
      if (noCall.length >= OTHER_AGENT_MIN && top && top[1] >= noCall.length * OTHER_AGENT_SHARE && matched < noCall.length) {
        warnings.push(`${g.name}: ${top[1]} of ${noCall.length} reached entries with no call of theirs were called by XonTel user "${top[0]}" — check that ${g.name} is linked to the right XonTel user; not judged`);
        continue;
      }
      if (matched === 0 && rows.length >= NO_MATCH_AT_ALL_MIN) {
        warnings.push(`${g.name}: none of ${rows.length} logged calls has a call from their XonTel user — check that this employee is linked to the right XonTel user; not judged`);
        continue;
      }
      all.push(...rows);
    }
    // The whole run must not look systemic before anything is saved.
    const matchedAll = all.filter((r) => r.result !== "no_call").length;
    if (all.length >= SMALL_RUN_MIN && matchedAll / all.length < MIN_GLOBAL_MATCH) {
      fatal = `Only ${matchedAll} of ${all.length} logged calls found any call from their own agent — the records are probably not read correctly, so nothing was recorded.`;
    } else { await save(source, all); written = all.length; }
  } catch (e: any) {
    fatal = e?.message || String(e);
  } finally {
    st.lastRunAt = new Date().toISOString(); st.lastError = fatal; st.warnings = warnings; st.lastChecked = checked; st.lastWritten = written; st.running = false;
    if (checked) console.log(`[call-check] ${source} ${opts.mode}: ${checked} logged call(s), ${written} verdict(s) saved${fatal ? " — " + fatal : ""}`);
  }
  return fatal ? { checked, written, error: fatal } : { checked, written };
}

/** The report for a period: totals, one line per employee, and the entries worth a look. */
export async function getAttemptVerification(source: AttemptSource, fromISO: string, toISO: string, campaignId?: string | null) {
  const b = BASE[source];
  const params: any[] = [fromISO, toISO];
  let extra = "";
  if (source === "offers" && campaignId) { params.push(campaignId); extra = ` AND c.campaign_id = $3`; }
  const { rows } = await pool.query(`${b.sql} AND ${b.at} >= $1 AND ${b.at} <= $2${extra} ORDER BY ${b.at} DESC LIMIT 20000`, params);
  const zero = () => ({ reached: 0, confirmed: 0, short: 0, unanswered: 0, noCall: 0, pending: 0, unlinked: 0, notReached: 0, notReachedNoCall: 0 });
  const sum = zero();
  const byAgent = new Map<string, any>();
  const flagged: any[] = [];
  for (const r of rows) {
    let g = byAgent.get(r.agent_name);
    if (!g) { g = { agent: r.agent_name, linked: !!r.linked, ...zero() }; byAgent.set(r.agent_name, g); }
    const talk = Number(r.talk_seconds) || 0;
    const flag = (kind: string) => { if (flagged.length < 300) flagged.push({ id: r.id, at: r.at, agent: r.agent_name, phone: r.phone, ref: r.ref, outcome: r.outcome, kind, talk, call_time: r.call_time, by: r.agent_relation === "other" ? r.xontel_agent : null }); };
    const add = (k: keyof ReturnType<typeof zero>) => { sum[k]++; g[k]++; };
    if (!r.reached) {
      add("notReached");
      // "No answer" was logged, yet the employee's XonTel user never dialled that number.
      if (r.linked && r.result === "no_call") { add("notReachedNoCall"); flag("not_dialled"); }
      continue;
    }
    add("reached");
    if (!r.linked) add("unlinked");
    else if (!r.result) add("pending");
    else if (r.result === "no_call") { add("noCall"); flag("no_call"); }
    else if (r.result === "unanswered") { add("unanswered"); flag("unanswered"); }
    else if (talk < MIN_TALK_SECONDS) { add("short"); flag("short"); }
    else add("confirmed");
  }
  const agents = [...byAgent.values()].map((g) => {
    const judged = g.reached - g.pending - g.unlinked;
    return { ...g, suspectPct: judged ? Math.round(((g.noCall + g.unanswered + g.short) / judged) * 100) : null };
  }).sort((a, b) => (b.suspectPct ?? -1) - (a.suspectPct ?? -1) || b.reached - a.reached);
  return { configured: xontelConfigured(), minTalkSeconds: MIN_TALK_SECONDS, status: { ...attemptStatus[source] }, summary: sum, agents, flagged, total: rows.length };
}
