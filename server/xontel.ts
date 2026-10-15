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
// XonTel builds every row of a page one by one, so a 500-row page can outlast a timeout while the QA
// system's 20-row pages come back at once. Small pages, a generous per-request wait.
const PAGE_SIZE = Number(process.env.XONTEL_CDR_PAGE_SIZE || 200);
const MAX_PAGES = 200;
const CDR_TIMEOUT_MS = Number(process.env.XONTEL_CDR_TIMEOUT_SECONDS || 120) * 1000;
// If fewer than this share of a batch of reached claims finds ANY call, the records most likely do not
// hold the customer's number where we look — recording "no call" for all of them would accuse everyone.
const MIN_MATCH_SHARE = 0.1;
const MIN_BATCH_FOR_SANITY = 20;
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

const isTimeout = (e: any) => e?.name === "TimeoutError" || e?.name === "AbortError" || /aborted due to timeout/i.test(String(e?.message));

async function xontelGet(path: string, timeoutMs = 45000): Promise<any> {
  if (!process.env.XONTEL_TOKEN) throw new Error("XONTEL_TOKEN is not set");
  if (!xontelBaseUrl()) await discover();
  if (!xontelBaseUrl()) throw new Error("no XonTel address — set XONTEL_DISCOVER_URL or XONTEL_BASE_URL");
  const call = () => fetch(`${xontelBaseUrl()}${path}`, {
    headers: { Authorization: `Token ${process.env.XONTEL_TOKEN}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  let res: Response;
  try { res = await call(); }
  catch (e: any) {
    // A slow answer is not a dead tunnel — waiting again would only double the delay.
    if (isTimeout(e)) throw new Error(`XonTel did not answer within ${Math.round(timeoutMs / 1000)}s`);
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
// "dstchannel" (e.g. PJSIP/Zain_main-000123ab) carries channel ids, not phone numbers.
const SKIP_KEY = /(time|date|dur|bill|url|file|uniqueid|linked|agent|status|queue_name|channel|^id$)/i;

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
  const data = await xontelGet(`/api/v1/cdr/?start_date=${from}&end_date=${to}&from_date=${from}&to_date=${to}&page=${page}&size=${PAGE_SIZE}`, CDR_TIMEOUT_MS);
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
  // A number on a large share of the calls is the company's own caller-ID (outgoing records carry it in
  // src / outbound_cnum) or a trunk, never a customer — drop it so it can't match anything.
  const limit = Math.max(10, calls.length * 0.3);
  for (const [k, list] of m) if (list.length > limit) m.delete(k);
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

// ---- Connection test ("Test XonTel") ------------------------------------------------
// Times a few small requests and shows what an OUTGOING call record looks like (numbers masked), so the
// job can be tuned against the real PBX instead of guessed.

export const probeStatus: { running: boolean; startedAt: string | null; steps: { name: string; ms: number | null; info: string; error?: string }[]; layout: any } =
  { running: false, startedAt: null, steps: [], layout: null };

const maskDigits = (v: any) => String(v).replace(/\d/g, "N");

export async function runProbe(): Promise<void> {
  if (probeStatus.running) return;
  probeStatus.running = true; probeStatus.startedAt = new Date().toISOString(); probeStatus.steps = []; probeStatus.layout = null;
  const today = kwDay(Date.now());
  const step = async (name: string, path: string, info: (d: any) => string, timeoutMs = 100_000): Promise<any> => {
    const t0 = Date.now();
    try { const d = await xontelGet(path, timeoutMs); probeStatus.steps.push({ name, ms: Date.now() - t0, info: info(d) }); return d; }
    catch (e: any) { probeStatus.steps.push({ name, ms: Date.now() - t0, info: "", error: e?.message || String(e) }); return null; }
  };
  try {
    const f = await step("agent list (cdr/filters)", "/api/v1/cdr/filters", (d) => `${(d?.agent || d?.agents || []).length} agents`);
    const agentId = String((f?.agent || f?.agents || [])[0]?.value ?? (f?.agent || f?.agents || [])[0]?.id ?? "");
    const rows = (d: any): any[] => (Array.isArray(d) ? d : d?.results || []);
    const p20 = await step("one day, 20 rows", `/api/v1/cdr/?start_date=${today}&end_date=${today}&size=20&page=1`, (d) => `${rows(d).length} rows`);
    const p200 = await step("one day, 200 rows", `/api/v1/cdr/?start_date=${today}&end_date=${today}&size=200&page=1`, (d) => `${rows(d).length} rows`);
    await step("one day, 500 rows (how the first version asked)", `/api/v1/cdr/?start_date=${today}&end_date=${today}&size=500&page=1`, (d) => `${rows(d).length} rows`);
    if (agentId) await step("one agent, one day, 20 rows", `/api/v1/cdr/?agent=${encodeURIComponent(agentId)}&start_date=${today}&end_date=${today}&size=20&page=1`, (d) => `${rows(d).length} rows`);
    // How does an outgoing call look, and does search find it by the customer's number?
    const all = [...rows(p200), ...rows(p20)];
    const out = all.find((r) => /outgoing/i.test(String(r?.call_type ?? "")));
    if (out) {
      probeStatus.layout = { call_type: String(out.call_type), fields: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v === null ? null : typeof v === "object" ? "{" + Object.keys(v as any).join(",") + "}" : /\d{4,}/.test(String(v)) && !/^\d{4}-\d\d-\d\d/.test(String(v)) && !/url|file/i.test(k) ? maskDigits(v) : String(v).slice(0, 40)])) };
      const keys = [...toCall(out)?.keys || []];
      if (keys[0]) await step("search by the customer's number (outgoing call)", `/api/v1/cdr/?search=${keys[0]}&start_date=${today}&end_date=${today}&size=20&page=1`,
        (d) => `${rows(d).length} rows; found the outgoing call: ${rows(d).some((r) => String(r?.id) === String(out.id))}`);
    } else {
      probeStatus.steps.push({ name: "outgoing call layout", ms: null, info: "no outgoing call in the first rows — try again during working hours" });
    }
  } finally { probeStatus.running = false; }
}

// ---- The checking job -------------------------------------------------------------
//
// Measured on the real PBX (Test XonTel, 2026-10-15): every CDR request costs a large fixed time
// whatever its size — a whole day: 20 rows 28.5s, 500 rows 47.9s — while ONE AGENT's calls come
// back in ~13s. So the job asks XonTel once per linked employee (their own calls only, over the
// days their surveys need, in 500-row pages), two employees at a time, and saves each employee's
// verdicts as soon as their calls are in.

const AGENT_PAGE_SIZE = 500;
const AGENT_MAX_PAGES = 12;
const CONCURRENCY = Math.max(1, Number(process.env.XONTEL_CONCURRENCY || 2));
// Before the first verdicts are saved in a run, this many reached claims must have been judged with at
// least MIN_GLOBAL_MATCH of them finding a call — otherwise our reading of the records is wrong
// somewhere (field layout, filter) and saving would accuse everybody.
const GLOBAL_SANITY_MIN = 30;
const MIN_GLOBAL_MATCH = 0.05;

export const checkStatus: {
  lastRunAt: string | null; lastError: string | null; lastChecked: number; lastWritten: number; lastSeconds: number; running: boolean;
  agentsTotal: number; agentsDone: number; warnings: string[];
} = { lastRunAt: null, lastError: null, lastChecked: 0, lastWritten: 0, lastSeconds: 0, running: false, agentsTotal: 0, agentsDone: 0, warnings: [] };

const kwDay = (ms: number) => new Date(ms + KW_OFFSET_MS).toISOString().slice(0, 10);

/** One employee's own XonTel calls between two Kuwait days (rows of other agents are dropped). */
export async function fetchAgentCalls(agentId: string, fromDay: string, toDay: string): Promise<{ calls: CdrCall[]; complete: boolean; outOfRange: boolean }> {
  const out = new Map<string, CdrCall>();
  let anyRows = false;
  for (let page = 1; page <= AGENT_MAX_PAGES; page++) {
    // start_date/end_date are the parameters XonTel honours (from_date/to_date are ignored, per QA).
    const data = await xontelGet(`/api/v1/cdr/?agent=${encodeURIComponent(agentId)}&start_date=${fromDay}&end_date=${toDay}&size=${AGENT_PAGE_SIZE}&page=${page}`, CDR_TIMEOUT_MS);
    const rows: any[] = Array.isArray(data) ? data : (data?.results || []);
    if (rows.length) anyRows = true;
    // With a date range XonTel leaks rows that belong to no agent (internal legs) — keep only theirs.
    for (const r of rows) { const c = toCall(r); if (c && c.agentId === String(agentId)) out.set(c.id, c); }
    if (rows.length < AGENT_PAGE_SIZE) {
      const calls = [...out.values()];
      const inRange = calls.filter((c) => { const d = kwDay(c.ts); return d >= fromDay && d <= toDay; });
      // Rows came back but none on the asked days: the date filter was not applied — do not judge on them.
      return { calls: inRange, complete: true, outOfRange: anyRows && calls.length > 0 && inRange.length === 0 };
    }
  }
  return { calls: [...out.values()], complete: false, outOfRange: false };
}

/**
 * Looks up the calls for finished surveys and stores the verdicts.
 *  Only surveys whose employee is linked to a XonTel agent are judged.
 *  - auto:   surveys finished in the last 36h that were never checked, or checked without finding
 *            an answered call (the call record may have arrived late) — run on a timer
 *  - manual: a supervisor's "Verify now" for a period; re-checks everything not yet confirmed
 */
export async function runSurveyCallChecks(opts: { mode: "auto" | "manual"; fromISO?: string | null; toISO?: string | null } = { mode: "auto" }): Promise<{ checked: number; written: number; skipped: number; error?: string }> {
  if (!xontelConfigured()) return { checked: 0, written: 0, skipped: 0, error: "XonTel is not configured" };
  if (checkStatus.running) return { checked: 0, written: 0, skipped: 0, error: "a check is already running" };
  checkStatus.running = true;
  checkStatus.agentsTotal = 0; checkStatus.agentsDone = 0;
  const started = Date.now();
  let checked = 0, written = 0, skipped = 0;
  const errors: string[] = [], warnings: string[] = [];
  let fatal: string | null = null;
  try {
    const now = Date.now();
    const surveys: any[] = await DB.getSurveysForCallCheck({
      fromISO: opts.fromISO ?? new Date(now - RECHECK_WINDOW_HOURS * 3600_000).toISOString(),
      toISO: opts.toISO ?? new Date(now).toISOString(),
      force: opts.mode === "manual", recheckWindowHours: RECHECK_WINDOW_HOURS, limit: 2500,
    });
    checked = surveys.length;

    // One group per linked employee, with the days their surveys' windows cover.
    const groups = new Map<string, { agentId: string; name: string; items: { s: any; completedMs: number }[]; from: number; to: number }>();
    for (const sv of surveys) {
      const completedMs = new Date(sv.completed_at).getTime();
      const w = surveyWindow(sv.status, completedMs);
      const key = String(sv.xontel_agent_id);
      let g = groups.get(key);
      if (!g) { g = { agentId: key, name: sv.agent_name || key, items: [], from: w.from, to: w.to }; groups.set(key, g); }
      g.items.push({ s: sv, completedMs });
      g.from = Math.min(g.from, w.from); g.to = Math.max(g.to, w.to);
    }
    const queue = [...groups.values()];
    checkStatus.agentsTotal = queue.length;

    // Verdicts wait here until the run has shown it reads the records correctly (see GLOBAL_SANITY_MIN).
    let held: any[] = [];
    let trusted = false, reachedJudged = 0, reachedMatched = 0, consecutiveFailures = 0, anySuccess = false;
    const flush = async (rows: any[]) => { if (rows.length) { await DB.upsertSurveyCallChecks(rows); written += rows.length; } };

    const handle = async (g: typeof queue[number]) => {
      let res;
      try { res = await fetchAgentCalls(g.agentId, kwDay(g.from), kwDay(Math.min(g.to, now))); }
      catch (e: any) {
        errors.push(`${g.name}: ${e?.message || e}`);
        consecutiveFailures++;
        if (!anySuccess && consecutiveFailures >= 3) fatal = `XonTel could not be read for the first ${consecutiveFailures} employees (${e?.message || e})`;
        return;
      }
      anySuccess = true; consecutiveFailures = 0;
      if (!res.complete) { errors.push(`${g.name}: more than ${AGENT_PAGE_SIZE * AGENT_MAX_PAGES} calls in the period — pick a shorter one`); return; }
      if (res.outOfRange) { errors.push(`${g.name}: XonTel returned calls from other days (date filter not applied) — not judged`); return; }
      const reachedClaims = g.items.filter((t) => isReachedClaim(t.s.status)).length;
      // Not a single call of any kind for this employee on these days, yet many surveys saved as reached:
      // far more likely a wrong XonTel link than a person who never touched the phone. Don't judge — say so.
      if (res.calls.length === 0 && reachedClaims >= 10) {
        warnings.push(`${g.name}: no calls at all in XonTel for ${reachedClaims} reached surveys — check that this employee is linked to the right XonTel user`);
        return;
      }
      const index = indexCalls(res.calls);
      const rows: any[] = [];
      for (const t of g.items) {
        const j = judgeSurvey(index, { phone: t.s.customer_phone, status: t.s.status, completedMs: t.completedMs, agentId: g.agentId });
        // A call that just ended may not be in the records yet — only a missing call that is old enough is a finding.
        if (j.result === "no_call" && now - t.completedMs < PENDING_GRACE_MS) { skipped++; continue; }
        rows.push({ assignment_id: t.s.id, ...j });
        if (isReachedClaim(t.s.status)) { reachedJudged++; if (j.result !== "no_call") reachedMatched++; }
      }
      if (trusted) { await flush(rows); return; }
      held.push(...rows);
      if (reachedJudged >= GLOBAL_SANITY_MIN) {
        if (reachedMatched / reachedJudged < MIN_GLOBAL_MATCH) {
          fatal = `Only ${reachedMatched} of ${reachedJudged} reached surveys found any call from their own agent — the records are probably not read correctly, so nothing was recorded. Run "Test XonTel" and send the result.`;
          held = [];
          return;
        }
        trusted = true;
        const toWrite = held; held = [];
        await flush(toWrite);
      }
    };

    // A small pool: CONCURRENCY employees at a time, stopping early on a fatal problem.
    let next = 0;
    const worker = async () => {
      while (!fatal && next < queue.length) {
        const g = queue[next++];
        await handle(g);
        checkStatus.agentsDone++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    // A small run that never reached the sanity threshold: nothing suggests a systemic problem.
    if (!fatal && held.length) { const toWrite = held; held = []; await flush(toWrite); }
  } catch (e: any) {
    fatal = e?.message || String(e);
  } finally {
    const failure = fatal || (errors.length ? `${errors.length} employee(s) could not be checked — ${errors.slice(0, 2).join("; ")}${errors.length > 2 ? "; …" : ""}` : null);
    checkStatus.lastRunAt = new Date().toISOString();
    checkStatus.lastError = failure;
    checkStatus.warnings = warnings;
    checkStatus.lastChecked = checked; checkStatus.lastWritten = written;
    checkStatus.lastSeconds = Math.round((Date.now() - started) / 1000);
    checkStatus.running = false;
    if (checked) console.log(`[call-check] ${opts.mode}: ${checked} survey(s), ${checkStatus.agentsTotal} employee(s), ${written} verdict(s) saved, ${skipped} too recent, ${checkStatus.lastSeconds}s${failure ? " — " + failure : ""}`);
  }
  const failure = checkStatus.lastError;
  return failure ? { checked, written, skipped, error: failure } : { checked, written, skipped };
}
