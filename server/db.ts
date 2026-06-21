import pkg from "pg";
import bcrypt from "bcryptjs";
import { User, Interaction, Brand, Category, Branch, AuditLog, DropdownOption, OpsLog } from "../src/types.js";

const { Pool } = pkg;

// ----------------------------------------------------
// Postgres connection pool
// ----------------------------------------------------
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. This app now persists data in PostgreSQL. " +
      "On Railway link the Postgres service (DATABASE_URL=${{Postgres.DATABASE_URL}}); " +
      "for local development point it to a Postgres instance."
  );
}

// Railway's private network does not use SSL. Allow opting into SSL (e.g. when
// connecting through the public proxy URL) via PGSSL=require.
const useSSL = process.env.PGSSL === "require" || /sslmode=require/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});

// Helper to format ISO dates relative to today (used only for seed data)
function getDateRelative(daysOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().split("T")[0];
}

// ----------------------------------------------------
// Seed data (inserted only when tables are empty)
// ----------------------------------------------------
const SEED_USERS: User[] = [
  { id: "u-admin", full_name: "Ahmed Kamal (System Admin)", name: "Ahmed Kamal (System Admin)", username: "admin", email: "admin@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "admin", team: "Team Leader", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
  { id: "u-leader", full_name: "Sarah Mahmoud (Team Leader)", name: "Sarah Mahmoud (Team Leader)", username: "leader", email: "leader@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "leader", team: "Team Leader", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
  { id: "u-agent1", full_name: "Mohamed Ali (Support Agent)", name: "Mohamed Ali (Support Agent)", username: "agent1", email: "agent1@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "agent", team: "Call Center", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
  { id: "u-agent2", full_name: "Mariam Hassan (Support Agent)", name: "Mariam Hassan (Support Agent)", username: "agent2", email: "agent2@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "agent", team: "Complain Team", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
  { id: "u-agent3", full_name: "Omar Khaled (Support Agent)", name: "Omar Khaled (Support Agent)", username: "agent3", email: "agent3@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "agent", team: "Technical Team", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
];

// Company brands and the branches that belong to each (branches are per-brand)
const BRAND_BRANCHES: Record<string, string[]> = {
  "Yelo": ["Adaliya", "Khairan", "Jaber Al Ahmed", "Sabah Al Salem", "Vibes", "Qortuba", "Abdullah Al Salem (Dahiya)", "Fahaheel", "Jleeb Al Shuyoukh", "Egaila", "Salmiya", "Jabriya", "Ishbiliya", "Sabah Al Ahmed", "Ardhiya", "Maidan Hawally", "Yard", "Jahra", "Salwa", "Zahra", "Saad Al Abdullah", "Qurain", "Andalous"],
  "Shakir": ["Rai", "Qurain", "Salmiya", "Kuwait City", "Jahra", "Ardhiya", "Egaila", "Hawally", "Sabah Al Ahmed", "Bayan"],
  "BBT": ["Shamiya", "Hilltop", "West Mishref", "Yard", "Salmiya", "Ardhiya", "Jahra", "Adaliya", "Shuhada", "Mangaf", "Saad Al Abdullah", "Sabah Al Ahmed", "Bayan", "Khairan", "Um Al Hyman"],
  "Slice": ["Mishref", "Kuwait City", "Yard", "Adaliya", "Jabriya", "Ardhiya", "Jahra", "Salmiya"],
  "Pattie": ["Adaliya", "Mishref", "Ardhiya", "Jahra", "Salmiya", "Yard", "Hawally"],
  "Just C": ["Qortuba", "Yard"],
  "Chili": ["Qortuba", "Yard", "Hawally"],
  "Mishmash": ["Ardhiya", "Kaifan", "Mahboula", "Jabriya", "Sabah Al Salem", "Saad Al Abdullah", "Salmiya", "Khaithan", "Mangaf", "West Abdullah Al Mubarak", "Salwa", "Qadsiya", "Qurain", "Khairan"],
  "Table": ["Ardhiya", "Qortuba", "Hawally", "Sabah Al Salem", "Salmiya", "Bneid Al Qar", "Mahboula", "Jahra", "Ahmadi", "Khairan"],
  "FM": ["Yard", "Kuwait City", "Hawally", "Khaithan"],
};

const SEED_BRANDS: Brand[] = Object.keys(BRAND_BRANCHES).map((name, i) => ({ id: `b-${i + 1}`, brand_name: name }));

// Flattened per-brand branches with deterministic ids (idempotent re-seed)
const SEED_BRANCHES: Branch[] = (() => {
  const out: Branch[] = [];
  let i = 0;
  for (const [brand, list] of Object.entries(BRAND_BRANCHES)) {
    for (const bn of list) out.push({ id: `br-${++i}`, branch_name: bn, brand });
  }
  return out;
})();

// Default values for the admin-managed dropdown lists (Configuration page).
// Each list is seeded once (only if it has no rows yet).
const DEFAULT_OPTIONS: Record<string, string[]> = {
  call_type: ["New Order", "Follow Up", "Complaint", "Inquiry", "Additional Request"],
  customer_type: ["Customer", "Aggregator", "Driver"],
  call_from: ["Customer", "Aggregator", "Driver"],
  aggregator: ["Talabat", "Keeta", "Other Aggregators"],
  complaint_reason: ["Late Delivery", "Late Preparation", "Missing Items", "Wrong Order", "Other"],
  fcr: ["Solved", "Not Solved"],
  priority: ["Low", "Medium", "High", "Critical"],
  status: ["Open", "Pending", "Resolved", "Closed"],
  team: ["Complain Team", "Call Center", "Technical Team", "Team Leader"],
  call_direction: ["Inbound", "Outbound"],
  department: ["Call Center", "Technical", "Complaints"],
  cc_activity: ["Survey", "Review", "Follow-up CST", "Handle Customer Issue", "Handle Complaint", "Follow-up Orders", "Open Branch", "Close Branch", "Floor Tasks", "Previous Tasks Follow-up", "Other"],
  tech_activity: ["Delayed Orders Follow-up", "Aggregator Follow-up", "Missing Item Cases", "Wrong Dispatch Cases", "Big Order Confirmation", "Order Assignment", "Aggregator Comments", "Punch Orders", "Open Branch", "Busy Branch", "Close Branch", "Hide Item", "Unhide Item", "Follow-up Groups", "Cancellation Request", "Foodics / POS Issues", "Other"],
  complaint_activity: ["Validation", "Escalation", "Coupon Request", "Email Complaint", "Social Media Complaint", "Agent Inquiry", "Customer Review", "Survey Result", "Follow-up Store", "Other"],
  tl_activity: ["Agent Coaching", "One-to-One Session", "Monthly Meeting", "Floor Task", "Validation Quality Review", "Agent Mistake Review", "Performance Feedback", "Other"],
  cc_status: ["Open", "In Progress", "Completed"],
  complaint_status: ["Solved", "Not Solved", "Waiting Feedback"],
};

const SEED_CATEGORIES: Category[] = [
  { id: "c1", category_name: "Refund" },
  { id: "c2", category_name: "Order Issue" },
  { id: "c3", category_name: "Delivery Delay" },
  { id: "c4", category_name: "Account Issue" },
  { id: "c5", category_name: "Technical Issue" },
  { id: "c6", category_name: "Payment Issue" },
  { id: "c7", category_name: "Complaint" },
  { id: "c8", category_name: "Other" },
];

const SEED_INTERACTIONS: Interaction[] = [
  { id: "int-1", interaction_date: getDateRelative(0), interaction_time: "09:15", agent_id: "u-agent1", agent_name: "Mohamed Ali (Support Agent)", customer_name: "Yasser Farag", customer_phone: "+201011223344", interaction_type: "SR", communication_type: "Call", call_direction: "Inbound", brand: "Talabat", category: "Order Issue", call_reason: "Follow Up", team: "Call Center", priority: "High", status: "Resolved", summary: "Customer is complaining that order #4432 has not arrived and is delayed by more than an hour, despite the money being deducted from the electronic account.", action_taken: "Called driver and updated delivery location. Delivered order successfully and provided a compensatory voucher worth 50 EGP.", follow_up_required: false, created_at: new Date().toISOString() },
  { id: "int-2", interaction_date: getDateRelative(0), interaction_time: "10:30", agent_id: "u-agent2", agent_name: "Mariam Hassan (Support Agent)", customer_name: "Rana Ahmed", customer_phone: "+201288776655", interaction_type: "Complaint", communication_type: "Call", call_direction: "Inbound", brand: "Amazon", category: "Refund", call_reason: "Complaint", branch: "Cairo - Nasr City", team: "Complain Team", priority: "Critical", status: "Pending", summary: "Customer complained about receiving a damaged product (broken phone screen), requesting an immediate refund.", action_taken: "Created refund request #RET-990 and updated shipment status to replacement. Awaiting courier pickup of damaged item tomorrow.", follow_up_required: true, follow_up_date: getDateRelative(1), follow_up_notes: "Follow up with courier to ensure pickup of the damaged item and issue cash refund to customer.", created_at: new Date().toISOString() },
  { id: "int-3", interaction_date: getDateRelative(-1), interaction_time: "14:10", agent_id: "u-agent1", agent_name: "Mohamed Ali (Support Agent)", customer_name: "Khaled Saeed", customer_phone: "+201144556677", interaction_type: "Inquiry", communication_type: "Call", call_direction: "Inbound", brand: "Noon", category: "Account Issue", call_reason: "Inquiry", team: "Call Center", priority: "Low", status: "Closed", summary: "Customer asked about how to activate the e-wallet and use their refunded Noon balance.", action_taken: "Explained double-verification setup steps to fully activate the wallet and verified balance appeared successfully.", follow_up_required: false, created_at: new Date(new Date().setDate(new Date().getDate() - 1)).toISOString() },
  { id: "int-4", interaction_date: getDateRelative(-2), interaction_time: "11:00", agent_id: "u-agent2", agent_name: "Mariam Hassan (Support Agent)", customer_name: "Hany Youssef", customer_phone: "+201555432101", interaction_type: "Escalation", communication_type: "Call", call_direction: "Outbound", brand: "Carrefour", category: "Delivery Delay", call_reason: "Complaint", branch: "Giza - Dokki", team: "Complain Team", priority: "High", status: "Open", summary: "Customer requested escalation for delayed groceries order since morning and wants supermarket to call them immediately.", action_taken: "Assigned order to delivery team leader and escalated ticket to regional team.", follow_up_required: true, follow_up_date: getDateRelative(1), follow_up_notes: "Call customer to confirm courier arrival.", created_at: new Date(new Date().setDate(new Date().getDate() - 2)).toISOString() },
  { id: "int-5", interaction_date: getDateRelative(-3), interaction_time: "16:45", agent_id: "u-agent3", agent_name: "Omar Khaled (Support Agent)", customer_name: "Dina Ali", customer_phone: "+201099887766", interaction_type: "SR", communication_type: "Task", call_direction: "Inbound", brand: "Amazon", category: "Technical Issue", call_reason: "Follow Up", team: "Technical Team", priority: "Medium", status: "Resolved", summary: "Customer is facing technical issue with credit card declining during instant shipping payment.", action_taken: "Guided customer to update app, clear cache, and try alternative payment gateway; transaction completed successfully.", follow_up_required: false, created_at: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString() },
  { id: "int-6", interaction_date: getDateRelative(-4), interaction_time: "13:30", agent_id: "u-agent3", agent_name: "Omar Khaled (Support Agent)", customer_name: "Sherif Monir", customer_phone: "+201201928374", interaction_type: "Feedback", communication_type: "Call", call_direction: "Outbound", brand: "Talabat", category: "Other", call_reason: "Follow Up", team: "Technical Team", priority: "Low", status: "Closed", summary: "Welcome call and customer satisfaction survey regarding drivers and speed in Tagamoa.", action_taken: "Customer expressed complete satisfaction, rated 5 stars, and requested more weekend offers.", follow_up_required: false, created_at: new Date(new Date().setDate(new Date().getDate() - 4)).toISOString() },
];

// Columns that may be updated through the API (whitelist guards against
// arbitrary fields in request bodies being written to the table).
const USER_UPDATE_COLS = ["full_name", "name", "username", "email", "password_hash", "role", "team", "department", "status", "created_by"] as const;
const INTERACTION_UPDATE_COLS = ["interaction_date", "interaction_time", "agent_id", "agent_name", "customer_name", "customer_phone", "interaction_type", "communication_type", "call_direction", "brand", "category", "call_reason", "order_number", "branch", "team", "customer_type", "call_from", "aggregator_name", "comments", "complaint_reason", "fcr", "priority", "status", "summary", "action_taken", "follow_up_required", "follow_up_date", "follow_up_notes", "attachments", "created_at"] as const;

const LOG_COLS = ["log_type", "department", "activity_type", "status", "agent_id", "agent_name", "branch", "brand", "order_number", "aggregator", "customer_name", "complaint_id", "target_agent_name", "notes", "action_taken", "resolution_notes", "action_plan", "follow_up_date", "created_at", "updated_at", "created_by"] as const;
const LOG_UPDATE_COLS = ["department", "activity_type", "status", "branch", "brand", "order_number", "aggregator", "customer_name", "complaint_id", "target_agent_name", "notes", "action_taken", "resolution_notes", "action_plan", "follow_up_date"] as const;

export class DB {
  // ----------------------------------------------------
  // Schema creation + one-time seeding
  // ----------------------------------------------------
  static async init(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        name TEXT,
        username TEXT NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        team TEXT,
        status TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        created_by TEXT
      );
      CREATE TABLE IF NOT EXISTS brands (
        id TEXT PRIMARY KEY,
        brand_name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        category_name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY,
        branch_name TEXT NOT NULL,
        brand TEXT
      );
      CREATE TABLE IF NOT EXISTS interactions (
        id TEXT PRIMARY KEY,
        interaction_date TEXT,
        interaction_time TEXT,
        agent_id TEXT,
        agent_name TEXT,
        customer_name TEXT,
        customer_phone TEXT,
        interaction_type TEXT,
        communication_type TEXT,
        call_direction TEXT,
        brand TEXT,
        category TEXT,
        call_reason TEXT,
        order_number TEXT,
        branch TEXT,
        team TEXT,
        customer_type TEXT,
        call_from TEXT,
        aggregator_name TEXT,
        comments TEXT,
        complaint_reason TEXT,
        fcr TEXT,
        priority TEXT,
        status TEXT,
        summary TEXT,
        action_taken TEXT,
        follow_up_required BOOLEAN DEFAULT false,
        follow_up_date TEXT,
        follow_up_notes TEXT,
        attachments JSONB DEFAULT '[]'::jsonb,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT,
        operator_id TEXT,
        operator_name TEXT,
        operator_role TEXT,
        category TEXT,
        action TEXT,
        details TEXT,
        related_ref TEXT,
        ip_address TEXT
      );
      CREATE TABLE IF NOT EXISTS options (
        id TEXT PRIMARY KEY,
        list_key TEXT NOT NULL,
        label TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        active BOOLEAN DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        log_type TEXT NOT NULL,
        department TEXT,
        activity_type TEXT,
        status TEXT,
        agent_id TEXT,
        agent_name TEXT,
        branch TEXT,
        brand TEXT,
        order_number TEXT,
        aggregator TEXT,
        customer_name TEXT,
        complaint_id TEXT,
        target_agent_name TEXT,
        notes TEXT,
        action_taken TEXT,
        resolution_notes TEXT,
        action_plan TEXT,
        follow_up_date TEXT,
        created_at TEXT,
        updated_at TEXT,
        created_by TEXT
      );
    `);

    // Migrations for databases created before newer features
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS team TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS department TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_value TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS new_value TEXT;
      ALTER TABLE interactions ADD COLUMN IF NOT EXISTS call_reason TEXT;
      ALTER TABLE interactions ADD COLUMN IF NOT EXISTS order_number TEXT;
      ALTER TABLE interactions ADD COLUMN IF NOT EXISTS branch TEXT;
      ALTER TABLE interactions ADD COLUMN IF NOT EXISTS team TEXT;
      ALTER TABLE interactions ADD COLUMN IF NOT EXISTS customer_type TEXT;
      ALTER TABLE interactions ADD COLUMN IF NOT EXISTS call_from TEXT;
      ALTER TABLE interactions ADD COLUMN IF NOT EXISTS aggregator_name TEXT;
      ALTER TABLE interactions ADD COLUMN IF NOT EXISTS comments TEXT;
      ALTER TABLE interactions ADD COLUMN IF NOT EXISTS complaint_reason TEXT;
      ALTER TABLE interactions ADD COLUMN IF NOT EXISTS fcr TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS operator_role TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS category TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS related_ref TEXT;
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS brand TEXT;
    `);

    // Backfill teams for rows created before the feature existed
    await pool.query(
      "UPDATE users SET team = CASE WHEN role IN ('admin','leader') THEN 'Team Leader' ELSE 'Call Center' END WHERE team IS NULL OR team = ''"
    );
    await pool.query(
      "UPDATE interactions i SET team = u.team FROM users u WHERE i.agent_id = u.id AND (i.team IS NULL OR i.team = '')"
    );
    await pool.query("UPDATE interactions SET team = 'Call Center' WHERE team IS NULL OR team = ''");

    // Backfill department from the legacy team value
    await pool.query(`
      UPDATE users SET department = CASE
        WHEN team = 'Complain Team' THEN 'Complaints'
        WHEN team = 'Technical Team' THEN 'Technical'
        WHEN team = 'Call Center' THEN 'Call Center'
        ELSE 'Call Center' END
      WHERE department IS NULL OR department = ''
    `);

    // One-time: install the real company brands + per-brand branches.
    // Runs once (guarded by the presence of any branded branch), and replaces
    // the earlier demo brands/branches on existing databases.
    const branded = await pool.query("SELECT 1 FROM branches WHERE brand IS NOT NULL LIMIT 1");
    if (branded.rowCount === 0) {
      await pool.query("DELETE FROM brands WHERE brand_name IN ('Talabat','Noon','Amazon','Carrefour')");
      await pool.query("DELETE FROM branches WHERE brand IS NULL");
      for (const b of SEED_BRANDS) {
        await pool.query("INSERT INTO brands (id, brand_name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [b.id, b.brand_name]);
      }
      for (const br of SEED_BRANCHES) {
        await pool.query("INSERT INTO branches (id, branch_name, brand) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING", [br.id, br.branch_name, br.brand ?? null]);
      }
    }

    // Seed each dropdown list once (idempotent per list_key, so new lists added
    // in code get seeded on the next boot without touching existing edits)
    for (const [key, labels] of Object.entries(DEFAULT_OPTIONS)) {
      const c = await pool.query<{ count: string }>("SELECT COUNT(*)::int AS count FROM options WHERE list_key = $1", [key]);
      if (Number(c.rows[0].count) === 0) {
        for (let idx = 0; idx < labels.length; idx++) {
          await pool.query(
            "INSERT INTO options (id, list_key, label, sort_order, active) VALUES ($1,$2,$3,$4,true) ON CONFLICT (id) DO NOTHING",
            [`opt-${key}-${idx}`, key, labels[idx], idx]
          );
        }
      }
    }

    const { rows } = await pool.query<{ count: string }>("SELECT COUNT(*)::int AS count FROM users");
    if (Number(rows[0].count) === 0) {
      await DB.seed();
    }
  }

  private static async seed(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const u of SEED_USERS) {
        await client.query(
          `INSERT INTO users (id, full_name, name, username, email, password_hash, role, team, status, created_at, updated_at, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
          [u.id, u.full_name, u.name, u.username, u.email, u.password_hash, u.role, u.team ?? null, u.status, u.created_at, u.updated_at, u.created_by]
        );
      }
      for (const b of SEED_BRANDS) {
        await client.query("INSERT INTO brands (id, brand_name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [b.id, b.brand_name]);
      }
      for (const c of SEED_CATEGORIES) {
        await client.query("INSERT INTO categories (id, category_name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [c.id, c.category_name]);
      }
      for (const b of SEED_BRANCHES) {
        await client.query("INSERT INTO branches (id, branch_name, brand) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING", [b.id, b.branch_name, b.brand ?? null]);
      }
      for (const i of SEED_INTERACTIONS) {
        await client.query(
          `INSERT INTO interactions (id, interaction_date, interaction_time, agent_id, agent_name, customer_name, customer_phone, interaction_type, communication_type, call_direction, brand, category, call_reason, branch, team, priority, status, summary, action_taken, follow_up_required, follow_up_date, follow_up_notes, attachments, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) ON CONFLICT (id) DO NOTHING`,
          [i.id, i.interaction_date, i.interaction_time, i.agent_id, i.agent_name, i.customer_name, i.customer_phone, i.interaction_type, i.communication_type, i.call_direction, i.brand, i.category, i.call_reason ?? null, i.branch ?? null, i.team ?? null, i.priority, i.status, i.summary, i.action_taken, i.follow_up_required, i.follow_up_date ?? null, i.follow_up_notes ?? null, JSON.stringify(i.attachments ?? []), i.created_at]
        );
      }

      await client.query("COMMIT");
      console.log("[CRM DB] Seed data inserted into PostgreSQL.");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // ----------------------------------------------------
  // User methods
  // ----------------------------------------------------
  static async getUsers(): Promise<User[]> {
    const { rows } = await pool.query<User>("SELECT * FROM users ORDER BY created_at ASC");
    return rows;
  }

  static async getUserByEmail(email: string): Promise<User | undefined> {
    const { rows } = await pool.query<User>("SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1", [email]);
    return rows[0];
  }

  static async getUserByUsernameOrEmail(identifier: string): Promise<User | undefined> {
    const { rows } = await pool.query<User>(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1) LIMIT 1",
      [identifier]
    );
    return rows[0];
  }

  static async getUserById(id: string): Promise<User | undefined> {
    const { rows } = await pool.query<User>("SELECT * FROM users WHERE id = $1 LIMIT 1", [id]);
    return rows[0];
  }

  static async addUser(user: User): Promise<User> {
    const { rows } = await pool.query<User>(
      `INSERT INTO users (id, full_name, name, username, email, password_hash, role, team, department, status, created_at, updated_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [user.id, user.full_name, user.name ?? user.full_name, user.username, user.email, user.password_hash, user.role, user.team ?? "Call Center", user.department ?? "Call Center", user.status, user.created_at, user.updated_at, user.created_by ?? null]
    );
    return rows[0];
  }

  static async updateUser(id: string, updatedFields: Partial<User>): Promise<User | undefined> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const col of USER_UPDATE_COLS) {
      if (col in updatedFields && (updatedFields as any)[col] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        values.push((updatedFields as any)[col]);
      }
    }
    // Keep compat name field in sync when full_name changes
    if (updatedFields.full_name && !("name" in updatedFields)) {
      sets.push(`name = $${idx++}`);
      values.push(updatedFields.full_name);
    }
    sets.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());

    values.push(id);
    const { rows } = await pool.query<User>(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0];
  }

  static async deleteUser(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM users WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // ----------------------------------------------------
  // Audit Logs methods
  // ----------------------------------------------------
  static async getAuditLogs(): Promise<AuditLog[]> {
    const { rows } = await pool.query<AuditLog>("SELECT * FROM audit_logs ORDER BY timestamp DESC");
    return rows;
  }

  static async addAuditLog(log: Omit<AuditLog, "id" | "timestamp">): Promise<AuditLog> {
    const newLog: AuditLog = {
      ...log,
      id: "log-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString(),
    };
    await pool.query(
      `INSERT INTO audit_logs (id, timestamp, operator_id, operator_name, operator_role, category, action, details, related_ref, ip_address, department, previous_value, new_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [newLog.id, newLog.timestamp, newLog.operator_id, newLog.operator_name, newLog.operator_role ?? null, newLog.category ?? null, newLog.action, newLog.details, newLog.related_ref ?? null, newLog.ip_address ?? null, (newLog as any).department ?? null, (newLog as any).previous_value ?? null, (newLog as any).new_value ?? null]
    );
    return newLog;
  }

  // ----------------------------------------------------
  // Brand methods
  // ----------------------------------------------------
  static async getBrands(): Promise<Brand[]> {
    const { rows } = await pool.query<Brand>("SELECT * FROM brands ORDER BY brand_name ASC");
    return rows;
  }

  static async addBrand(name: string): Promise<Brand> {
    const newBrand: Brand = { id: "brand-" + Date.now(), brand_name: name };
    await pool.query("INSERT INTO brands (id, brand_name) VALUES ($1,$2)", [newBrand.id, newBrand.brand_name]);
    return newBrand;
  }

  static async deleteBrand(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM brands WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // ----------------------------------------------------
  // Category methods
  // ----------------------------------------------------
  static async getCategories(): Promise<Category[]> {
    const { rows } = await pool.query<Category>("SELECT * FROM categories ORDER BY category_name ASC");
    return rows;
  }

  static async addCategory(name: string): Promise<Category> {
    const newCat: Category = { id: "cat-" + Date.now(), category_name: name };
    await pool.query("INSERT INTO categories (id, category_name) VALUES ($1,$2)", [newCat.id, newCat.category_name]);
    return newCat;
  }

  static async deleteCategory(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM categories WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // ----------------------------------------------------
  // Branch methods (stores/branches shown for Complaint call reasons)
  // ----------------------------------------------------
  static async getBranches(): Promise<Branch[]> {
    const { rows } = await pool.query<Branch>("SELECT * FROM branches ORDER BY branch_name ASC");
    return rows;
  }

  static async addBranch(name: string): Promise<Branch> {
    const newBranch: Branch = { id: "br-" + Date.now(), branch_name: name };
    await pool.query("INSERT INTO branches (id, branch_name) VALUES ($1,$2)", [newBranch.id, newBranch.branch_name]);
    return newBranch;
  }

  static async deleteBranch(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM branches WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // ----------------------------------------------------
  // Dropdown options (Configuration page)
  // ----------------------------------------------------
  static async getAllOptions(): Promise<DropdownOption[]> {
    const { rows } = await pool.query<DropdownOption>("SELECT * FROM options ORDER BY list_key ASC, sort_order ASC, label ASC");
    return rows;
  }

  static async getOptionsByKey(listKey: string, activeOnly = true): Promise<DropdownOption[]> {
    const { rows } = await pool.query<DropdownOption>(
      `SELECT * FROM options WHERE list_key = $1 ${activeOnly ? "AND active = true" : ""} ORDER BY sort_order ASC, label ASC`,
      [listKey]
    );
    return rows;
  }

  static async addOption(listKey: string, label: string): Promise<DropdownOption> {
    const m = await pool.query<{ max: number | null }>("SELECT MAX(sort_order) AS max FROM options WHERE list_key = $1", [listKey]);
    const nextOrder = (m.rows[0].max ?? -1) + 1;
    const id = "opt-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    const { rows } = await pool.query<DropdownOption>(
      "INSERT INTO options (id, list_key, label, sort_order, active) VALUES ($1,$2,$3,$4,true) RETURNING *",
      [id, listKey, label, nextOrder]
    );
    return rows[0];
  }

  static async updateOption(id: string, fields: Partial<Pick<DropdownOption, "label" | "active" | "sort_order">>): Promise<DropdownOption | undefined> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;
    (["label", "active", "sort_order"] as const).forEach((col) => {
      if (col in fields && (fields as any)[col] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        values.push((fields as any)[col]);
      }
    });
    if (sets.length === 0) return undefined;
    values.push(id);
    const { rows } = await pool.query<DropdownOption>(`UPDATE options SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, values);
    return rows[0];
  }

  static async deleteOption(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM options WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  static async reorderOptions(listKey: string, orderedIds: string[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < orderedIds.length; i++) {
        await client.query("UPDATE options SET sort_order = $1 WHERE id = $2 AND list_key = $3", [i, orderedIds[i], listKey]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // ----------------------------------------------------
  // Operations & Logs (Agent / Team Leader logs)
  // ----------------------------------------------------
  static async getLogs(filter: { log_type?: string; department?: string; agent_id?: string } = {}): Promise<OpsLog[]> {
    const clauses: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (filter.log_type) { clauses.push(`log_type = $${idx++}`); values.push(filter.log_type); }
    if (filter.department) { clauses.push(`department = $${idx++}`); values.push(filter.department); }
    if (filter.agent_id) { clauses.push(`agent_id = $${idx++}`); values.push(filter.agent_id); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await pool.query<OpsLog>(`SELECT * FROM logs ${where} ORDER BY created_at DESC`, values);
    return rows;
  }

  static async getLogById(id: string): Promise<OpsLog | undefined> {
    const { rows } = await pool.query<OpsLog>("SELECT * FROM logs WHERE id = $1 LIMIT 1", [id]);
    return rows[0];
  }

  static async addLog(log: Omit<OpsLog, "id"> & { id?: string }): Promise<OpsLog> {
    const id = log.id || "log-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    const cols = ["id", ...LOG_COLS];
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
    const values = [id, ...LOG_COLS.map((c) => (log as any)[c] ?? null)];
    const { rows } = await pool.query<OpsLog>(
      `INSERT INTO logs (${cols.join(",")}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return rows[0];
  }

  static async updateLog(id: string, fields: Partial<OpsLog>): Promise<OpsLog | undefined> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const col of LOG_UPDATE_COLS) {
      if (col in fields && (fields as any)[col] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        values.push((fields as any)[col]);
      }
    }
    sets.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());
    if (sets.length === 1) return DB.getLogById(id); // only updated_at → nothing to change
    values.push(id);
    const { rows } = await pool.query<OpsLog>(`UPDATE logs SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, values);
    return rows[0];
  }

  static async deleteLog(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM logs WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // ----------------------------------------------------
  // Interaction methods
  // ----------------------------------------------------
  static async getInteractions(): Promise<Interaction[]> {
    const { rows } = await pool.query<Interaction>("SELECT * FROM interactions ORDER BY created_at DESC");
    return rows;
  }

  static async getInteractionById(id: string): Promise<Interaction | undefined> {
    const { rows } = await pool.query<Interaction>("SELECT * FROM interactions WHERE id = $1 LIMIT 1", [id]);
    return rows[0];
  }

  // History lookup for the Call Reason screen (by customer phone and/or order number)
  static async getInteractionHistory(opts: { phone?: string; order?: string }): Promise<Interaction[]> {
    const clauses: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (opts.phone) {
      clauses.push(`customer_phone = $${idx++}`);
      values.push(opts.phone);
    }
    if (opts.order) {
      clauses.push(`order_number = $${idx++}`);
      values.push(opts.order);
    }
    if (clauses.length === 0) return [];
    const { rows } = await pool.query<Interaction>(
      `SELECT * FROM interactions WHERE ${clauses.join(" OR ")} ORDER BY created_at DESC LIMIT 50`,
      values
    );
    return rows;
  }

  static async addInteraction(interaction: Omit<Interaction, "id"> & { id?: string }): Promise<Interaction> {
    const id = interaction.id || "int-" + Date.now();
    const { rows } = await pool.query<Interaction>(
      `INSERT INTO interactions (id, interaction_date, interaction_time, agent_id, agent_name, customer_name, customer_phone, interaction_type, communication_type, call_direction, brand, category, call_reason, order_number, branch, team, customer_type, call_from, aggregator_name, comments, complaint_reason, fcr, priority, status, summary, action_taken, follow_up_required, follow_up_date, follow_up_notes, attachments, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31) RETURNING *`,
      [id, interaction.interaction_date, interaction.interaction_time, interaction.agent_id, interaction.agent_name, interaction.customer_name, interaction.customer_phone, interaction.interaction_type, interaction.communication_type, interaction.call_direction, interaction.brand, interaction.category, interaction.call_reason ?? null, interaction.order_number ?? null, interaction.branch ?? null, interaction.team ?? null, interaction.customer_type ?? null, interaction.call_from ?? null, interaction.aggregator_name ?? null, interaction.comments ?? null, interaction.complaint_reason ?? null, interaction.fcr ?? null, interaction.priority, interaction.status, interaction.summary, interaction.action_taken, interaction.follow_up_required, interaction.follow_up_date ?? null, interaction.follow_up_notes ?? null, JSON.stringify(interaction.attachments ?? []), interaction.created_at]
    );
    return rows[0];
  }

  static async updateInteraction(id: string, updatedFields: Partial<Interaction>): Promise<Interaction | undefined> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const col of INTERACTION_UPDATE_COLS) {
      if (col in updatedFields && (updatedFields as any)[col] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        const raw = (updatedFields as any)[col];
        values.push(col === "attachments" ? JSON.stringify(raw ?? []) : raw);
      }
    }

    if (sets.length === 0) {
      return DB.getInteractionById(id);
    }

    values.push(id);
    const { rows } = await pool.query<Interaction>(
      `UPDATE interactions SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0];
  }

  static async deleteInteraction(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM interactions WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }
}
