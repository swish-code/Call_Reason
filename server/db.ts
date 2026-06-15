import pkg from "pg";
import bcrypt from "bcryptjs";
import { User, Interaction, Brand, Category, AuditLog } from "../src/types.js";

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
  { id: "u-admin", full_name: "Ahmed Kamal (System Admin)", name: "Ahmed Kamal (System Admin)", username: "admin", email: "admin@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "admin", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
  { id: "u-leader", full_name: "Sarah Mahmoud (Team Leader)", name: "Sarah Mahmoud (Team Leader)", username: "leader", email: "leader@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "leader", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
  { id: "u-agent1", full_name: "Mohamed Ali (Support Agent)", name: "Mohamed Ali (Support Agent)", username: "agent1", email: "agent1@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "agent", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
  { id: "u-agent2", full_name: "Mariam Hassan (Support Agent)", name: "Mariam Hassan (Support Agent)", username: "agent2", email: "agent2@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "agent", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
  { id: "u-agent3", full_name: "Omar Khaled (Support Agent)", name: "Omar Khaled (Support Agent)", username: "agent3", email: "agent3@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "agent", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
];

const SEED_BRANDS: Brand[] = [
  { id: "b1", brand_name: "Talabat" },
  { id: "b2", brand_name: "Noon" },
  { id: "b3", brand_name: "Amazon" },
  { id: "b4", brand_name: "Carrefour" },
];

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
  { id: "int-1", interaction_date: getDateRelative(0), interaction_time: "09:15", agent_id: "u-agent1", agent_name: "Mohamed Ali (Support Agent)", customer_name: "Yasser Farag", customer_phone: "+201011223344", interaction_type: "SR", communication_type: "Call", call_direction: "Inbound", brand: "Talabat", category: "Order Issue", priority: "High", status: "Resolved", summary: "Customer is complaining that order #4432 has not arrived and is delayed by more than an hour, despite the money being deducted from the electronic account.", action_taken: "Called driver and updated delivery location. Delivered order successfully and provided a compensatory voucher worth 50 EGP.", follow_up_required: false, created_at: new Date().toISOString() },
  { id: "int-2", interaction_date: getDateRelative(0), interaction_time: "10:30", agent_id: "u-agent2", agent_name: "Mariam Hassan (Support Agent)", customer_name: "Rana Ahmed", customer_phone: "+201288776655", interaction_type: "Complaint", communication_type: "Call", call_direction: "Inbound", brand: "Amazon", category: "Refund", priority: "Critical", status: "Pending", summary: "Customer complained about receiving a damaged product (broken phone screen), requesting an immediate refund.", action_taken: "Created refund request #RET-990 and updated shipment status to replacement. Awaiting courier pickup of damaged item tomorrow.", follow_up_required: true, follow_up_date: getDateRelative(1), follow_up_notes: "Follow up with courier to ensure pickup of the damaged item and issue cash refund to customer.", created_at: new Date().toISOString() },
  { id: "int-3", interaction_date: getDateRelative(-1), interaction_time: "14:10", agent_id: "u-agent1", agent_name: "Mohamed Ali (Support Agent)", customer_name: "Khaled Saeed", customer_phone: "+201144556677", interaction_type: "Inquiry", communication_type: "Call", call_direction: "Inbound", brand: "Noon", category: "Account Issue", priority: "Low", status: "Closed", summary: "Customer asked about how to activate the e-wallet and use their refunded Noon balance.", action_taken: "Explained double-verification setup steps to fully activate the wallet and verified balance appeared successfully.", follow_up_required: false, created_at: new Date(new Date().setDate(new Date().getDate() - 1)).toISOString() },
  { id: "int-4", interaction_date: getDateRelative(-2), interaction_time: "11:00", agent_id: "u-agent2", agent_name: "Mariam Hassan (Support Agent)", customer_name: "Hany Youssef", customer_phone: "+201555432101", interaction_type: "Escalation", communication_type: "Call", call_direction: "Outbound", brand: "Carrefour", category: "Delivery Delay", priority: "High", status: "Open", summary: "Customer requested escalation for delayed groceries order since morning and wants supermarket to call them immediately.", action_taken: "Assigned order to delivery team leader and escalated ticket to regional team.", follow_up_required: true, follow_up_date: getDateRelative(1), follow_up_notes: "Call customer to confirm courier arrival.", created_at: new Date(new Date().setDate(new Date().getDate() - 2)).toISOString() },
  { id: "int-5", interaction_date: getDateRelative(-3), interaction_time: "16:45", agent_id: "u-agent3", agent_name: "Omar Khaled (Support Agent)", customer_name: "Dina Ali", customer_phone: "+201099887766", interaction_type: "SR", communication_type: "Task", call_direction: "Inbound", brand: "Amazon", category: "Technical Issue", priority: "Medium", status: "Resolved", summary: "Customer is facing technical issue with credit card declining during instant shipping payment.", action_taken: "Guided customer to update app, clear cache, and try alternative payment gateway; transaction completed successfully.", follow_up_required: false, created_at: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString() },
  { id: "int-6", interaction_date: getDateRelative(-4), interaction_time: "13:30", agent_id: "u-agent3", agent_name: "Omar Khaled (Support Agent)", customer_name: "Sherif Monir", customer_phone: "+201201928374", interaction_type: "Feedback", communication_type: "Call", call_direction: "Outbound", brand: "Talabat", category: "Other", priority: "Low", status: "Closed", summary: "Welcome call and customer satisfaction survey regarding drivers and speed in Tagamoa.", action_taken: "Customer expressed complete satisfaction, rated 5 stars, and requested more weekend offers.", follow_up_required: false, created_at: new Date(new Date().setDate(new Date().getDate() - 4)).toISOString() },
];

// Columns that may be updated through the API (whitelist guards against
// arbitrary fields in request bodies being written to the table).
const USER_UPDATE_COLS = ["full_name", "name", "username", "email", "password_hash", "role", "status", "created_by"] as const;
const INTERACTION_UPDATE_COLS = ["interaction_date", "interaction_time", "agent_id", "agent_name", "customer_name", "customer_phone", "interaction_type", "communication_type", "call_direction", "brand", "category", "priority", "status", "summary", "action_taken", "follow_up_required", "follow_up_date", "follow_up_notes", "attachments", "created_at"] as const;

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
        action TEXT,
        details TEXT,
        ip_address TEXT
      );
    `);

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
          `INSERT INTO users (id, full_name, name, username, email, password_hash, role, status, created_at, updated_at, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
          [u.id, u.full_name, u.name, u.username, u.email, u.password_hash, u.role, u.status, u.created_at, u.updated_at, u.created_by]
        );
      }
      for (const b of SEED_BRANDS) {
        await client.query("INSERT INTO brands (id, brand_name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [b.id, b.brand_name]);
      }
      for (const c of SEED_CATEGORIES) {
        await client.query("INSERT INTO categories (id, category_name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [c.id, c.category_name]);
      }
      for (const i of SEED_INTERACTIONS) {
        await client.query(
          `INSERT INTO interactions (id, interaction_date, interaction_time, agent_id, agent_name, customer_name, customer_phone, interaction_type, communication_type, call_direction, brand, category, priority, status, summary, action_taken, follow_up_required, follow_up_date, follow_up_notes, attachments, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ON CONFLICT (id) DO NOTHING`,
          [i.id, i.interaction_date, i.interaction_time, i.agent_id, i.agent_name, i.customer_name, i.customer_phone, i.interaction_type, i.communication_type, i.call_direction, i.brand, i.category, i.priority, i.status, i.summary, i.action_taken, i.follow_up_required, i.follow_up_date ?? null, i.follow_up_notes ?? null, JSON.stringify(i.attachments ?? []), i.created_at]
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
      `INSERT INTO users (id, full_name, name, username, email, password_hash, role, status, created_at, updated_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [user.id, user.full_name, user.name ?? user.full_name, user.username, user.email, user.password_hash, user.role, user.status, user.created_at, user.updated_at, user.created_by ?? null]
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
      `INSERT INTO audit_logs (id, timestamp, operator_id, operator_name, action, details, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [newLog.id, newLog.timestamp, newLog.operator_id, newLog.operator_name, newLog.action, newLog.details, newLog.ip_address ?? null]
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

  static async addInteraction(interaction: Omit<Interaction, "id"> & { id?: string }): Promise<Interaction> {
    const id = interaction.id || "int-" + Date.now();
    const { rows } = await pool.query<Interaction>(
      `INSERT INTO interactions (id, interaction_date, interaction_time, agent_id, agent_name, customer_name, customer_phone, interaction_type, communication_type, call_direction, brand, category, priority, status, summary, action_taken, follow_up_required, follow_up_date, follow_up_notes, attachments, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [id, interaction.interaction_date, interaction.interaction_time, interaction.agent_id, interaction.agent_name, interaction.customer_name, interaction.customer_phone, interaction.interaction_type, interaction.communication_type, interaction.call_direction, interaction.brand, interaction.category, interaction.priority, interaction.status, interaction.summary, interaction.action_taken, interaction.follow_up_required, interaction.follow_up_date ?? null, interaction.follow_up_notes ?? null, JSON.stringify(interaction.attachments ?? []), interaction.created_at]
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
