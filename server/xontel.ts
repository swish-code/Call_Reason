// ---------------------------------------------------------------------------
//  Call verification — was the customer really called?
//
//  An agent can save a survey as "reached" without having dialled anyone. XonTel (the PBX)
//  records every call, so for each finished survey we look for a call to that customer's
//  number around the time the survey was saved.
//
//  Where the calls come from: SWIPR. Swipr already copies every XonTel call into its own
//  database (it holds the one XonTel session the account allows), so this system never talks to
//  XonTel itself — no token, no tunnel, no second session. It asks Swipr's read-only lookup:
//   - SWIPR_CALLS_URL   Swipr's address (https://…); "/api/integrations/calls" is added.
//   - SWIPR_CALLS_KEY   the shared key (Swipr's CALLS_API_KEY).
//  Until 2026-10-19 this module read XonTel directly; that server was replaced and the new one
//  renumbered its users, which is why the links are re-matched by name (syncLinks).
//
//  A call counts only if it was made by THE EMPLOYEE'S OWN XonTel user (a supervisor links each
//  employee to their XonTel user) to the customer's number (last 8 digits) around the time the
//  survey was saved. A call to the same customer by a different user is not this employee's call:
//  it is reported as "no call from this agent", with the other user's name beside it. Employees
//  with no link are not judged.
// ---------------------------------------------------------------------------
import { DB } from "./db.js";

const CALLS_URL = (process.env.SWIPR_CALLS_URL || "").replace(/\/+$/, "").replace(/\/api\/integrations\/calls$/, "");
const CALLS_KEY = process.env.SWIPR_CALLS_KEY || "";

export const MIN_TALK_SECONDS = Number(process.env.SURVEY_MIN_TALK_SECONDS || 30);
const REACHED_LOOKBACK_MS = 2 * 3600_000;          // a completed survey follows its call by minutes
const NOT_REACHED_LOOKBACK_MS = 24 * 3600_000;     // unanswered attempts can be spread over the day
export const LOOKAHEAD_MS = 15 * 60_000;                  // a call may be logged just after the save
export const PENDING_GRACE_MS = 30 * 60_000;              // before this, "no call" may just be a late record
const RECHECK_WINDOW_HOURS = 36;
const KW_OFFSET_MS = 3 * 3600_000;
// Swipr reads XonTel every 5 minutes. A copy older than this is reported as a warning.
export const STALE_COPY_MS = 45 * 60_000;

export const xontelConfigured = () => !!(CALLS_URL && CALLS_KEY);

// ---- Swipr ------------------------------------------------------------------

export type CdrCall = {
  id: string; ts: number; talk: number; answered: boolean; direction: string;
  agentId: string | null; agentName: string | null; keys: string[];
};
export type XontelAgent = { id: string; name: string };
type SwiprAnswer = { calls: CdrCall[]; truncated: boolean; agents: XontelAgent[]; syncedAt: number | null; newestCallTs: number | null; lastError: string | null };

export const last8 = (v: any): string | null => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d.slice(-8) : null;
};

export function toCall(r: any): CdrCall | null {
  const ts = Number(r?.ts);
  if (!Number.isFinite(ts) || r?.id === undefined || r?.id === null) return null;
  const talk = Number.isFinite(Number(r.talk)) ? Math.max(0, Math.round(Number(r.talk))) : 0;
  return {
    id: String(r.id), ts, talk,
    answered: /^answered$/i.test(String(r.status ?? "")) || talk > 0,
    direction: String(r.direction ?? ""),
    agentId: r.agent_id === null || r.agent_id === undefined || r.agent_id === "" ? null : String(r.agent_id),
    agentName: r.agent_name ? String(r.agent_name) : null,
    keys: (Array.isArray(r.keys) ? r.keys : []).map((k: any) => String(k)).filter((k: string) => /^\d{8}$/.test(k)),
  };
}

/** The calls to / from these customer numbers in a time window, plus Swipr's XonTel users and how fresh its copy is. */
export async function askSwipr(fromTs: number, toTs: number, phones: string[], timeoutMs = 60_000): Promise<SwiprAnswer> {
  if (!xontelConfigured()) throw new Error("Swipr is not connected — set SWIPR_CALLS_URL and SWIPR_CALLS_KEY");
  let res: Response;
  try {
    res = await fetch(`${CALLS_URL}/api/integrations/calls`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Calls-Key": CALLS_KEY },
      body: JSON.stringify({ from_ts: Math.round(fromTs), to_ts: Math.round(toTs), phones }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new Error(`Swipr did not answer within ${Math.round(timeoutMs / 1000)}s`);
    throw new Error(`cannot reach Swipr (${e?.cause?.code || e?.message || e})`);
  }
  if (res.status === 401) throw new Error("Swipr rejected the key — SWIPR_CALLS_KEY here must equal CALLS_API_KEY on Swipr");
  if (res.status === 503) throw new Error("Swipr's calls lookup is switched off — set CALLS_API_KEY on the Swipr service");
  if (res.status === 404) throw new Error("Swipr has no calls lookup at that address — check SWIPR_CALLS_URL, or Swipr has not been updated yet");
  if (!res.ok) throw new Error(`Swipr answered ${res.status}`);
  const d: any = await res.json();
  return {
    calls: (Array.isArray(d?.calls) ? d.calls : []).map(toCall).filter(Boolean) as CdrCall[],
    truncated: !!d?.truncated,
    agents: (Array.isArray(d?.agents) ? d.agents : []).map((a: any) => ({ id: String(a?.id ?? ""), name: String(a?.name ?? "") })).filter((a: XontelAgent) => a.id && a.name),
    syncedAt: Number.isFinite(Number(d?.synced_at)) && d?.synced_at ? Number(d.synced_at) : null,
    newestCallTs: Number.isFinite(Number(d?.newest_call_ts)) && d?.newest_call_ts ? Number(d.newest_call_ts) : null,
    lastError: d?.last_error ? String(d.last_error).slice(0, 200) : null,
  };
}

export function indexCalls(calls: CdrCall[]): Map<string, CdrCall[]> {
  const m = new Map<string, CdrCall[]>();
  for (const c of calls) for (const k of new Set(c.keys)) { if (!m.has(k)) m.set(k, []); m.get(k)!.push(c); }
  return m;
}

// ---- Judging one survey ---------------------------------------------------------

const tokens = (s: any) => String(s || "").toLowerCase().replace(/[^a-z؀-ۿ]+/g, " ").trim().split(/\s+/).filter(Boolean);

/** Does the XonTel agent name look like this employee? ("A-Alaa" ~ "Ahmed Alaa"). Soft signal only. */
export function agentRelation(xontelName: string | null, fullName: string | null): "same" | "partial" | "different" | "unknown" {
  const x = tokens(xontelName), n = tokens(fullName);
  if (!x.length || !n.length) return "unknown";
  let matched = 0;
  for (const t of x) {
    if (n.some((w) => w === t || (t.length === 1 && w.startsWith(t)) || (w.length >= 4 && t.length >= 4 && (w.startsWith(t) || t.startsWith(w))))) matched++;
  }
  return matched === x.length ? "same" : matched > 0 ? "partial" : "different";
}

export const isReachedClaim = (status: string) => status === "successful" || status === "refused" || status === "not_interested";

export type CallJudgement = {
  result: "answered" | "unanswered" | "no_call";
  talk: number; calls: number;
  call_id: string | null; call_time: number | null; direction: string | null;
  xontel_agent: string | null;
  relation: "same" | "other" | null;   // same = the employee's own call; other = only a DIFFERENT agent called this customer
};

export function surveyWindow(status: string, completedMs: number): { from: number; to: number } {
  return { from: completedMs - (isReachedClaim(status) ? REACHED_LOOKBACK_MS : NOT_REACHED_LOOKBACK_MS), to: completedMs + LOOKAHEAD_MS };
}

/** The verdict for one survey: only calls by the employee's own XonTel agent (agentId) count. */
export function judgeSurvey(index: Map<string, CdrCall[]>, s: { phone: string; status: string; completedMs: number; agentId: string }): CallJudgement {
  const key = last8(s.phone);
  const w = surveyWindow(s.status, s.completedMs);
  const found = key ? (index.get(key) || []).filter((c) => c.ts >= w.from && c.ts <= w.to && !/internal/i.test(c.direction)) : [];
  const mine = found.filter((c) => c.agentId === String(s.agentId));
  const others = found.filter((c) => c.agentId !== String(s.agentId));
  const answered = mine.filter((c) => c.answered);
  const bestMine = (answered.length ? answered : mine).slice().sort((a, b) => b.talk - a.talk)[0];
  if (bestMine) {
    return { result: answered.length ? "answered" : "unanswered", talk: answered.length ? bestMine.talk : 0, calls: mine.length,
      call_id: bestMine.id, call_time: bestMine.ts, direction: bestMine.direction || null, xontel_agent: bestMine.agentName, relation: "same" };
  }
  // Nobody from this employee — but someone else may have spoken to the customer (worth showing).
  const other = others.filter((c) => c.answered).sort((a, b) => b.talk - a.talk)[0] || others[0];
  return { result: "no_call", talk: 0, calls: 0, call_id: other?.id ?? null, call_time: other?.ts ?? null, direction: other?.direction || null,
    xontel_agent: other?.agentName ?? null, relation: other ? "other" : null };
}

// ---- Linking employees to their XonTel agents --------------------------------------

/** The XonTel users Swipr has seen on a call in the last three weeks (id + name). */
export async function fetchXontelAgents(): Promise<XontelAgent[]> {
  const now = Date.now();
  return (await askSwipr(now - 3600_000, now, [], 30_000)).agents.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Suggestions only — never applied on their own. For each employee the MOST SPECIFIC XonTel name
 * whose every part appears in theirs ("A-Alaa" beats "Ahmed" for "Ahmed Alaa"), and only if that is a
 * single clear winner AND that XonTel name fits no other employee — so a bare "Ahmed" is never offered
 * to anyone.
 */
export function suggestLinks(users: { id: string; name: string }[], agents: XontelAgent[], takenAgentIds: Set<string>): Map<string, XontelAgent> {
  const free = agents.filter((a) => !takenAgentIds.has(a.id));
  const fits = (a: XontelAgent, u: { name: string }) => agentRelation(a.name, u.name) === "same";
  const out = new Map<string, XontelAgent>();
  for (const u of users) {
    const cands = free.filter((a) => fits(a, u));
    if (!cands.length) continue;
    const score = (a: XontelAgent) => tokens(a.name).length;
    const top = Math.max(...cands.map(score));
    const best = cands.filter((a) => score(a) === top);
    if (best.length !== 1) continue;
    if (users.filter((o) => fits(best[0], o)).length !== 1) continue;      // fits another employee too -> ambiguous
    out.set(u.id, best[0]);
  }
  return out;
}

const sameName = (a: any, b: any) => { const n = (s: any) => String(s ?? "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ""); return !!n(a) && n(a) === n(b); };

type Link = { user_id: string; xontel_agent_id: string; xontel_agent_name: string | null };
export type LinkPlan = {
  valid: Map<string, string>;                                            // user -> XonTel id that can be trusted
  moves: { user_id: string; agent_id: string; agent_name: string }[];    // same XonTel name, new id
  stale: Link[];                                                         // XonTel user of that name not found any more
};

/**
 * The XonTel server was replaced on 2026-10-19 and numbered its users afresh, so an id saved before
 * that may now belong to somebody else. A link is trusted only while its id still carries the SAME
 * XonTel name; otherwise the link follows its name to the new id, and if that name is not on XonTel
 * any more (or is not unique) the link is stale — never judged, and a supervisor links it again.
 */
export function planLinks(links: Link[], agents: XontelAgent[]): LinkPlan {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const plan: LinkPlan = { valid: new Map(), moves: [], stale: [] };
  const rest: Link[] = [];
  for (const l of links) {
    const a = byId.get(String(l.xontel_agent_id));
    if (a && sameName(a.name, l.xontel_agent_name)) plan.valid.set(l.user_id, a.id); else rest.push(l);
  }
  const takenIds = new Set(plan.valid.values());
  const wanted = new Map<string, Link[]>();
  for (const l of rest) {
    const named = agents.filter((a) => sameName(a.name, l.xontel_agent_name));
    if (named.length === 1 && !takenIds.has(named[0].id)) { if (!wanted.has(named[0].id)) wanted.set(named[0].id, []); wanted.get(named[0].id)!.push(l); }
    else plan.stale.push(l);
  }
  for (const [id, ls] of wanted) {
    if (ls.length === 1) plan.moves.push({ user_id: ls[0].user_id, agent_id: id, agent_name: byId.get(id)!.name });
    else plan.stale.push(...ls);
  }
  return plan;
}

/** Applies the plan (moves follow their name; stale ids are parked as "old:<id>") and returns the trusted links. */
export async function syncLinks(agents: XontelAgent[]): Promise<{ valid: Map<string, string>; moved: number; stale: Link[] }> {
  const links = await DB.getXontelLinks();
  // An empty list means Swipr has no recent calls at all — nothing can be concluded about any link.
  if (!agents.length) return { valid: new Map(), moved: 0, stale: [] };
  const plan = planLinks(links, agents);
  const park = plan.stale.filter((l) => !String(l.xontel_agent_id).startsWith("old:"));
  if (plan.moves.length || park.length) {
    await DB.moveXontelLinks(plan.moves, park.map((l) => ({ user_id: l.user_id, agent_id: `old:${l.xontel_agent_id}` })));
    if (plan.moves.length) console.log(`[call-check] ${plan.moves.length} XonTel link(s) moved to the new server's ids: ${plan.moves.map((m) => m.agent_name).join(", ")}`);
  }
  for (const m of plan.moves) plan.valid.set(m.user_id, m.agent_id);
  return { valid: plan.valid, moved: plan.moves.length, stale: plan.stale };
}

export const kwTime = (ms: number) => new Date(ms + KW_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");

// ---- Connection test ("Test XonTel") ------------------------------------------------
// Asks Swipr the questions the job depends on and reports them. Changes nothing.

export const probeStatus: { running: boolean; startedAt: string | null; steps: { name: string; ms: number | null; info: string; error?: string }[]; layout: any } =
  { running: false, startedAt: null, steps: [], layout: null };

export async function runProbe(): Promise<void> {
  if (probeStatus.running) return;
  probeStatus.running = true; probeStatus.startedAt = new Date().toISOString(); probeStatus.steps = []; probeStatus.layout = null;
  const now = Date.now();
  try {
    const surveys: any[] = await DB.getSurveysForCallCheck({
      fromISO: new Date(now - 24 * 3600_000).toISOString(), toISO: new Date(now).toISOString(), force: true, recheckWindowHours: RECHECK_WINDOW_HOURS, limit: 2500,
    });
    const phones = [...new Set(surveys.map((s) => last8(s.customer_phone)).filter(Boolean) as string[])];
    const t0 = Date.now();
    let ans: SwiprAnswer;
    try { ans = await askSwipr(now - 48 * 3600_000, now, phones); }
    catch (e: any) { probeStatus.steps.push({ name: "Swipr calls lookup", ms: Date.now() - t0, info: "", error: e?.message || String(e) }); return; }
    probeStatus.steps.push({ name: "Swipr calls lookup", ms: Date.now() - t0,
      info: `${ans.agents.length} XonTel users · newest call ${ans.newestCallTs ? kwTime(ans.newestCallTs) : "none"} · calls last read from XonTel ${ans.syncedAt ? kwTime(ans.syncedAt) : "not yet (wait 5 minutes after Swipr restarts)"} (Kuwait time)`
        + (ans.lastError ? ` · Swipr's last XonTel error: ${ans.lastError}` : "") });
    const out = ans.calls.filter((c) => /outgoing/i.test(c.direction));
    probeStatus.steps.push({ name: "calls to the customers of the last 24 hours' surveys", ms: null,
      info: `${surveys.length} finished survey(s), ${phones.length} number(s) → ${ans.calls.length} call(s) found, ${out.length} outgoing, ${out.filter((c) => c.answered).length} of them answered${ans.truncated ? " (list cut — too many)" : ""}` });
    const plan = planLinks(await DB.getXontelLinks(), ans.agents);
    probeStatus.steps.push({ name: "employee links", ms: null,
      info: `${plan.valid.size} match XonTel as they are · ${plan.moves.length} follow their XonTel name to a new id${plan.moves.length ? ` (${plan.moves.map((m) => m.agent_name).join(", ")})` : ""}`
        + ` · ${plan.stale.length} not found on XonTel${plan.stale.length ? ` (${plan.stale.map((l) => l.xontel_agent_name || l.xontel_agent_id).join(", ")})` : ""}` });
  } catch (e: any) {
    probeStatus.steps.push({ name: "Test", ms: null, info: "", error: e?.message || String(e) });
  } finally { probeStatus.running = false; }
}

// ---- The checking job -------------------------------------------------------------

// After a run that could not read the calls at all, the timer waits a while before trying again.
const AUTO_PAUSE_MS = 15 * 60_000;
// Before any verdict of a run is saved: of at least SMALL_RUN_MIN reached claims judged, MIN_GLOBAL_MATCH
// must have found the employee's call — otherwise our reading of the records is wrong somewhere and
// saving would accuse everybody.
const SMALL_RUN_MIN = 10;
const MIN_GLOBAL_MATCH = 0.2;
// Wrong-link signals: most of an employee's "no call" reached claims were called by ONE other XonTel
// user, or none of many reached claims has any call of theirs.
const OTHER_AGENT_MIN = 5;
const OTHER_AGENT_SHARE = 0.8;
const NO_MATCH_AT_ALL_MIN = 10;

export const checkStatus: {
  lastRunAt: string | null; lastError: string | null; lastChecked: number; lastWritten: number; lastSeconds: number; running: boolean;
  agentsTotal: number; agentsDone: number; surveysTotal: number; surveysDone: number; warnings: string[]; pausedUntil: string | null;
} = { lastRunAt: null, lastError: null, lastChecked: 0, lastWritten: 0, lastSeconds: 0, running: false, agentsTotal: 0, agentsDone: 0, surveysTotal: 0, surveysDone: 0, warnings: [], pausedUntil: null };

/**
 * Looks up the calls for finished surveys and stores the verdicts.
 *  Only surveys whose employee is linked to a XonTel agent are judged.
 *  - auto:   surveys finished in the last 36h that were never checked, or whose "not confirmed" verdict
 *            was taken before the call record could have arrived — run on a timer
 *  - manual: a supervisor's "Verify now" for a period
 */
export async function runSurveyCallChecks(opts: { mode: "auto" | "manual"; fromISO?: string | null; toISO?: string | null } = { mode: "auto" }): Promise<{ checked: number; written: number; skipped: number; error?: string }> {
  if (!xontelConfigured()) return { checked: 0, written: 0, skipped: 0, error: "XonTel is not configured" };
  if (checkStatus.running) return { checked: 0, written: 0, skipped: 0, error: "a check is already running" };
  if (opts.mode === "auto" && checkStatus.pausedUntil && Date.now() < new Date(checkStatus.pausedUntil).getTime()) {
    return { checked: 0, written: 0, skipped: 0, error: "paused" };
  }
  checkStatus.running = true;
  checkStatus.pausedUntil = null;
  checkStatus.agentsTotal = 0; checkStatus.agentsDone = 0; checkStatus.surveysTotal = 0; checkStatus.surveysDone = 0;
  const started = Date.now();
  let checked = 0, written = 0, skipped = 0;
  const warnings: string[] = [];
  let fatal: string | null = null;
  try {
    const now = Date.now();
    const surveys: any[] = await DB.getSurveysForCallCheck({
      fromISO: opts.fromISO ?? new Date(now - RECHECK_WINDOW_HOURS * 3600_000).toISOString(),
      toISO: opts.toISO ?? new Date(now).toISOString(),
      force: opts.mode === "manual", recheckWindowHours: RECHECK_WINDOW_HOURS, limit: 2500,
    });
    checked = surveys.length;
    checkStatus.surveysTotal = checked;
    if (!surveys.length) return { checked, written, skipped };

    // One question to Swipr: every call to / from these customers over the whole period.
    let from = Infinity, to = -Infinity;
    const phones = new Set<string>();
    for (const sv of surveys) {
      const w = surveyWindow(sv.status, new Date(sv.completed_at).getTime());
      from = Math.min(from, w.from); to = Math.max(to, w.to);
      const k = last8(sv.customer_phone); if (k) phones.add(k);
    }
    const ans = await askSwipr(from, Math.min(to, now + LOOKAHEAD_MS), [...phones]);
    if (ans.truncated) throw new Error("too many calls in that period to read at once — pick a shorter period");
    const index = indexCalls(ans.calls);

    // How far Swipr's copy of the calls reaches. A "no call" is only a finding for a survey the copy has passed.
    const copyTo = ans.syncedAt ?? 0;
    if (!ans.syncedAt) warnings.push("Swipr has not reported reading XonTel's calls yet — missing calls are not recorded as \"no call\" until it does");
    else if (now - ans.syncedAt > STALE_COPY_MS) warnings.push(`Swipr last read XonTel's calls at ${kwTime(ans.syncedAt)} (Kuwait time)${ans.lastError ? ` — ${ans.lastError}` : ""}. Surveys saved after that wait; nothing is recorded as "no call" for them`);

    const links = await syncLinks(ans.agents);
    if (links.stale.length) warnings.push(`${links.stale.length} linked XonTel user(s) had no call in Swipr's copy in the last 3 weeks, so their employees are not judged: ${links.stale.map((l) => l.xontel_agent_name || l.xontel_agent_id).join(", ")}. They are picked up again by themselves once that user makes a call — link the employee again only if their XonTel user name changed`);

    // One group per linked employee.
    const groups = new Map<string, { agentId: string; name: string; items: { s: any; completedMs: number }[] }>();
    for (const sv of surveys) {
      const agentId = links.valid.get(String(sv.agent_id));
      if (!agentId) { skipped++; checkStatus.surveysDone++; continue; }
      let g = groups.get(agentId);
      if (!g) { g = { agentId, name: sv.agent_name || agentId, items: [] }; groups.set(agentId, g); }
      g.items.push({ s: sv, completedMs: new Date(sv.completed_at).getTime() });
    }
    checkStatus.agentsTotal = groups.size;

    const all: any[] = [];
    for (const g of groups.values()) {
      const rows: any[] = [];
      for (const t of g.items) {
        checkStatus.surveysDone++;
        // Without a usable number there is nothing to look for — never a "no call".
        if (!last8(t.s.customer_phone)) { skipped++; continue; }
        const j = judgeSurvey(index, { phone: t.s.customer_phone, status: t.s.status, completedMs: t.completedMs, agentId: g.agentId });
        // A call that just ended may not be in Swipr's copy yet — only a missing call that is old enough, in a
        // copy that reaches past the survey, is a finding.
        if (j.result === "no_call" && (now - t.completedMs < PENDING_GRACE_MS || copyTo < t.completedMs + LOOKAHEAD_MS)) { skipped++; continue; }
        rows.push({ assignment_id: t.s.id, ...j, reached: isReachedClaim(t.s.status) });
      }
      checkStatus.agentsDone++;
      const noCall = rows.filter((r) => r.reached && r.result === "no_call");
      const matched = rows.filter((r) => r.reached && r.result !== "no_call").length;
      // Most "no call" reached claims were dialled by ONE other XonTel user: the link is the likelier mistake.
      const byOther = new Map<string, number>();
      for (const r of noCall) if (r.relation === "other" && r.xontel_agent) byOther.set(r.xontel_agent, (byOther.get(r.xontel_agent) || 0) + 1);
      const top = [...byOther.entries()].sort((a, b) => b[1] - a[1])[0];
      if (noCall.length >= OTHER_AGENT_MIN && top && top[1] >= noCall.length * OTHER_AGENT_SHARE && matched < noCall.length) {
        warnings.push(`${g.name}: ${top[1]} of ${noCall.length} reached surveys with no call of theirs were called by XonTel user "${top[0]}" — check that ${g.name} is linked to the right XonTel user; not judged`);
        continue;
      }
      // Not one call of theirs for many reached surveys: far more likely a wrong link than a person who never
      // touched the phone. Don't judge — say so.
      if (matched === 0 && noCall.length >= NO_MATCH_AT_ALL_MIN && !rows.some((r) => r.result !== "no_call")) {
        warnings.push(`${g.name}: none of ${noCall.length} reached surveys has a call from their XonTel user — check that this employee is linked to the right XonTel user; not judged`);
        continue;
      }
      all.push(...rows);
    }

    // The whole run must not look systemic before anything is saved.
    const reached = all.filter((r) => r.reached);
    const reachedMatched = reached.filter((r) => r.result !== "no_call").length;
    if (reached.length >= SMALL_RUN_MIN && reachedMatched / reached.length < MIN_GLOBAL_MATCH) {
      fatal = `Only ${reachedMatched} of ${reached.length} reached surveys found any call from their own agent — the records are probably not read correctly, so nothing was recorded. Run "Test XonTel" and send the result.`;
    } else if (all.length) {
      for (let i = 0; i < all.length; i += 200) { const part = all.slice(i, i + 200); await DB.upsertSurveyCallChecks(part); written += part.length; }
    }
  } catch (e: any) {
    fatal = e?.message || String(e);
  } finally {
    checkStatus.lastRunAt = new Date().toISOString();
    checkStatus.lastError = fatal;
    checkStatus.warnings = warnings;
    checkStatus.lastChecked = checked; checkStatus.lastWritten = written;
    checkStatus.lastSeconds = Math.round((Date.now() - started) / 1000);
    if (fatal && written === 0) checkStatus.pausedUntil = new Date(Date.now() + AUTO_PAUSE_MS).toISOString();
    checkStatus.running = false;
    if (checked) console.log(`[call-check] ${opts.mode}: ${checked} survey(s), ${checkStatus.agentsTotal} employee(s), ${written} verdict(s) saved, ${skipped} skipped, ${checkStatus.lastSeconds}s${fatal ? " — " + fatal : ""}`);
  }
  const failure = checkStatus.lastError;
  return failure ? { checked, written, skipped, error: failure } : { checked, written, skipped };
}
