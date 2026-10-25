// ---------------------------------------------------------------------------
//  Offer campaigns — the Shakir win-back campaign and any later one like it.
//
//  Leaders upload customers (Excel) and assign them to agents. The agent makes the first call with the
//  campaign script and records the outcome. When a customer calls back, any agent looks the number up,
//  sees whether the offer is still valid and which discount is next, and logs the order. Every step is an
//  offer_events row (the customer's history) and an audit_logs row (the universal action log, with the value
//  before and after). No approval step (the business said it is not needed, 2026-10-25).
//
//  The offer: steps[0] % off the 1st order, steps[1] % the 2nd, steps[2] % the 3rd, in that order, once
//  each, within validity_days of the day the offer was first recorded for the customer — the call where they
//  accepted it (or ordered), or their first order if they called us first. A customer who said "not
//  interested" has no running offer until then. Days are Kuwait days.
// ---------------------------------------------------------------------------
import { DB } from "./db.js";

export const OPEN_STATUSES = ["not_called", "no_answer", "busy", "call_back"];           // still to be called
export const CALL_STATUSES = ["not_called", "no_answer", "busy", "call_back", "wrong_number", "not_interested", "accepted", "ordered"];
export const REACHED_STATUSES = ["call_back", "not_interested", "accepted", "ordered"];
const OFFER_STARTS = ["accepted", "ordered"];                                            // the customer took the offer in this call

const KW_MS = 3 * 3600_000;
const kwDay = (ms: number) => new Date(ms + KW_MS).toISOString().slice(0, 10);
const kwToday = () => kwDay(Date.now());
const isDay = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
const newId = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

type Deps = {
  authenticateJWT: any; asyncHandler: (fn: (req: any, res: any) => Promise<any>) => any;
  XLSX: any; pick: (row: Record<string, any>, ...names: string[]) => string;
  normalisePhone: (p: string) => string; isLeaderLevel: (role: string) => boolean; OPS_ROLES: Set<string>;
};

export type Eligibility = {
  state: "not_started" | "active" | "expired" | "completed";
  next: { step: number; discount: number } | null; used: number; total: number;
  starts: string | null; expires: string | null; daysLeft: number | null;
};

export function eligibility(c: any, steps: number[], orderCount: number, now = Date.now()): Eligibility {
  const next = orderCount < steps.length ? { step: orderCount + 1, discount: Number(steps[orderCount]) } : null;
  const starts = c.offer_started_at ? kwDay(new Date(c.offer_started_at).getTime()) : null;
  const expires = c.offer_expires_at ? kwDay(new Date(c.offer_expires_at).getTime()) : null;
  const today = kwDay(now);
  const state = !next ? "completed" : !starts ? "not_started" : expires && today > expires ? "expired" : "active";
  const daysLeft = expires ? Math.max(0, Math.round((Date.parse(expires + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400_000)) : null;
  return { state, next, used: orderCount, total: steps.length, starts, expires, daysLeft };
}

async function getCampaign(id: string): Promise<any | undefined> {
  return (await DB.query(`SELECT c.*, b.brand_name FROM offer_campaigns c LEFT JOIN brands b ON b.id = c.brand_id WHERE c.id = $1`, [id]))[0];
}

async function addEvent(e: { customerId: string; campaignId: string; kind: string; user: any; direction?: string | null; call_status?: string | null; prev_status?: string | null; churn_reason?: string | null; comment?: string | null; details?: any }) {
  await DB.query(
    `INSERT INTO offer_events (id, customer_id, campaign_id, kind, direction, call_status, prev_status, churn_reason, comment, details, user_id, user_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [newId("ofe"), e.customerId, e.campaignId, e.kind, e.direction ?? null, e.call_status ?? null, e.prev_status ?? null,
      e.churn_reason ?? null, e.comment ?? null, e.details ? JSON.stringify(e.details) : null, e.user?.id ?? null, e.user?.full_name ?? null]);
}

// One customer with everything the call screen and the lookup need.
async function loadCustomer(id: string): Promise<any | undefined> {
  const c = (await DB.query(`
    SELECT oc.*, u.full_name AS agent_name, fu.full_name AS first_call_agent_name
      FROM offer_customers oc LEFT JOIN users u ON u.id = oc.assigned_agent_id LEFT JOIN users fu ON fu.id = oc.first_call_agent_id
     WHERE oc.id = $1`, [id]))[0];
  if (!c) return undefined;
  const [camp, orders, events, dnc] = await Promise.all([
    getCampaign(c.campaign_id),
    DB.query(`SELECT * FROM offer_orders WHERE customer_id = $1 ORDER BY step`, [id]),
    DB.query(`SELECT * FROM offer_events WHERE customer_id = $1 ORDER BY created_at, CASE kind WHEN 'upload' THEN 0 WHEN 'assign' THEN 1 ELSE 2 END, id`, [id]),
    DB.getDnc(c.phone),
  ]);
  return { customer: c, campaign: camp, orders, events, eligibility: eligibility(c, camp?.steps || [], orders.length), dnc: dnc || null };
}

export function registerOfferRoutes(app: any, d: Deps) {
  const { authenticateJWT, asyncHandler } = d;
  const canCall = (u: any) => !!u && u.role !== "marketing" && !d.OPS_ROLES.has(u.role);
  const canManage = (u: any) => !!u && d.isLeaderLevel(u.role);
  const CALL = (req: any, res: any, next: any) => (canCall(req.user) ? next() : res.status(403).json({ error: "Access denied." }));
  const MANAGE = (req: any, res: any, next: any) => (canManage(req.user) ? next() : res.status(403).json({ error: "Only team leaders, supervisors and admins can do this." }));
  const B = "/api/offer-campaigns";

  // ---- campaigns ----
  app.get(B, authenticateJWT, CALL, asyncHandler(async (_req, res) => {
    res.json(await DB.query(`SELECT c.*, b.brand_name FROM offer_campaigns c LEFT JOIN brands b ON b.id = c.brand_id ORDER BY (c.status = 'active') DESC, c.created_at`));
  }));

  app.put(`${B}/:id`, authenticateJWT, MANAGE, asyncHandler(async (req, res) => {
    const camp = await getCampaign(req.params.id);
    if (!camp) return res.status(404).json({ error: "Campaign not found." });
    const b = req.body || {};
    const sets: string[] = [], vals: any[] = [req.params.id], changed: string[] = [];
    const set = (col: string, v: any, label: string) => { vals.push(v); sets.push(`${col} = $${vals.length}`); changed.push(label); };
    if (typeof b.name === "string" && b.name.trim() && b.name.trim() !== camp.name) set("name", b.name.trim().slice(0, 80), `name "${camp.name}" → "${b.name.trim()}"`);
    if (b.validity_days !== undefined) {
      const v = Number(b.validity_days);
      if (!Number.isInteger(v) || v < 1 || v > 365) return res.status(400).json({ error: "Validity must be 1 to 365 days." });
      if (v !== camp.validity_days) set("validity_days", v, `validity ${camp.validity_days} → ${v} days`);
    }
    if (b.steps !== undefined) {
      const s = Array.isArray(b.steps) ? b.steps.map(Number) : [];
      if (!s.length || s.length > 5 || s.some((x: number) => !Number.isInteger(x) || x < 1 || x > 100)) return res.status(400).json({ error: "Discounts must be 1 to 5 whole percentages between 1 and 100." });
      if (JSON.stringify(s) !== JSON.stringify(camp.steps)) set("steps", JSON.stringify(s), `discounts ${camp.steps.join("/")}% → ${s.join("/")}%`);
    }
    if (typeof b.script_ar === "string" && b.script_ar !== camp.script_ar) set("script_ar", b.script_ar.slice(0, 8000), "Arabic script");
    if (typeof b.script_en === "string" && b.script_en !== camp.script_en) set("script_en", b.script_en.slice(0, 8000), "English script");
    if (b.churn_reasons !== undefined) {
      const r = Array.isArray(b.churn_reasons) ? [...new Set(b.churn_reasons.map((x: any) => String(x).trim()).filter(Boolean))].slice(0, 30) : null;
      if (!r || !r.length) return res.status(400).json({ error: "Keep at least one churn reason." });
      if (JSON.stringify(r) !== JSON.stringify(camp.churn_reasons)) set("churn_reasons", JSON.stringify(r), "churn reasons");
    }
    if (b.status === "active" || b.status === "paused") { if (b.status !== camp.status) set("status", b.status, `status ${camp.status} → ${b.status}`); }
    if (!sets.length) return res.json(camp);
    await DB.query(`UPDATE offer_campaigns SET ${sets.join(", ")} WHERE id = $1`, vals);
    req.auditExtra = { details: `${camp.name}: ${changed.join(", ")}` };
    res.json(await getCampaign(req.params.id));
  }));

  app.get(`${B}/template`, authenticateJWT, MANAGE, asyncHandler(async (_req, res) => {
    const ws = d.XLSX.utils.aoa_to_sheet([["Customer Name", "Phone", "Agent", "Notes"], ["Ahmad Ali", "99999999", "", "last order 2 months ago"]]);
    const wb = d.XLSX.utils.book_new();
    d.XLSX.utils.book_append_sheet(wb, ws, "Customers");
    res.json({ filename: "offer_campaign_customers.xlsx", file: d.XLSX.write(wb, { type: "base64", bookType: "xlsx" }) });
  }));

  // ---- upload customers ----
  app.post(`${B}/:id/upload`, authenticateJWT, MANAGE, asyncHandler(async (req, res) => {
    const camp = await getCampaign(req.params.id);
    if (!camp) return res.status(404).json({ error: "Campaign not found." });
    const { file, dry_run } = req.body || {};
    if (!file) return res.status(400).json({ error: "No file provided." });
    const wb = d.XLSX.read(Buffer.from(file, "base64"), { type: "buffer" });
    const rows: Record<string, any>[] = d.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    if (!rows.length) return res.status(400).json({ error: "The file has no rows." });

    const NAME_COLS = ["Customer Name", "Name", "Customer", "Full Name", "الاسم", "اسم العميل"];
    const PHONE_COLS = ["Phone", "Phone Number", "Mobile", "Mobile Number", "Customer Phone", "Number", "رقم الهاتف", "الرقم", "الموبايل", "رقم العميل"];
    const AGENT_COLS = ["Agent", "Agent Name", "الموظف"];
    const known = new Set([...NAME_COLS, ...PHONE_COLS, ...AGENT_COLS].map((s) => s.toLowerCase()));

    const existing = new Map<string, string>((await DB.query(`SELECT phone_key, call_status FROM offer_customers WHERE campaign_id = $1`, [camp.id])).map((r: any) => [r.phone_key, r.call_status]));
    const dnc = new Set(await DB.getDncKeys());
    const users = await DB.query(`SELECT id, full_name FROM users WHERE status = 'Active'`);
    const userByName = new Map<string, any>(users.map((u: any) => [String(u.full_name).trim().toLowerCase(), u]));

    const issues: { row: number; reason: string; phone?: string | null; customer_name?: string | null; detail?: string | null }[] = [];
    const counts: Record<string, number> = { dup_file: 0, already_in_campaign: 0, do_not_call: 0, empty_row: 0, error: 0 };
    const seen = new Map<string, number>();
    const toInsert: { name: string | null; phone: string; key: string; agentId: string | null; extra: Record<string, string> | null }[] = [];
    let unmatchedAgents = 0;
    rows.forEach((row, i) => {
      const rowNo = i + 2;
      const name = d.pick(row, ...NAME_COLS) || null;
      const rawPhone = d.pick(row, ...PHONE_COLS);
      const extra: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) if (!known.has(k.toLowerCase().trim()) && String(v ?? "").trim()) extra[k.trim()] = String(v).trim().slice(0, 300);
      if (!name && !rawPhone && !Object.keys(extra).length) { counts.empty_row++; return; }
      const key = DB.dncKey(rawPhone);
      if (!key) { counts.error++; issues.push({ row: rowNo, reason: "error", phone: rawPhone || null, customer_name: name, detail: "Missing or invalid phone number (needs at least 8 digits)" }); return; }
      const digits = d.normalisePhone(rawPhone).replace(/\D/g, "");
      const phone = digits.length === 11 && digits.startsWith("965") ? digits.slice(3) : digits.length === 8 ? digits : d.normalisePhone(rawPhone);
      if (seen.has(key)) { counts.dup_file++; issues.push({ row: rowNo, reason: "dup_file", phone, customer_name: name, detail: `Same number as row ${seen.get(key)} of this file` }); return; }
      seen.set(key, rowNo);
      if (existing.has(key)) { counts.already_in_campaign++; issues.push({ row: rowNo, reason: "already_in_campaign", phone, customer_name: name, detail: `Already in this campaign (status: ${existing.get(key)})` }); return; }
      if (dnc.has(key)) { counts.do_not_call++; issues.push({ row: rowNo, reason: "do_not_call", phone, customer_name: name, detail: "Customer asked not to be called again (Do Not Call list)" }); return; }
      const agentName = d.pick(row, ...AGENT_COLS);
      let agentId: string | null = null;
      if (agentName) {
        const u = userByName.get(agentName.trim().toLowerCase());
        if (u) agentId = u.id; else { unmatchedAgents++; issues.push({ row: rowNo, reason: "agent_not_found", phone, customer_name: name, detail: `No active user named "${agentName}" — added without an agent` }); }
      }
      toInsert.push({ name, phone, key, agentId, extra: Object.keys(extra).length ? extra : null });
    });

    const summary = { total: rows.length, inserted: 0, assigned: toInsert.filter((r) => r.agentId).length, skipped: counts.dup_file + counts.already_in_campaign + counts.do_not_call + counts.empty_row, errors: counts.error, unmatched_agents: unmatchedAgents, counts, issues: issues.slice(0, 500) };
    if (dry_run) return res.json({ ...summary, dry_run: true, would_insert: toInsert.length });

    const batchId = `upl-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
    const today = kwToday();
    for (let i = 0; i < toInsert.length; i += 400) {
      const chunk = toInsert.slice(i, i + 400);
      const vals: any[] = [];
      const tuples = chunk.map((r, j) => {
        const base = j * 9;
        vals.push(newId("ocu") + "-" + (i + j), camp.id, r.phone, r.key, r.name, r.extra ? JSON.stringify(r.extra) : null, r.agentId, today, batchId);
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},CASE WHEN $${base + 7}::text IS NULL THEN NULL ELSE now() END,$${base + 8}::date,$${base + 9})`;
      });
      vals.push(req.user.id, req.user.full_name);
      const n = vals.length;
      const r = await DB.query(
        `INSERT INTO offer_customers (id, campaign_id, phone, phone_key, customer_name, extra, assigned_agent_id, assigned_at, contact_date, upload_batch_id, uploaded_by, uploaded_by_name)
         SELECT v.id, v.campaign_id, v.phone, v.phone_key, v.customer_name, v.extra::jsonb, v.assigned_agent_id, v.assigned_at, v.contact_date, v.upload_batch_id, $${n - 1}, $${n}
           FROM (VALUES ${tuples.join(",")}) AS v(id, campaign_id, phone, phone_key, customer_name, extra, assigned_agent_id, assigned_at, contact_date, upload_batch_id)
         ON CONFLICT (campaign_id, phone_key) DO NOTHING RETURNING id`, vals);
      summary.inserted += r.length;
    }
    // History: one "uploaded" (and "assigned") event per new customer, written in one statement each.
    await DB.query(`INSERT INTO offer_events (id, customer_id, campaign_id, kind, details, user_id, user_name, created_at)
      SELECT 'ofe-' || oc.id, oc.id, oc.campaign_id, 'upload', jsonb_build_object('batch', $2::text), $3, $4, oc.uploaded_at FROM offer_customers oc WHERE oc.upload_batch_id = $1`,
      [batchId, batchId, req.user.id, req.user.full_name]);
    await DB.query(`INSERT INTO offer_events (id, customer_id, campaign_id, kind, details, user_id, user_name)
      SELECT 'ofa-' || oc.id, oc.id, oc.campaign_id, 'assign', jsonb_build_object('to', u.full_name, 'from_file', true), $2, $3
        FROM offer_customers oc JOIN users u ON u.id = oc.assigned_agent_id WHERE oc.upload_batch_id = $1`, [batchId, req.user.id, req.user.full_name]);
    await DB.addUploadBatch({
      id: batchId, upload_type: "offer_customers", ref_id: camp.id, ref_label: camp.name,
      uploaded_by: req.user.id, uploaded_by_name: req.user.full_name,
      total_rows: rows.length, inserted: summary.inserted, skipped: summary.skipped, errors: counts.error,
      skip_breakdown: counts, issue_rows: issues as any,
    });
    req.auditExtra = { details: `${camp.name}: uploaded ${summary.inserted} customer(s) of ${rows.length} row(s)${summary.assigned ? `, ${summary.assigned} pre-assigned` : ""}, ${summary.skipped} skipped, ${counts.error} rejected` };
    res.json(summary);
  }));

  // ---- the customers list (leaders) ----
  app.get(`${B}/:id/customers`, authenticateJWT, MANAGE, asyncHandler(async (req, res) => {
    const camp = await getCampaign(req.params.id);
    if (!camp) return res.status(404).json({ error: "Campaign not found." });
    const q = (k: string) => (typeof req.query[k] === "string" ? String(req.query[k]).trim() : "");
    const where = ["oc.campaign_id = $1"], vals: any[] = [camp.id];
    const add = (sql: string, v: any) => { vals.push(v); where.push(sql.split("$?").join(`$${vals.length}`)); };
    if (q("status") === "open") where.push(`oc.call_status IN ('not_called','no_answer','busy','call_back')`);
    else if (q("status")) add("oc.call_status = $?", q("status"));
    if (q("agent") === "unassigned") where.push("oc.assigned_agent_id IS NULL");
    else if (q("agent")) add("oc.assigned_agent_id = $?", q("agent"));
    if (isDay(q("from"))) add("(oc.uploaded_at AT TIME ZONE 'Asia/Kuwait')::date >= $?::date", q("from"));
    if (isDay(q("to"))) add("(oc.uploaded_at AT TIME ZONE 'Asia/Kuwait')::date <= $?::date", q("to"));
    if (q("search")) add("(oc.phone ILIKE '%' || $? || '%' OR oc.customer_name ILIKE '%' || $? || '%')", q("search"));
    const rows = await DB.query(`
      SELECT oc.id, oc.phone, oc.customer_name, oc.extra, oc.uploaded_at, oc.uploaded_by_name, oc.assigned_agent_id, u.full_name AS agent_name,
             oc.contact_date, oc.call_status, oc.attempts, oc.first_call_at, oc.last_call_at, oc.churn_reason, oc.comment,
             oc.offer_started_at, oc.offer_expires_at,
             COALESCE((SELECT json_agg(json_build_object('step', o.step, 'discount', o.discount, 'order_date', o.order_date, 'order_number', o.order_number) ORDER BY o.step)
                         FROM offer_orders o WHERE o.customer_id = oc.id), '[]'::json) AS orders
        FROM offer_customers oc LEFT JOIN users u ON u.id = oc.assigned_agent_id
       WHERE ${where.join(" AND ")}
       ORDER BY oc.uploaded_at DESC, oc.id LIMIT 5000`, vals);
    const now = Date.now();
    let out = rows.map((r: any) => ({ ...r, eligibility: eligibility(r, camp.steps, r.orders.length, now) }));
    if (q("offer")) out = out.filter((r: any) => r.eligibility.state === q("offer"));
    res.json({ rows: out, cap: 5000 });
  }));

  app.get(`${B}/:id/agents`, authenticateJWT, MANAGE, asyncHandler(async (req, res) => {
    res.json(await DB.query(`
      SELECT u.id, u.full_name, u.role,
             count(oc.id) FILTER (WHERE oc.call_status IN ('not_called','no_answer','busy','call_back'))::int AS open
        FROM users u LEFT JOIN offer_customers oc ON oc.assigned_agent_id = u.id AND oc.campaign_id = $1
       WHERE u.status = 'Active' AND u.role IN ('agent','leader','supervisor')
       GROUP BY u.id, u.full_name, u.role ORDER BY u.full_name`, [req.params.id]));
  }));

  // Give N waiting, never-called, unassigned customers (oldest upload first) to one agent.
  app.post(`${B}/:id/assign`, authenticateJWT, MANAGE, asyncHandler(async (req, res) => {
    const camp = await getCampaign(req.params.id);
    if (!camp) return res.status(404).json({ error: "Campaign not found." });
    const count = Math.min(Math.max(Number(req.body?.count) || 0, 0), 2000);
    const agent = (await DB.query(`SELECT id, full_name FROM users WHERE id = $1 AND status = 'Active'`, [req.body?.agent_id]))[0];
    if (!agent || !count) return res.status(400).json({ error: "Pick an agent and how many customers to give them." });
    const ids = (await DB.query(`
      UPDATE offer_customers SET assigned_agent_id = $2, assigned_at = now()
       WHERE id IN (SELECT id FROM offer_customers WHERE campaign_id = $1 AND assigned_agent_id IS NULL AND call_status = 'not_called'
                     ORDER BY uploaded_at, id LIMIT $3)
      RETURNING id`, [camp.id, agent.id, count])).map((r: any) => r.id);
    if (ids.length) await DB.query(`INSERT INTO offer_events (id, customer_id, campaign_id, kind, details, user_id, user_name)
      SELECT 'ofa-' || x || '-' || $5::text, x, $1, 'assign', jsonb_build_object('to', $2::text), $3, $4 FROM unnest($6::text[]) AS x`,
      [camp.id, agent.full_name, req.user.id, req.user.full_name, String(Date.now()), ids]);
    req.auditExtra = { details: `${camp.name}: gave ${ids.length} customer(s) to ${agent.full_name}`, new_value: agent.full_name };
    res.json({ assigned: ids.length });
  }));

  // Move one customer to another agent (or to nobody) — only while they are still to be called.
  app.patch(`${B}/customers/:id/assign`, authenticateJWT, MANAGE, asyncHandler(async (req, res) => {
    const c = (await DB.query(`SELECT oc.*, u.full_name AS agent_name FROM offer_customers oc LEFT JOIN users u ON u.id = oc.assigned_agent_id WHERE oc.id = $1`, [req.params.id]))[0];
    if (!c) return res.status(404).json({ error: "Customer not found." });
    if (!OPEN_STATUSES.includes(c.call_status)) return res.status(409).json({ error: `This customer is already "${c.call_status}" — only customers still to be called can change hands.` });
    const agentId = req.body?.agent_id || null;
    const agent = agentId ? (await DB.query(`SELECT id, full_name FROM users WHERE id = $1 AND status = 'Active'`, [agentId]))[0] : null;
    if (agentId && !agent) return res.status(400).json({ error: "Unknown agent." });
    await DB.query(`UPDATE offer_customers SET assigned_agent_id = $2, assigned_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END WHERE id = $1`, [c.id, agent?.id || null]);
    await addEvent({ customerId: c.id, campaignId: c.campaign_id, kind: "assign", user: req.user, details: { from: c.agent_name || null, to: agent?.full_name || null } });
    req.auditExtra = { details: `${c.customer_name || ""} ${c.phone}`.trim(), previous_value: c.agent_name || "(unassigned)", new_value: agent?.full_name || "(unassigned)" };
    res.json({ ok: true });
  }));

  // ---- agents ----
  app.get(`${B}/:id/my-calls`, authenticateJWT, CALL, asyncHandler(async (req, res) => {
    const camp = await getCampaign(req.params.id);
    if (!camp) return res.status(404).json({ error: "Campaign not found." });
    const today = kwToday();
    const [rows, later, done] = await Promise.all([
      DB.query(`
        SELECT oc.id, oc.phone, oc.customer_name, oc.extra, oc.call_status, oc.attempts, oc.contact_date, oc.last_call_at, oc.comment, oc.uploaded_at
          FROM offer_customers oc
         WHERE oc.campaign_id = $1 AND oc.assigned_agent_id = $2 AND oc.call_status IN ('not_called','no_answer','busy','call_back')
           AND (oc.contact_date IS NULL OR oc.contact_date <= $3::date)
           AND NOT EXISTS (SELECT 1 FROM do_not_call d WHERE d.phone_key = oc.phone_key)
         ORDER BY oc.contact_date NULLS FIRST, (oc.call_status = 'call_back') DESC, oc.uploaded_at, oc.id LIMIT 500`, [camp.id, req.user.id, today]),
      DB.query(`SELECT count(*)::int AS n FROM offer_customers WHERE campaign_id = $1 AND assigned_agent_id = $2 AND call_status IN ('not_called','no_answer','busy','call_back') AND contact_date > $3::date`, [camp.id, req.user.id, today]),
      DB.query(`SELECT count(*)::int AS calls, count(*) FILTER (WHERE call_status = ANY($4))::int AS reached
                  FROM offer_events WHERE campaign_id = $1 AND user_id = $2 AND kind = 'call' AND (created_at AT TIME ZONE 'Asia/Kuwait')::date = $3::date`, [camp.id, req.user.id, today, REACHED_STATUSES]),
    ]);
    res.json({ rows, later: later[0]?.n ?? 0, today: done[0] || { calls: 0, reached: 0 } });
  }));

  app.get(`${B}/lookup`, authenticateJWT, CALL, asyncHandler(async (req, res) => {
    const key = DB.dncKey(String(req.query.phone || ""));
    if (!key) return res.status(400).json({ error: "Type the customer's phone number (at least 8 digits)." });
    const rows = await DB.query(`
      SELECT oc.id, oc.campaign_id, c.name AS campaign_name, c.steps, oc.phone, oc.customer_name, oc.call_status, oc.offer_started_at, oc.offer_expires_at,
             u.full_name AS agent_name, (SELECT count(*)::int FROM offer_orders o WHERE o.customer_id = oc.id) AS orders
        FROM offer_customers oc JOIN offer_campaigns c ON c.id = oc.campaign_id LEFT JOIN users u ON u.id = oc.assigned_agent_id
       WHERE oc.phone_key = $1 ORDER BY oc.uploaded_at DESC`, [key]);
    res.json({ key, dnc: (await DB.getDnc(key)) || null, rows: rows.map((r: any) => ({ ...r, eligibility: eligibility(r, r.steps, r.orders) })) });
  }));

  app.get(`${B}/customers/:id`, authenticateJWT, CALL, asyncHandler(async (req, res) => {
    const data = await loadCustomer(req.params.id);
    if (!data) return res.status(404).json({ error: "Customer not found." });
    res.json(data);
  }));

  // Record a call (outbound first call / follow-up, or the customer calling us).
  app.post(`${B}/customers/:id/call`, authenticateJWT, CALL, asyncHandler(async (req, res) => {
    const data = await loadCustomer(req.params.id);
    if (!data) return res.status(404).json({ error: "Customer not found." });
    const { customer: c, campaign: camp } = data;
    const b = req.body || {};
    const status = String(b.call_status || "");
    if (!CALL_STATUSES.includes(status) || status === "not_called") return res.status(400).json({ error: "Pick the result of the call." });
    const direction = b.direction === "inbound" ? "inbound" : "outbound";
    if (direction === "outbound" && data.dnc) return res.status(409).json({ error: "This customer is on the Do Not Call list — do not call them." });
    const churn = typeof b.churn_reason === "string" && b.churn_reason.trim() ? b.churn_reason.trim().slice(0, 120) : null;
    const comment = typeof b.comment === "string" && b.comment.trim() ? b.comment.trim().slice(0, 2000) : null;
    const today = kwToday();
    const contactDate = status === "call_back" && isDay(b.call_back_date) && b.call_back_date >= today ? b.call_back_date : today;
    const startsOffer = OFFER_STARTS.includes(status);
    const updated = (await DB.query(`
      UPDATE offer_customers SET
        call_status = $2,
        attempts = attempts + CASE WHEN $3 = 'outbound' THEN 1 ELSE 0 END,
        first_call_at = COALESCE(first_call_at, CASE WHEN $3 = 'outbound' THEN now() END),
        first_call_agent_id = COALESCE(first_call_agent_id, CASE WHEN $3 = 'outbound' THEN $4 END),
        last_call_at = now(), contact_date = $5::date,
        churn_reason = COALESCE($6, churn_reason), comment = COALESCE($7, comment),
        offer_started_at = CASE WHEN offer_started_at IS NULL AND $8 THEN now() ELSE offer_started_at END,
        offer_expires_at = CASE WHEN offer_started_at IS NULL AND $8 THEN now() + ($9 || ' days')::interval ELSE offer_expires_at END
      WHERE id = $1 RETURNING *`, [c.id, status, direction, req.user.id, contactDate, churn, comment, startsOffer, String(camp.validity_days)]))[0];
    await addEvent({ customerId: c.id, campaignId: c.campaign_id, kind: "call", user: req.user, direction, call_status: status, prev_status: c.call_status, churn_reason: churn, comment,
      details: { ...(status === "call_back" ? { call_back_date: contactDate } : {}), ...(startsOffer && !c.offer_started_at ? { offer_started: true, expires: kwDay(new Date(updated.offer_expires_at).getTime()) } : {}) } });
    req.auditExtra = { details: `${c.customer_name || ""} ${c.phone} — ${direction} call${churn ? `, reason: ${churn}` : ""}${comment ? `, note: ${comment.slice(0, 80)}` : ""}`.trim(), previous_value: c.call_status, new_value: status };
    res.json(await loadCustomer(c.id));
  }));

  // Log an order that used the offer: the next discount, inside the validity window.
  app.post(`${B}/customers/:id/orders`, authenticateJWT, CALL, asyncHandler(async (req, res) => {
    const data = await loadCustomer(req.params.id);
    if (!data) return res.status(404).json({ error: "Customer not found." });
    const { customer: c, campaign: camp, eligibility: el } = data;
    const b = req.body || {};
    const orderNumber = String(b.order_number || "").trim().slice(0, 40);
    const orderDate = String(b.order_date || "");
    const today = kwToday();
    if (!orderNumber) return res.status(400).json({ error: "Type the order number." });
    if (!isDay(orderDate) || orderDate > today) return res.status(400).json({ error: "Pick the order date (today or earlier)." });
    const value = b.order_value === undefined || b.order_value === "" || b.order_value === null ? null : Number(b.order_value);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100000)) return res.status(400).json({ error: "The order value looks wrong." });
    if (el.state === "completed" || !el.next) return res.status(409).json({ error: `All ${el.total} discounts were already used.` });
    if (el.state === "expired") return res.status(409).json({ error: `The offer expired on ${el.expires} — the discount can't be applied.` });
    if (el.starts && orderDate < el.starts) return res.status(409).json({ error: `The offer started on ${el.starts}; this order is older.` });
    const dup = (await DB.query(`SELECT 1 FROM offer_orders WHERE campaign_id = $1 AND lower(order_number) = lower($2)`, [camp.id, orderNumber]))[0];
    if (dup) return res.status(409).json({ error: `Order ${orderNumber} was already logged in this campaign.` });
    const step = el.next.step, discount = el.next.discount;
    try {
      await DB.query(`INSERT INTO offer_orders (id, customer_id, campaign_id, step, discount, order_number, order_date, order_value, logged_by, logged_by_name)
                      VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10)`, [newId("ofo"), c.id, camp.id, step, discount, orderNumber, orderDate, value, req.user.id, req.user.full_name]);
    } catch (e: any) {
      if (String(e?.code) === "23505") return res.status(409).json({ error: "Someone logged this discount for the customer a moment ago — refresh." });
      throw e;
    }
    const comment = typeof b.comment === "string" && b.comment.trim() ? b.comment.trim().slice(0, 2000) : null;
    await DB.query(`
      UPDATE offer_customers SET call_status = 'ordered', comment = COALESCE($3, comment),
        offer_started_at = COALESCE(offer_started_at, now()),
        offer_expires_at = COALESCE(offer_expires_at, now() + ($2 || ' days')::interval)
      WHERE id = $1`, [c.id, String(camp.validity_days), comment]);
    await addEvent({ customerId: c.id, campaignId: camp.id, kind: "order", user: req.user, call_status: "ordered", prev_status: c.call_status, comment,
      details: { step, discount, order_number: orderNumber, order_date: orderDate, order_value: value, ...(!c.offer_started_at ? { offer_started: true } : {}) } });
    req.auditExtra = { details: `${c.customer_name || ""} ${c.phone} — order ${orderNumber} on ${orderDate} with ${discount}% (discount ${step} of ${el.total})${value !== null ? `, value ${value}` : ""}`.trim(), new_value: `${discount}%` };
    res.json(await loadCustomer(c.id));
  }));

  // Take back a wrongly logged order (leaders) — only the latest one, so the steps stay in order.
  app.post(`${B}/orders/:id/remove`, authenticateJWT, MANAGE, asyncHandler(async (req, res) => {
    const o = (await DB.query(`SELECT * FROM offer_orders WHERE id = $1`, [req.params.id]))[0];
    if (!o) return res.status(404).json({ error: "Order not found." });
    const last = (await DB.query(`SELECT max(step)::int AS s FROM offer_orders WHERE customer_id = $1`, [o.customer_id]))[0]?.s;
    if (o.step !== last) return res.status(409).json({ error: "Only the latest discount can be removed — remove the later ones first." });
    const reason = String(req.body?.reason || "").trim().slice(0, 300);
    if (!reason) return res.status(400).json({ error: "Write why this order is being removed." });
    await DB.query(`DELETE FROM offer_orders WHERE id = $1`, [o.id]);
    await addEvent({ customerId: o.customer_id, campaignId: o.campaign_id, kind: "order_removed", user: req.user, comment: reason, details: { step: o.step, discount: o.discount, order_number: o.order_number, order_date: o.order_date, logged_by: o.logged_by_name } });
    req.auditExtra = { details: `Removed order ${o.order_number} (${o.discount}%, logged by ${o.logged_by_name || "?"}) — ${reason}`, previous_value: `${o.discount}%` };
    res.json(await loadCustomer(o.customer_id));
  }));

  // ---- dashboard ----
  app.get(`${B}/:id/dashboard`, authenticateJWT, MANAGE, asyncHandler(async (req, res) => {
    const camp = await getCampaign(req.params.id);
    if (!camp) return res.status(404).json({ error: "Campaign not found." });
    const today = kwToday();
    const to = isDay(req.query.to) ? String(req.query.to) : today;
    const from = isDay(req.query.from) ? String(req.query.from) : to;
    if (from > to) return res.status(400).json({ error: "From is after To." });
    // The daily table shows the period, or the last 14 days when one day is picked (capped at 92 days).
    let wFrom = from === to ? addDays(to, -13) : from;
    if (Date.parse(to) - Date.parse(wFrom) > 91 * 86400_000) wFrom = addDays(to, -91);
    const DAY = (col: string) => `(${col} AT TIME ZONE 'Asia/Kuwait')::date`;
    const [uploads, calls, orders, byAgent, churn, customers] = await Promise.all([
      DB.query(`SELECT to_char(${DAY("uploaded_at")}, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM offer_customers
                 WHERE campaign_id = $1 AND ${DAY("uploaded_at")} BETWEEN $2::date AND $3::date GROUP BY 1`, [camp.id, wFrom, to]),
      DB.query(`SELECT to_char(${DAY("created_at")}, 'YYYY-MM-DD') AS day, count(*)::int AS calls,
                       count(*) FILTER (WHERE direction = 'outbound')::int AS outbound, count(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
                       count(*) FILTER (WHERE call_status = ANY($4))::int AS reached,
                       count(*) FILTER (WHERE call_status IN ('accepted','ordered'))::int AS accepted,
                       count(DISTINCT customer_id) FILTER (WHERE direction = 'outbound' AND prev_status = 'not_called')::int AS first_calls
                  FROM offer_events WHERE campaign_id = $1 AND kind = 'call' AND ${DAY("created_at")} BETWEEN $2::date AND $3::date GROUP BY 1`, [camp.id, wFrom, to, REACHED_STATUSES]),
      DB.query(`SELECT to_char(order_date, 'YYYY-MM-DD') AS day, step, count(*)::int AS n, COALESCE(sum(order_value), 0)::float AS value
                  FROM offer_orders WHERE campaign_id = $1 AND order_date BETWEEN $2::date AND $3::date GROUP BY 1, 2`, [camp.id, wFrom, to]),
      DB.query(`
        WITH c AS (SELECT user_id, user_name, count(*)::int AS calls, count(*) FILTER (WHERE call_status = ANY($4))::int AS reached,
                          count(*) FILTER (WHERE call_status IN ('accepted','ordered'))::int AS accepted
                     FROM offer_events WHERE campaign_id = $1 AND kind = 'call' AND ${DAY("created_at")} BETWEEN $2::date AND $3::date GROUP BY 1, 2),
             o AS (SELECT logged_by AS user_id, logged_by_name AS user_name, count(*)::int AS orders FROM offer_orders
                     WHERE campaign_id = $1 AND order_date BETWEEN $2::date AND $3::date GROUP BY 1, 2),
             a AS (SELECT assigned_agent_id AS user_id, count(*) FILTER (WHERE call_status IN ('not_called','no_answer','busy','call_back'))::int AS open
                     FROM offer_customers WHERE campaign_id = $1 AND assigned_agent_id IS NOT NULL GROUP BY 1)
        SELECT COALESCE(c.user_id, o.user_id, a.user_id) AS user_id, COALESCE(c.user_name, o.user_name, u.full_name) AS name,
               COALESCE(c.calls, 0) AS calls, COALESCE(c.reached, 0) AS reached, COALESCE(c.accepted, 0) AS accepted, COALESCE(o.orders, 0) AS orders, COALESCE(a.open, 0) AS open
          FROM c FULL JOIN o ON o.user_id = c.user_id FULL JOIN a ON a.user_id = COALESCE(c.user_id, o.user_id)
          LEFT JOIN users u ON u.id = COALESCE(c.user_id, o.user_id, a.user_id)
         ORDER BY calls DESC, orders DESC, name`, [camp.id, from, to, REACHED_STATUSES]),
      DB.query(`SELECT churn_reason AS reason, count(*)::int AS n FROM offer_events
                 WHERE campaign_id = $1 AND kind = 'call' AND churn_reason IS NOT NULL AND ${DAY("created_at")} BETWEEN $2::date AND $3::date
                 GROUP BY 1 ORDER BY 2 DESC`, [camp.id, from, to]),
      DB.query(`SELECT oc.call_status, oc.assigned_agent_id IS NOT NULL AS assigned, oc.offer_started_at, oc.offer_expires_at,
                       (SELECT count(*)::int FROM offer_orders o WHERE o.customer_id = oc.id) AS orders
                  FROM offer_customers oc WHERE oc.campaign_id = $1`, [camp.id]),
    ]);
    const days: any[] = [];
    for (let day = wFrom; day <= to; day = addDays(day, 1)) {
      const c = calls.find((r: any) => r.day === day) || {};
      const row: any = { day, uploaded: uploads.find((r: any) => r.day === day)?.n || 0, calls: c.calls || 0, outbound: c.outbound || 0, inbound: c.inbound || 0,
        first_calls: c.first_calls || 0, reached: c.reached || 0, accepted: c.accepted || 0, value: 0 };
      camp.steps.forEach((_s: number, i: number) => { const o = orders.find((r: any) => r.day === day && r.step === i + 1); row[`o${i + 1}`] = o?.n || 0; row.value += o?.value || 0; });
      days.push(row);
    }
    const now = Date.now();
    const totals = { customers: customers.length, unassigned: 0, open: 0, reached: 0, offer_active: 0, expiring_3d: 0, expired_unused: 0, completed: 0, redeemed: 0 };
    for (const c of customers) {
      const el = eligibility(c, camp.steps, c.orders, now);
      if (!c.assigned && c.call_status === "not_called") totals.unassigned++;
      if (OPEN_STATUSES.includes(c.call_status)) totals.open++;
      if (REACHED_STATUSES.includes(c.call_status)) totals.reached++;
      if (el.state === "active") { totals.offer_active++; if ((el.daysLeft ?? 99) <= 3) totals.expiring_3d++; }
      if (el.state === "expired" && c.orders === 0) totals.expired_unused++;
      if (el.state === "completed") totals.completed++;
      if (c.orders > 0) totals.redeemed++;
    }
    res.json({ campaign: { id: camp.id, name: camp.name, steps: camp.steps, validity_days: camp.validity_days }, range: { from, to }, window: { from: wFrom, to }, days, agents: byAgent, churn, totals });
  }));
}
