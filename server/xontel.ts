// ---------------------------------------------------------------------------
//  Call verification — was the customer really called?
//
//  An agent can save a survey as "reached" without having dialled anyone. XonTel (the PBX)
//  records every call, so for each finished survey we look for a call to that customer's
//  number around the time the survey was saved.
//
//  Connection (same arrangement as Swipr's XonTel poller):
//   - XONTEL_TOKEN          the SHARED API token. XonTel allows ONE session per account, so this
//                           system never logs in with a password — it would evict the QA system's
//                           session. Copy the same token QA/Swipr use.
//   - XONTEL_DISCOVER_URL   QA's public status endpoint; its `base_url` is followed, because the
//                           PBX is only reachable through a Cloudflare tunnel whose hostname
//                           changes whenever cloudflared restarts.
//   - XONTEL_BASE_URL       fixed address, used when no discovery is configured.
//
//  A call counts only if it was made by THE EMPLOYEE'S OWN XonTel user (a supervisor links each
//  employee to their XonTel agent) to the customer's number (last 8 digits, found in any
//  number-like field of the record) around the time the survey was saved. A call to the same
//  customer by a different agent is not this employee's call: it is reported as "no call from
//  this agent", with the other agent's name beside it. Employees with no link are not judged.
// ---------------------------------------------------------------------------
import { DB } from "./db.js";

const ENV_BASE = (process.env.XONTEL_BASE_URL || "").replace(/\/+$/, "");
const DISCOVER_URL = (process.env.XONTEL_DISCOVER_URL || "").replace(/\/+$/, "");
let discoveredBase: string | null = null;

export const MIN_TALK_SECONDS = Number(process.env.SURVEY_MIN_TALK_SECONDS || 30);
const REACHED_LOOKBACK_MS = 2 * 3600_000;          // a completed survey follows its call by minutes
const NOT_REACHED_LOOKBACK_MS = 24 * 3600_000;     // unanswered attempts can be spread over the day
const LOOKAHEAD_MS = 15 * 60_000;                  // a call may be logged just after the save
const PENDING_GRACE_MS = 30 * 60_000;              // before this, "no call" may just be CDR lag
const RECHECK_WINDOW_HOURS = 36;
const PAGE_SIZE = 500;
const MAX_PAGES = 80;
const KW_OFFSET_MS = 3 * 3600_000;

export const xontelBaseUrl = () => discoveredBase || ENV_BASE;
export const xontelConfigured = () => !!(process.env.XONTEL_TOKEN && (ENV_BASE || DISCOVER_URL));

// ---- HTTP -------------------------------------------------------------------

async function discover(): Promise<string | null> {
  if (!DISCOVER_URL) return null;
  try {
    const res = await fetch(DISCOVER_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const url = String((await res.json())?.base_url || "").replace(/\/+$/, "");
    if (!/^https?:\/\//.test(url)) return null;
    discoveredBase = url;
    return url;
  } catch { return null; }
}

async function xontelGet(path: string): Promise<any> {
  if (!process.env.XONTEL_TOKEN) throw new Error("XONTEL_TOKEN is not set");
  if (!xontelBaseUrl()) await discover();
  if (!xontelBaseUrl()) throw new Error("no XonTel address — set XONTEL_DISCOVER_URL or XONTEL_BASE_URL");
  const call = () => fetch(`${xontelBaseUrl()}${path}`, {
    headers: { Authorization: `Token ${process.env.XONTEL_TOKEN}` },
    signal: AbortSignal.timeout(45000),
  });
  let res: Response;
  try { res = await call(); }
  catch (e: any) {
    // The tunnel may have restarted under a new hostname.
    if (await discover()) res = await call(); else throw new Error(`cannot reach XonTel (${e?.message || e})`);
  }
  if (res.status === 401) {
    throw new Error("XonTel rejected the token — the QA system probably signed in again and XonTel issued it a new one. Copy the current XONTEL_TOKEN from QA/Swipr.");
  }
  if (!res.ok) throw new Error(`XonTel API ${res.status}`);
  return res.json();
}

// ---- Call records -------------------------------------------------------------

export type CdrCall = {
  id: string; ts: number; talk: number; answered: boolean; direction: string;
  agentId: string | null; agentName: string | null; keys: string[];
};

// "2026-09-19 02:49:59pm" (12-hour) or "2026-09-19 14:49:59" — Kuwait time, no zone.
export function parseCdrTime(v: any): number | null {
  const m = String(v ?? "").match(/^(\d{4}-\d\d-\d\d)[ T](\d{1,2}):(\d\d):(\d\d)\s*(am|pm)?/i);
  if (!m) return null;
  let h = Number(m[2]);
  const ap = (m[5] || "").toLowerCase();
  if (ap === "pm" && h !== 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  const t = Date.parse(`${m[1]}T${String(h).padStart(2, "0")}:${m[3]}:${m[4]}+03:00`);
  return Number.isFinite(t) ? t : null;
}

export const last8 = (v: any): string | null => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d.slice(-8) : null;
};

// Which fields can hold the number that was dialled / that called, whichever the PBX uses for
// outgoing vs incoming calls. Times, durations, ids and URLs are skipped (they carry long digit runs).
const NUMBER_KEY = /(num|src|dst|caller|callee|called|dial|phone|dest|from|^to$)/i;
const SKIP_KEY = /(time|date|dur|bill|url|file|uniqueid|linked|agent|status|queue_name|^id$)/i;

export function toCall(r: any): CdrCall | null {
  const ts = parseCdrTime(r?.cdr_time);
  const id = r?.id ?? r?.uniqueid;
  if (ts === null || id === undefined || id === null) return null;
  const keys = new Set<string>();
  for (const [k, v] of Object.entries(r)) {
    if (v === null || typeof v === "object" || SKIP_KEY.test(k) || !NUMBER_KEY.test(k)) continue;
    const key = last8(v);
    if (key) keys.add(key);
  }
  const talk = Number.isFinite(Number(r.billsec)) ? Math.max(0, Math.round(Number(r.billsec))) : 0;
  const status = String(r.call_status?.value ?? r.call_status ?? "");
  return {
    id: String(id), ts, talk,
    answered: /^answered$/i.test(status) || talk > 0,
    direction: String(r.call_type ?? ""),
    agentId: r.agent_id === null || r.agent_id === undefined || r.agent_id === "" ? null : String(r.agent_id),
    agentName: r.agent ? String(r.agent) : null,
    keys: [...keys],
  };
}

async function cdrPage(from: string, to: string, page: number): Promise<any[]> {
  // The API silently ignores the wrong date parameter names and falls back to "today", and the two
  // known systems disagree on which pair is right — so send both.
  const data = await xontelGet(`/api/v1/cdr/?start_date=${from}&end_date=${to}&from_date=${from}&to_date=${to}&page=${page}&size=${PAGE_SIZE}`);
  return Array.isArray(data) ? data : (data?.results || []);
}

/** Every call record between two Kuwait days (YYYY-MM-DD). Pages until a short page comes back. */
export async function fetchCdr(fromDay: string, toDay: string): Promise<{ calls: CdrCall[]; complete: boolean }> {
  const out = new Map<string, CdrCall>();
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const rows = await cdrPage(fromDay, toDay, page);
    for (const r of rows) { const c = toCall(r); if (c) out.set(c.id, c); }
    if (rows.length < PAGE_SIZE) { complete = true; break; }
  }
  return { calls: [...out.values()], complete };
}

export function indexCalls(calls: CdrCall[]): Map<string, CdrCall[]> {
  const m = new Map<string, CdrCall[]>();
  for (const c of calls) for (const k of c.keys) { if (!m.has(k)) m.set(k, []); m.get(k)!.push(c); }
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

export type XontelAgent = { id: string; name: string };

/** XonTel's agent list (id + name), from the CDR filters. */
export async function fetchXontelAgents(): Promise<XontelAgent[]> {
  const f = await xontelGet("/api/v1/cdr/filters");
  const list: any[] = f?.agent || f?.agents || [];
  return list.map((a) => ({ id: String(a?.value ?? a?.id ?? ""), name: String(a?.label ?? a?.name ?? "") })).filter((a) => a.id);
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

// ---- The checking job -------------------------------------------------------------

export const checkStatus: { lastRunAt: string | null; lastError: string | null; lastChecked: number; lastWritten: number; lastSeconds: number; running: boolean } =
  { lastRunAt: null, lastError: null, lastChecked: 0, lastWritten: 0, lastSeconds: 0, running: false };

const kwDay = (ms: number) => new Date(ms + KW_OFFSET_MS).toISOString().slice(0, 10);
const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00+03:00`);
const daysBetween = (fromMs: number, toMs: number): string[] => {
  const out: string[] = [];
  for (let d = kwDay(fromMs); d <= kwDay(toMs); d = kwDay(dayStartMs(d) + 86400_000)) out.push(d);
  return out;
};

/**
 * Looks up the calls for finished surveys and stores the verdicts.
 *  Only surveys whose employee is linked to a XonTel agent are judged.
 *  - auto:   surveys finished in the last 36h that were never checked, or checked without finding
 *            an answered call (the call record may have arrived late) — run on a timer
 *  - manual: a supervisor's "Verify now" for a period; re-checks everything not yet confirmed
 *
 * Call records are read one Kuwait day at a time, newest day first, and each survey is judged and
 * SAVED as soon as the days it needs are loaded — so a failure on an old day never loses the work
 * already done on newer ones.
 */
export async function runSurveyCallChecks(opts: { mode: "auto" | "manual"; fromISO?: string | null; toISO?: string | null } = { mode: "auto" }): Promise<{ checked: number; written: number; skipped: number; error?: string }> {
  if (!xontelConfigured()) return { checked: 0, written: 0, skipped: 0, error: "XonTel is not configured" };
  if (checkStatus.running) return { checked: 0, written: 0, skipped: 0, error: "a check is already running" };
  checkStatus.running = true;
  const started = Date.now();
  let checked = 0, written = 0, skipped = 0, failure: string | null = null;
  try {
    const now = Date.now();
    const surveys: any[] = await DB.getSurveysForCallCheck({
      fromISO: opts.fromISO ?? new Date(now - RECHECK_WINDOW_HOURS * 3600_000).toISOString(),
      toISO: opts.toISO ?? new Date(now).toISOString(),
      force: opts.mode === "manual", recheckWindowHours: RECHECK_WINDOW_HOURS, limit: 2500,
    });
    checked = surveys.length;

    // Which Kuwait days of call records each survey needs (its window can reach into the day before).
    const todo = surveys.map((s) => {
      const completedMs = new Date(s.completed_at).getTime();
      const w = surveyWindow(s.status, completedMs);
      const days = daysBetween(w.from, Math.min(w.to, now));
      return { s, completedMs, days, earliest: days[0] };
    });
    const allDays = [...new Set(todo.flatMap((t) => t.days))].sort().reverse();       // newest first
    const loaded = new Map<string, CdrCall[]>();
    let pending = todo;

    for (const day of allDays) {
      if (!pending.length) break;
      const { calls, complete } = await fetchCdr(day, day);
      if (!complete) throw new Error(`XonTel returned too many call records for ${day} to read in one pass`);
      // Only records that really belong to that day. If the PBX ignored the date filter it hands back
      // other days (today's) — then "no call" would be a false accusation, so nothing is recorded.
      const own = calls.filter((c) => kwDay(c.ts) === day);
      if (!own.length) throw new Error(`XonTel returned no call records for ${day} (date filter ignored, or an empty day) — nothing was recorded for the surveys that need it`);
      loaded.set(day, own);

      // Judge every survey whose days are now all loaded (its earliest day is this one or newer).
      const ready = pending.filter((t) => t.earliest >= day);
      if (!ready.length) continue;
      const index = indexCalls([...loaded.values()].flat());
      const rows: any[] = [];
      for (const t of ready) {
        const j = judgeSurvey(index, { phone: t.s.customer_phone, status: t.s.status, completedMs: t.completedMs, agentId: t.s.xontel_agent_id });
        // A call that just ended may not be in the records yet — only a missing call that is old enough is a finding.
        if (j.result === "no_call" && now - t.completedMs < PENDING_GRACE_MS) { skipped++; continue; }
        rows.push({ assignment_id: t.s.id, ...j });
      }
      await DB.upsertSurveyCallChecks(rows);
      written += rows.length;
      const doneIds = new Set(ready.map((t) => t.s.id));
      pending = pending.filter((t) => !doneIds.has(t.s.id));
    }
  } catch (e: any) {
    failure = e?.message || String(e);
  } finally {
    checkStatus.lastRunAt = new Date().toISOString();
    checkStatus.lastError = failure;
    checkStatus.lastChecked = checked; checkStatus.lastWritten = written;
    checkStatus.lastSeconds = Math.round((Date.now() - started) / 1000);
    checkStatus.running = false;
    if (checked) console.log(`[call-check] ${opts.mode}: ${checked} survey(s), ${written} verdict(s) saved, ${skipped} too recent, ${checkStatus.lastSeconds}s${failure ? " — " + failure : ""}`);
  }
  return failure ? { checked, written, skipped, error: failure } : { checked, written, skipped };
}
