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
// XonTel builds every row of a page one by one, so a big page can outlast a timeout while the QA
// system's 20-row pages come back at once. Small pages, a generous per-request wait.
const CDR_TIMEOUT_MS = Number(process.env.XONTEL_CDR_TIMEOUT_SECONDS || 120) * 1000;
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
  if (!res.ok) { const err: any = new Error(`XonTel API ${res.status}`); err.status = res.status; throw err; }
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

// ---- What we have learned about this PBX ---------------------------------------------
//
// Measured on the real PBX (Test XonTel and the first runs, 2026-10-15..17):
//  - every CDR request costs a large fixed time (~13-50s); heavy requests (500 rows, two days, two
//    at a time) make the gateway in front of XonTel answer 502.
//  - with `agent=<id>` XonTel IGNORES the dates: it returns that employee's whole history, newest
//    first (Test XonTel 2026-10-17: Samah 188 rows, none from the asked day). Long-serving staff
//    therefore hit "more than 6000 calls"; only new, survey-only staff (Essam, Yousif) got verdicts.
//  - `call_type` takes XonTel's dialplan contexts (from-internal / ext-queues / ext-local), not
//    "Outgoing" (that is a 400). Outgoing calls carry dcontext=from-internal.
//  - `search=<last 8 digits>` finds an outgoing call by the customer's number (dst), ~28s a request.
// So each employee's calls are read newest first, and the reading stops once it is past the start of
// the period (from-internal only, if XonTel honours that). Only when the rows are not in time order,
// or the period is too long to page through, are that employee's surveys looked up one by one with
// the number search — and only after the search has found a known outgoing call (self-test), so a
// search that cannot see the dialled number never becomes "no call" verdicts. The process remembers
// what it learned for a few hours.

const LEARN_TTL_MS = 6 * 3600_000;
const learned: {
  typeFilter: { works: boolean; at: number } | null;     // does TYPE_PARAM narrow agent= results to outgoing calls?
  search: { works: boolean; at: number } | null;         // does `search=<customer>` find outgoing calls?
  sample: { id: string; key: string; day: string } | null; // a known outgoing call, to test the search with
  busy: Map<string, number>;                             // "agentId|fromDay" -> when it was found too long to read
} = { typeFilter: null, search: null, sample: null, busy: new Map() };
const fresh = (x: { at: number } | null) => !!x && Date.now() - x.at < LEARN_TTL_MS;
const TYPE_PARAM = "call_type=from-internal";
const isIncoming = (c: CdrCall) => /incoming/i.test(c.direction);
// Rows may be ordered by when the call ended — allow a little disorder before calling them unsorted.
const ORDER_TOLERANCE_MS = 10 * 60_000;

const rowsOf = (d: any): any[] => (Array.isArray(d) ? d : d?.results || []);
const kwDay = (ms: number) => new Date(ms + KW_OFFSET_MS).toISOString().slice(0, 10);
const nextDay = (day: string) => kwDay(Date.parse(`${day}T00:00:00+03:00`) + 86400_000);

/** Remember one of this agent's outgoing calls (customer in `dst`) to test the number search with. */
function noteSample(r: any, c: CdrCall) {
  if (learned.sample || !/outgoing/i.test(c.direction)) return;
  const key = last8(r?.dst);
  if (key) learned.sample = { id: c.id, key, day: kwDay(c.ts) };
}

// ---- Connection test ("Test XonTel") ------------------------------------------------
// Asks the questions the job depends on, against the busiest linked employees, and shows what an
// OUTGOING call record looks like (numbers masked). What it finds is also remembered by the job.

export const probeStatus: { running: boolean; startedAt: string | null; steps: { name: string; ms: number | null; info: string; error?: string }[]; layout: any } =
  { running: false, startedAt: null, steps: [], layout: null };

const maskDigits = (v: any) => String(v).replace(/\d/g, "N");

export async function runProbe(): Promise<void> {
  if (probeStatus.running) return;
  probeStatus.running = true; probeStatus.startedAt = new Date().toISOString(); probeStatus.steps = []; probeStatus.layout = null;
  const today = kwDay(Date.now());
  const step = async (name: string, path: string, info: (d: any) => string, timeoutMs = 130_000): Promise<any> => {
    const t0 = Date.now();
    try { const d = await xontelGet(path, timeoutMs); probeStatus.steps.push({ name, ms: Date.now() - t0, info: info(d) }); return d; }
    catch (e: any) { probeStatus.steps.push({ name, ms: Date.now() - t0, info: "", error: e?.message || String(e) }); return null; }
  };
  try {
    const f = await step("agent list (cdr/filters)", "/api/v1/cdr/filters", (d) => {
      const types = Object.entries(d || {}).find(([, v]) => Array.isArray(v) && v.some((o) => /outgoing/i.test(JSON.stringify(o))));
      return `${(d?.agent || d?.agents || []).length} agents · filters offered: ${Object.keys(d || {}).join(", ") || "none"}`
        + (types ? ` · call types under "${types[0]}": ${(types[1] as any[]).map((o) => o?.value ?? o?.label ?? o).join(" / ")}` : "");
    });
    // The two linked employees who finish the most surveys (one of them usually answers the queues too).
    const links = await DB.getXontelLinks();
    const users = await DB.getLinkableUsers();
    const byUser = new Map(links.map((l) => [l.user_id, l]));
    const picked = users.filter((u) => byUser.has(u.id)).slice(0, 2).map((u) => byUser.get(u.id)!);
    if (!picked.length) {
      const first = (f?.agent || f?.agents || [])[0];
      if (first) picked.push({ user_id: "", xontel_agent_id: String(first.value ?? first.id), xontel_agent_name: String(first.label ?? first.name ?? "") });
    }
    const seen: any[] = [];
    let busiest: { id: string; name: string; notOutgoing: number } | null = null;
    for (const p of picked) {
      const id = String(p.xontel_agent_id), name = p.xontel_agent_name || id;
      const d = await step(`${name}: today, 200 rows`, `/api/v1/cdr/?agent=${encodeURIComponent(id)}&start_date=${today}&end_date=${today}&size=200&page=1`, (d) => {
        const cs = rowsOf(d).map(toCall).filter(Boolean) as CdrCall[];
        const own = cs.filter((c) => c.agentId === id);
        const types: Record<string, number> = {};
        for (const c of own) types[c.direction || "?"] = (types[c.direction || "?"] || 0) + 1;
        const noAgent = cs.filter((c) => !c.agentId).length;
        const newestFirst = own.every((c, i) => i === 0 || c.ts <= own[i - 1].ts + ORDER_TOLERANCE_MS);
        return `${rowsOf(d).length} rows: ${own.length} this agent's (${Object.entries(types).map(([k, n]) => `${n} ${k}`).join(", ") || "none"}), `
          + `${noAgent} with no agent, ${cs.length - own.length - noAgent} of other agents, ${own.filter((c) => kwDay(c.ts) !== today).length} not from today`
          + (own.length ? ` · ${kwDay(Math.min(...own.map((c) => c.ts)))} to ${kwDay(Math.max(...own.map((c) => c.ts)))}, newest first: ${newestFirst ? "yes" : "NO"}` : "");
      });
      if (!d) continue;
      seen.push(...rowsOf(d));
      const own = (rowsOf(d).map(toCall).filter(Boolean) as CdrCall[]).filter((c) => c.agentId === id);
      const notOutgoing = own.filter(isIncoming).length;
      if (!busiest || notOutgoing > busiest.notOutgoing) busiest = { id, name, notOutgoing };
    }
    // Does the outgoing-only filter work? Only telling for someone who also has other calls.
    if (busiest && busiest.notOutgoing > 0) {
      const b = busiest;
      const d = await step(`${b.name}: today, outgoing only (${TYPE_PARAM})`, `/api/v1/cdr/?agent=${encodeURIComponent(b.id)}&start_date=${today}&end_date=${today}&${TYPE_PARAM}&size=200&page=1`, (d) => {
        const own = (rowsOf(d).map(toCall).filter(Boolean) as CdrCall[]).filter((c) => c.agentId === b.id);
        const bad = own.filter(isIncoming).length;
        return `${rowsOf(d).length} rows, ${own.length} this agent's, ${bad} of them incoming → the filter ${bad ? "is IGNORED" : own.length ? "WORKS" : "returned none of their calls"}`;
      });
      if (d) {
        const own = (rowsOf(d).map(toCall).filter(Boolean) as CdrCall[]).filter((c) => c.agentId === b.id);
        if (own.length) learned.typeFilter = { works: !own.some(isIncoming), at: Date.now() };
      }
    }
    // What an outgoing call looks like, and does the number search find it by the customer's number (dst)?
    const outRow = seen.find((r) => /outgoing/i.test(String(r?.call_type ?? "")) && last8(r?.dst));
    if (outRow) {
      probeStatus.layout = { call_type: String(outRow.call_type), fields: Object.fromEntries(Object.entries(outRow).map(([k, v]) => [k, v === null ? null : typeof v === "object" ? "{" + Object.keys(v as any).join(",") + "}" : /\d{4,}/.test(String(v)) && !/^\d{4}-\d\d-\d\d/.test(String(v)) && !/url|file/i.test(k) ? maskDigits(v) : String(v).slice(0, 40)])) };
      const c = toCall(outRow)!;
      const key = last8(outRow.dst)!;
      const d = await step("search by the customer's number (dst of that outgoing call)", `/api/v1/cdr/?search=${key}&start_date=${kwDay(c.ts)}&end_date=${kwDay(c.ts)}&size=50&page=1`,
        (d) => `${rowsOf(d).length} rows; found that outgoing call: ${rowsOf(d).some((r) => String(r?.id ?? r?.uniqueid) === c.id) ? "YES" : "NO"}`);
      if (d) {
        learned.search = { works: rowsOf(d).some((r) => String(r?.id ?? r?.uniqueid) === c.id), at: Date.now() };
        learned.sample = { id: c.id, key, day: kwDay(c.ts) };
      }
    } else {
      probeStatus.steps.push({ name: "outgoing call layout", ms: null, info: "no outgoing call with a customer number in the rows read — try again during working hours" });
    }
  } finally { probeStatus.running = false; }
}

// ---- The checking job -------------------------------------------------------------

const AGENT_PAGE_SIZE = Number(process.env.XONTEL_AGENT_PAGE_SIZE || 200);
const UNSORTED_MAX_PAGES = 3;       // rows not newest first: more than this is looked up survey by survey
const SORTED_MAX_PAGES = 15;        // newest first: most pages read to get back to the start of the period
const SEARCH_PAGE_SIZE = 50;
const SEARCH_MAX_PAGES = 4;
const CONCURRENCY = Math.max(1, Number(process.env.XONTEL_CONCURRENCY || 2));
const GATEWAY_RETRIES = [5_000, 20_000];          // waits before the 2nd and 3rd try of a request
// After a run that could not read XonTel at all, the timer leaves it alone for a while.
const AUTO_PAUSE_MS = 30 * 60_000;
// A run stops after this long and saves what it judged; the rest waits for the next run.
const AUTO_BUDGET_MS = 8 * 60_000;
const MANUAL_BUDGET_MS = 25 * 60_000;
// Before the first verdicts are saved in a run, this many reached claims must have been judged with at
// least MIN_GLOBAL_MATCH of them finding the employee's call — otherwise our reading of the records is
// wrong somewhere (field layout, filter) and saving would accuse everybody. Smaller runs: SMALL_RUN_MIN.
const GLOBAL_SANITY_MIN = 30;
const SMALL_RUN_MIN = 10;
const MIN_GLOBAL_MATCH = 0.2;
// Wrong-link signal: most of an employee's "no call" reached claims were called by ONE other XonTel user.
const OTHER_AGENT_MIN = 5;
const OTHER_AGENT_SHARE = 0.8;

export const checkStatus: {
  lastRunAt: string | null; lastError: string | null; lastChecked: number; lastWritten: number; lastSeconds: number; running: boolean;
  agentsTotal: number; agentsDone: number; surveysTotal: number; surveysDone: number; warnings: string[]; pausedUntil: string | null;
} = { lastRunAt: null, lastError: null, lastChecked: 0, lastWritten: 0, lastSeconds: 0, running: false, agentsTotal: 0, agentsDone: 0, surveysTotal: 0, surveysDone: 0, warnings: [], pausedUntil: null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isGatewayError = (e: any) => [502, 503, 504].includes(Number(e?.status)) || /did not answer within/.test(String(e?.message));
class BudgetSpent extends Error {}

/** One request, retried after a pause when the gateway in front of XonTel gives up (502/503/504, timeout). */
async function cdrGetWithRetry(path: string, deadline: number): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    if (Date.now() > deadline) throw new BudgetSpent();
    try { return await xontelGet(path, CDR_TIMEOUT_MS); }
    catch (e: any) {
      if (!isGatewayError(e) || attempt >= GATEWAY_RETRIES.length) throw e;
      await sleep(GATEWAY_RETRIES[attempt]);
    }
  }
}

/**
 * One employee's own calls between two Kuwait days, or "busy" when there are too many to read in time.
 * XonTel ignores the dates with agent=, so pages come newest first from today and the reading stops
 * once it is past the start of the period. Asks for outgoing calls only (TYPE_PARAM) unless XonTel is
 * known to ignore that; incoming rows in the answer mean it was ignored — they are then all their calls.
 */
export async function readAgentRange(agentId: string, fromDay: string, toDay: string, deadline: number): Promise<CdrCall[] | "busy"> {
  const startMs = Date.parse(`${fromDay}T00:00:00+03:00`), endMs = Date.parse(`${nextDay(toDay)}T00:00:00+03:00`);
  const busyKey = `${agentId}|${fromDay}`;
  const busyAt = learned.busy.get(busyKey);
  if (busyAt && Date.now() - busyAt < LEARN_TTL_MS) return "busy";
  let typed = !(fresh(learned.typeFilter) && !learned.typeFilter!.works);
  let out = new Map<string, CdrCall>();
  let sorted = true, prev = Infinity;
  const inRange = () => [...out.values()].filter((c) => c.ts >= startMs && c.ts < endMs);
  for (let page = 1; page <= (sorted ? SORTED_MAX_PAGES : UNSORTED_MAX_PAGES); page++) {
    // The dates are sent anyway, in case XonTel starts honouring them (start_date/end_date, per QA).
    const path = `/api/v1/cdr/?agent=${encodeURIComponent(agentId)}&start_date=${fromDay}&end_date=${toDay}${typed ? "&" + TYPE_PARAM : ""}&size=${AGENT_PAGE_SIZE}&page=${page}`;
    let data: any;
    try { data = await cdrGetWithRetry(path, deadline); }
    catch (e: any) {
      // XonTel refuses the filter outright: forget it and read again without it.
      if (typed && page === 1 && Number(e?.status) === 400) { learned.typeFilter = { works: false, at: Date.now() }; typed = false; page = 0; out = new Map(); continue; }
      throw e;
    }
    const rows = rowsOf(data);
    const own: CdrCall[] = [];
    // XonTel also returns rows that belong to no agent (internal legs) — keep only theirs.
    for (const r of rows) { const c = toCall(r); if (c && c.agentId === String(agentId)) { own.push(c); out.set(c.id, c); noteSample(r, c); } }
    for (const c of own) { if (c.ts > prev + ORDER_TOLERANCE_MS) sorted = false; prev = c.ts; }
    if (typed && own.length) {
      if (own.some(isIncoming)) { learned.typeFilter = { works: false, at: Date.now() }; typed = false; }
      else if (!fresh(learned.typeFilter)) learned.typeFilter = { works: true, at: Date.now() };
    }
    if (rows.length < AGENT_PAGE_SIZE) return inRange();
    // Newest first and already older than the period: everything after this is older still.
    if (sorted && own.length && own[own.length - 1].ts < startMs) return inRange();
  }
  learned.busy.set(busyKey, Date.now());
  return "busy";
}

/** Every call to/from one customer number between two Kuwait days, or null if there were too many to read. */
async function searchCustomer(cache: Map<string, CdrCall[] | null>, key: string, fromDay: string, toDay: string, deadline: number): Promise<CdrCall[] | null> {
  const ck = `${key}|${fromDay}|${toDay}`;
  if (cache.has(ck)) return cache.get(ck)!;
  const out = new Map<string, CdrCall>();
  let complete = false;
  for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
    const rows = rowsOf(await cdrGetWithRetry(`/api/v1/cdr/?search=${key}&start_date=${fromDay}&end_date=${toDay}&size=${SEARCH_PAGE_SIZE}&page=${page}`, deadline));
    // The search may match on any field — keep only rows that really carry this number.
    for (const r of rows) { const c = toCall(r); if (c && c.keys.includes(key)) out.set(c.id, c); }
    if (rows.length < SEARCH_PAGE_SIZE) { complete = true; break; }
  }
  const res = complete ? [...out.values()] : null;
  cache.set(ck, res);
  return res;
}

/** Does the number search find a known outgoing call by its customer's number? null = no call to test with yet. */
async function searchWorks(cache: Map<string, CdrCall[] | null>, deadline: number): Promise<boolean | null> {
  if (fresh(learned.search)) return learned.search!.works;
  const s = learned.sample;
  if (!s) return null;
  const found = await searchCustomer(cache, s.key, s.day, s.day, deadline);
  learned.search = { works: !!found && found.some((c) => c.id === s.id), at: Date.now() };
  return learned.search.works;
}

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
  // The timer leaves a struggling XonTel alone for a while; a supervisor's "Verify now" always runs.
  if (opts.mode === "auto" && checkStatus.pausedUntil && Date.now() < new Date(checkStatus.pausedUntil).getTime()) {
    return { checked: 0, written: 0, skipped: 0, error: "paused" };
  }
  checkStatus.running = true;
  checkStatus.pausedUntil = null;
  checkStatus.agentsTotal = 0; checkStatus.agentsDone = 0; checkStatus.surveysTotal = 0; checkStatus.surveysDone = 0;
  for (const [k, at] of learned.busy) if (Date.now() - at >= LEARN_TTL_MS) learned.busy.delete(k);
  const started = Date.now();
  const deadline = started + (opts.mode === "manual" ? MANUAL_BUDGET_MS : AUTO_BUDGET_MS);
  let checked = 0, written = 0, skipped = 0;
  const errors: string[] = [], warnings: string[] = [];
  let fatal: string | null = null, budgetHit = false;
  try {
    const now = Date.now();
    const surveys: any[] = await DB.getSurveysForCallCheck({
      fromISO: opts.fromISO ?? new Date(now - RECHECK_WINDOW_HOURS * 3600_000).toISOString(),
      toISO: opts.toISO ?? new Date(now).toISOString(),
      force: opts.mode === "manual", recheckWindowHours: RECHECK_WINDOW_HOURS, limit: 2500,
    });
    checked = surveys.length;
    checkStatus.surveysTotal = checked;

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
    const searchCache = new Map<string, CdrCall[] | null>();
    const flush = async (rows: any[]) => { if (rows.length) { await DB.upsertSurveyCallChecks(rows); written += rows.length; } };
    const commit = async (rows: any[]) => {
      for (const r of rows) if (r.reached) { reachedJudged++; if (r.result !== "no_call") reachedMatched++; }
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
    const failed = (g: { name: string }, e: any) => {
      errors.push(`${g.name}: ${e?.message || e}`);
      consecutiveFailures++;
      if (!anySuccess && consecutiveFailures >= 3) fatal = `XonTel could not be read for the first ${consecutiveFailures} employees (${e?.message || e})`;
    };

    const handle = async (g: typeof queue[number]) => {
      const fromDay = kwDay(g.from), toDay = kwDay(Math.min(g.to, now));
      const rows: any[] = [];
      const judged = (t: { s: any; completedMs: number }, j: CallJudgement) => {
        // A call that just ended may not be in the records yet — only a missing call that is old enough is a finding.
        if (j.result === "no_call" && now - t.completedMs < PENDING_GRACE_MS) { skipped++; return; }
        rows.push({ assignment_id: t.s.id, ...j, reached: isReachedClaim(t.s.status) });
      };
      // Without a usable number there is nothing to look for — never a "no call".
      const items = g.items.filter((t) => { if (last8(t.s.customer_phone)) return true; skipped++; checkStatus.surveysDone++; return false; });

      // 1) Their own calls over the period, newest first, while that is short enough to read.
      let calls: CdrCall[] | null;
      try {
        const r = await readAgentRange(g.agentId, fromDay, toDay, deadline);
        calls = r === "busy" ? null : r;
      } catch (e: any) {
        if (e instanceof BudgetSpent) { budgetHit = true; return; }
        failed(g, e); checkStatus.surveysDone += items.length; return;
      }
      anySuccess = true; consecutiveFailures = 0;

      if (calls) {
        const reachedClaims = items.filter((t) => isReachedClaim(t.s.status)).length;
        // Not a single call of any kind for this employee on these days, yet many surveys saved as reached:
        // far more likely a wrong XonTel link than a person who never touched the phone. Don't judge — say so.
        if (calls.length === 0 && reachedClaims >= 10) {
          warnings.push(`${g.name}: no calls at all in XonTel for ${reachedClaims} reached surveys — check that this employee is linked to the right XonTel user`);
          checkStatus.surveysDone += items.length;
          return;
        }
        const index = indexCalls(calls);
        for (const t of items) judged(t, judgeSurvey(index, { phone: t.s.customer_phone, status: t.s.status, completedMs: t.completedMs, agentId: g.agentId }));
        checkStatus.surveysDone += items.length;
        // Their own records hold no call for ANY of many reached claims. A wrong link looks exactly like
        // this (their own records cannot show who else called), so before believing it, ask the number
        // search who called a few of those customers.
        const noCallRows = rows.filter((r) => r.reached && r.result === "no_call");
        if (noCallRows.length >= OTHER_AGENT_MIN && !rows.some((r) => r.reached && r.result !== "no_call")) {
          let works: boolean | null = null, caller: string | null = null;
          try {
            works = await searchWorks(searchCache, deadline);
            if (works) for (const r of noCallRows.slice(0, 3)) {
              const t = items.find((x) => x.s.id === r.assignment_id)!;
              const key = last8(t.s.customer_phone)!, w = surveyWindow(t.s.status, t.completedMs);
              const found = await searchCustomer(searchCache, key, kwDay(w.from), kwDay(Math.min(w.to, now)), deadline);
              const j = found && judgeSurvey(new Map([[key, found]]), { phone: t.s.customer_phone, status: t.s.status, completedMs: t.completedMs, agentId: g.agentId });
              if (j && j.relation === "other") { caller = j.xontel_agent || "another user"; break; }
            }
          } catch (e: any) { if (e instanceof BudgetSpent) budgetHit = true; works = null; }
          if (works !== true || caller) {
            warnings.push(caller
              ? `${g.name}: none of ${noCallRows.length} reached surveys has a call from their XonTel user, but XonTel user "${caller}" called those customers — check the link; not judged`
              : `${g.name}: none of ${noCallRows.length} reached surveys has a call from their XonTel user — check the link; not judged until that can be confirmed`);
            return;
          }
        }
      } else {
        // 2) Too many records to page through: look each survey's customer up instead, reached claims first.
        let works: boolean | null;
        try { works = await searchWorks(searchCache, deadline); }
        catch (e: any) { if (e instanceof BudgetSpent) { budgetHit = true; return; } failed(g, e); checkStatus.surveysDone += items.length; return; }
        if (works !== true) {
          errors.push(`${g.name}: too many XonTel records to read them all, and ${works === false ? "XonTel's number search does not find outgoing calls" : "the number search could not be tested yet (no outgoing call seen)"} — not judged`);
          checkStatus.surveysDone += items.length;
          return;
        }
        const ordered = [...items.filter((t) => isReachedClaim(t.s.status)), ...items.filter((t) => !isReachedClaim(t.s.status))];
        for (const t of ordered) {
          const key = last8(t.s.customer_phone)!;
          const w = surveyWindow(t.s.status, t.completedMs);
          let found: CdrCall[] | null;
          try { found = await searchCustomer(searchCache, key, kwDay(w.from), kwDay(Math.min(w.to, now)), deadline); }
          catch (e: any) { if (e instanceof BudgetSpent) budgetHit = true; else errors.push(`${g.name}: ${e?.message || e}`); break; }
          checkStatus.surveysDone++;
          if (!found) { skipped++; continue; }
          judged(t, judgeSurvey(new Map([[key, found]]), { phone: t.s.customer_phone, status: t.s.status, completedMs: t.completedMs, agentId: g.agentId }));
        }
      }

      // Most "no call" reached claims were dialled by ONE other XonTel user: the link is the likelier mistake.
      const noCall = rows.filter((r) => r.reached && r.result === "no_call");
      const matched = rows.filter((r) => r.reached && r.result !== "no_call").length;
      const byOther = new Map<string, number>();
      for (const r of noCall) if (r.relation === "other" && r.xontel_agent) byOther.set(r.xontel_agent, (byOther.get(r.xontel_agent) || 0) + 1);
      const top = [...byOther.entries()].sort((a, b) => b[1] - a[1])[0];
      if (noCall.length >= OTHER_AGENT_MIN && top && top[1] >= noCall.length * OTHER_AGENT_SHARE && matched < noCall.length) {
        warnings.push(`${g.name}: ${top[1]} of ${noCall.length} reached surveys with no call of theirs were called by XonTel user "${top[0]}" — check that ${g.name} is linked to the right XonTel user; not judged`);
        return;
      }
      await commit(rows);
    };

    // A small pool: CONCURRENCY employees at a time, stopping early on a fatal problem or a spent budget.
    let next = 0;
    const worker = async () => {
      while (!fatal && !budgetHit && next < queue.length) {
        const g = queue[next++];
        await handle(g);
        checkStatus.agentsDone++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (!fatal && held.length) {
      // A run too small for the main sanity threshold still must not look systemic.
      if (reachedJudged >= SMALL_RUN_MIN && reachedMatched / reachedJudged < MIN_GLOBAL_MATCH) {
        fatal = `Only ${reachedMatched} of ${reachedJudged} reached surveys found any call from their own agent — nothing was recorded. Run "Test XonTel" and send the result.`;
      } else { const toWrite = held; held = []; await flush(toWrite); }
    }
    if (budgetHit && !fatal) {
      const left = Math.max(0, checkStatus.surveysTotal - checkStatus.surveysDone);
      warnings.push(`Stopped after ${Math.round((Date.now() - started) / 60_000)} min so XonTel is not overloaded — ${left} survey(s) wait for the next check (every 10 minutes)`);
    }
  } catch (e: any) {
    fatal = e?.message || String(e);
  } finally {
    const failure = fatal || (errors.length ? `${errors.length} employee(s) could not be checked — ${errors.slice(0, 2).join("; ")}${errors.length > 2 ? "; …" : ""}` : null);
    checkStatus.lastRunAt = new Date().toISOString();
    checkStatus.lastError = failure;
    checkStatus.warnings = warnings;
    checkStatus.lastChecked = checked; checkStatus.lastWritten = written;
    checkStatus.lastSeconds = Math.round((Date.now() - started) / 1000);
    // Nothing could be read at all: give XonTel a rest before the timer tries again.
    if (fatal && written === 0) checkStatus.pausedUntil = new Date(Date.now() + AUTO_PAUSE_MS).toISOString();
    checkStatus.running = false;
    if (checked) console.log(`[call-check] ${opts.mode}: ${checked} survey(s), ${checkStatus.agentsTotal} employee(s), ${written} verdict(s) saved, ${skipped} skipped, ${checkStatus.lastSeconds}s`
      + ` (outgoing filter: ${learned.typeFilter ? learned.typeFilter.works : "?"}, search: ${learned.search ? learned.search.works : "?"}, busy days: ${learned.busy.size})${failure ? " — " + failure : ""}`);
  }
  const failure = checkStatus.lastError;
  return failure ? { checked, written, skipped, error: failure } : { checked, written, skipped };
}
