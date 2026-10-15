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
//  Matching is by the customer's number (last 8 digits, found in any number-like field of the
//  call record) and time — NOT by agent, so no agent-account mapping is needed and a wrong link
//  can never accuse anyone. The XonTel agent's name is kept so a supervisor can see WHO called.
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
  agentName: string | null; keys: string[];
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
  call_id: string | null; call_time: number | null; direction: string | null; xontel_agent: string | null; relation: string | null;
};

export function surveyWindow(status: string, completedMs: number): { from: number; to: number } {
  return { from: completedMs - (isReachedClaim(status) ? REACHED_LOOKBACK_MS : NOT_REACHED_LOOKBACK_MS), to: completedMs + LOOKAHEAD_MS };
}

export function judgeSurvey(index: Map<string, CdrCall[]>, s: { phone: string; status: string; completedMs: number; agentName: string | null }): CallJudgement {
  const key = last8(s.phone);
  const w = surveyWindow(s.status, s.completedMs);
  const found = key ? (index.get(key) || []).filter((c) => c.ts >= w.from && c.ts <= w.to && !/internal/i.test(c.direction)) : [];
  const answered = found.filter((c) => c.answered);
  const pool = answered.length ? answered : found;
  const rank = (c: CdrCall) => (agentRelation(c.agentName, s.agentName) === "same" ? 1_000_000 : 0) + c.talk;
  const best = pool.slice().sort((a, b) => rank(b) - rank(a))[0];
  return {
    result: answered.length ? "answered" : found.length ? "unanswered" : "no_call",
    talk: best && answered.length ? best.talk : 0,
    calls: found.length,
    call_id: best?.id ?? null, call_time: best?.ts ?? null, direction: best?.direction || null,
    xontel_agent: best?.agentName ?? null,
    relation: best ? agentRelation(best.agentName, s.agentName) : null,
  };
}

// ---- The checking job -------------------------------------------------------------

export const checkStatus: { lastRunAt: string | null; lastError: string | null; lastChecked: number; lastWritten: number; running: boolean } =
  { lastRunAt: null, lastError: null, lastChecked: 0, lastWritten: 0, running: false };

const kwDay = (ms: number) => new Date(ms + KW_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Looks up the calls for finished surveys and stores the verdicts.
 *  - auto:   surveys finished in the last 36h that were never checked, or checked without finding
 *            an answered call (the call record may have arrived late) — run on a timer
 *  - manual: a supervisor's "Verify now" for a period; re-checks everything not yet confirmed
 */
export async function runSurveyCallChecks(opts: { mode: "auto" | "manual"; fromISO?: string | null; toISO?: string | null } = { mode: "auto" }): Promise<{ checked: number; written: number; skipped: number; error?: string }> {
  if (!xontelConfigured()) return { checked: 0, written: 0, skipped: 0, error: "XonTel is not configured" };
  if (checkStatus.running) return { checked: 0, written: 0, skipped: 0, error: "a check is already running" };
  checkStatus.running = true;
  try {
    const now = Date.now();
    const manual = opts.mode === "manual";
    const surveys = await DB.getSurveysForCallCheck({
      fromISO: opts.fromISO ?? new Date(now - RECHECK_WINDOW_HOURS * 3600_000).toISOString(),
      toISO: opts.toISO ?? new Date(now).toISOString(),
      force: manual, recheckWindowHours: RECHECK_WINDOW_HOURS, limit: 2500,
    });
    if (!surveys.length) { checkStatus.lastError = null; checkStatus.lastRunAt = new Date().toISOString(); checkStatus.lastChecked = 0; checkStatus.lastWritten = 0; return { checked: 0, written: 0, skipped: 0 }; }

    const wins = surveys.map((s: any) => surveyWindow(s.status, new Date(s.completed_at).getTime()));
    const minTs = Math.min(...wins.map((x) => x.from)), maxTs = Math.max(...wins.map((x) => x.to));
    const { calls, complete } = await fetchCdr(kwDay(minTs), kwDay(Math.min(maxTs, now)));
    // Without records covering the period, "no call" would be a false accusation, not a finding.
    if (!complete) throw new Error("XonTel returned too many call records to read in one pass — pick a shorter period");
    if (!calls.some((c) => c.ts >= minTs && c.ts <= maxTs)) throw new Error("XonTel returned no call records for this period (date filter or token problem?) — nothing was recorded");
    const index = indexCalls(calls);

    const rows: any[] = [];
    let skipped = 0;
    for (const s of surveys) {
      const completedMs = new Date(s.completed_at).getTime();
      const j = judgeSurvey(index, { phone: s.customer_phone, status: s.status, completedMs, agentName: s.agent_name });
      // A call that just ended may not be in the records yet — only a missing call that is old enough is a finding.
      if (j.result === "no_call" && now - completedMs < PENDING_GRACE_MS) { skipped++; continue; }
      rows.push({ assignment_id: s.id, ...j });
    }
    await DB.upsertSurveyCallChecks(rows);
    checkStatus.lastError = null; checkStatus.lastRunAt = new Date().toISOString();
    checkStatus.lastChecked = surveys.length; checkStatus.lastWritten = rows.length;
    return { checked: surveys.length, written: rows.length, skipped };
  } catch (e: any) {
    checkStatus.lastError = e?.message || String(e); checkStatus.lastRunAt = new Date().toISOString();
    return { checked: 0, written: 0, skipped: 0, error: checkStatus.lastError || "failed" };
  } finally { checkStatus.running = false; }
}
