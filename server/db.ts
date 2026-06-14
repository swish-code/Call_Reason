import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { User, Interaction, Brand, Category, AuditLog } from "../src/types.js"; // Note: we can use relative paths

const DB_FILE_PATH = path.join(process.cwd(), "db.json");

interface LocalDatabase {
  users: User[];
  interactions: Interaction[];
  brands: Brand[];
  categories: Category[];
  audit_logs: AuditLog[];
}

// Helper to format ISO dates relative to today
function getDateRelative(daysOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().split("T")[0];
}

const SEED_USERS: User[] = [
  {
    id: "u-admin",
    full_name: "Ahmed Kamal (System Admin)",
    name: "Ahmed Kamal (System Admin)",
    username: "admin",
    email: "admin@crm.com",
    password_hash: bcrypt.hashSync("password", 10),
    role: "admin",
    status: "Active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "system"
  },
  {
    id: "u-leader",
    full_name: "Sarah Mahmoud (Team Leader)",
    name: "Sarah Mahmoud (Team Leader)",
    username: "leader",
    email: "leader@crm.com",
    password_hash: bcrypt.hashSync("password", 10),
    role: "leader",
    status: "Active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "system"
  },
  {
    id: "u-agent1",
    full_name: "Mohamed Ali (Support Agent)",
    name: "Mohamed Ali (Support Agent)",
    username: "agent1",
    email: "agent1@crm.com",
    password_hash: bcrypt.hashSync("password", 10),
    role: "agent",
    status: "Active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "system"
  },
  {
    id: "u-agent2",
    full_name: "Mariam Hassan (Support Agent)",
    name: "Mariam Hassan (Support Agent)",
    username: "agent2",
    email: "agent2@crm.com",
    password_hash: bcrypt.hashSync("password", 10),
    role: "agent",
    status: "Active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "system"
  },
  {
    id: "u-agent3",
    full_name: "Omar Khaled (Support Agent)",
    name: "Omar Khaled (Support Agent)",
    username: "agent3",
    email: "agent3@crm.com",
    password_hash: bcrypt.hashSync("password", 10),
    role: "agent",
    status: "Active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "system"
  }
];

const SEED_BRANDS: Brand[] = [
  { id: "b1", brand_name: "Talabat" },
  { id: "b2", brand_name: "Noon" },
  { id: "b3", brand_name: "Amazon" },
  { id: "b4", brand_name: "Carrefour" }
];

const SEED_CATEGORIES: Category[] = [
  { id: "c1", category_name: "Refund" },
  { id: "c2", category_name: "Order Issue" },
  { id: "c3", category_name: "Delivery Delay" },
  { id: "c4", category_name: "Account Issue" },
  { id: "c5", category_name: "Technical Issue" },
  { id: "c6", category_name: "Payment Issue" },
  { id: "c7", category_name: "Complaint" },
  { id: "c8", category_name: "Other" }
];

const SEED_INTERACTIONS: Interaction[] = [
  {
    id: "int-1",
    interaction_date: getDateRelative(0), // Today
    interaction_time: "09:15",
    agent_id: "u-agent1",
    agent_name: "Mohamed Ali (Support Agent)",
    customer_name: "Yasser Farag",
    customer_phone: "+201011223344",
    interaction_type: "SR",
    communication_type: "Call",
    call_direction: "Inbound",
    brand: "Talabat",
    category: "Order Issue",
    priority: "High",
    status: "Resolved",
    summary: "Customer is complaining that order #4432 has not arrived and is delayed by more than an hour, despite the money being deducted from the electronic account.",
    action_taken: "Called driver and updated delivery location. Delivered order successfully and provided a compensatory voucher worth 50 EGP.",
    follow_up_required: false,
    created_at: new Date(new Date().setDate(new Date().getDate() - 0)).toISOString()
  },
  {
    id: "int-2",
    interaction_date: getDateRelative(0), // Today
    interaction_time: "10:30",
    agent_id: "u-agent2",
    agent_name: "Mariam Hassan (Support Agent)",
    customer_name: "Rana Ahmed",
    customer_phone: "+201288776655",
    interaction_type: "Complaint",
    communication_type: "Call",
    call_direction: "Inbound",
    brand: "Amazon",
    category: "Refund",
    priority: "Critical",
    status: "Pending",
    summary: "Customer complained about receiving a damaged product (broken phone screen), requesting an immediate refund.",
    action_taken: "Created refund request #RET-990 and updated shipment status to replacement. Awaiting courier pickup of damaged item tomorrow.",
    follow_up_required: true,
    follow_up_date: getDateRelative(1),
    follow_up_notes: "Follow up with courier to ensure pickup of the damaged item and issue cash refund to customer.",
    created_at: new Date(new Date().setDate(new Date().getDate() - 0)).toISOString()
  },
  {
    id: "int-3",
    interaction_date: getDateRelative(-1), // Yesterday
    interaction_time: "14:10",
    agent_id: "u-agent1",
    agent_name: "Mohamed Ali (Support Agent)",
    customer_name: "Khaled Saeed",
    customer_phone: "+201144556677",
    interaction_type: "Inquiry",
    communication_type: "Call",
    call_direction: "Inbound",
    brand: "Noon",
    category: "Account Issue",
    priority: "Low",
    status: "Closed",
    summary: "Customer asked about how to activate the e-wallet and use their refunded Noon balance.",
    action_taken: "Explained double-verification setup steps to fully activate the wallet and verified balance appeared successfully.",
    follow_up_required: false,
    created_at: new Date(new Date().setDate(new Date().getDate() - 1)).toISOString()
  },
  {
    id: "int-4",
    interaction_date: getDateRelative(-2),
    interaction_time: "11:00",
    agent_id: "u-agent2",
    agent_name: "Mariam Hassan (Support Agent)",
    customer_name: "Hany Youssef",
    customer_phone: "+201555432101",
    interaction_type: "Escalation",
    communication_type: "Call",
    call_direction: "Outbound",
    brand: "Carrefour",
    category: "Delivery Delay",
    priority: "High",
    status: "Open",
    summary: "Customer requested escalation for delayed groceries order since morning and wants supermarket to call them immediately.",
    action_taken: "Assigned order to delivery team leader and escalated ticket to regional team.",
    follow_up_required: true,
    follow_up_date: getDateRelative(1),
    follow_up_notes: "Call customer to confirm courier arrival.",
    created_at: new Date(new Date().setDate(new Date().getDate() - 2)).toISOString()
  },
  {
    id: "int-5",
    interaction_date: getDateRelative(-3),
    interaction_time: "16:45",
    agent_id: "u-agent3",
    agent_name: "Omar Khaled (Support Agent)",
    customer_name: "Dina Ali",
    customer_phone: "+201099887766",
    interaction_type: "SR",
    communication_type: "Task",
    call_direction: "Inbound",
    brand: "Amazon",
    category: "Technical Issue",
    priority: "Medium",
    status: "Resolved",
    summary: "Customer is facing technical issue with credit card declining during instant shipping payment.",
    action_taken: "Guided customer to update app, clear cache, and try alternative payment gateway; transaction completed successfully.",
    follow_up_required: false,
    created_at: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString()
  },
  {
    id: "int-6",
    interaction_date: getDateRelative(-4),
    interaction_time: "13:30",
    agent_id: "u-agent3",
    agent_name: "Omar Khaled (Support Agent)",
    customer_name: "Sherif Monir",
    customer_phone: "+201201928374",
    interaction_type: "Feedback",
    communication_type: "Call",
    call_direction: "Outbound",
    brand: "Talabat",
    category: "Other",
    priority: "Low",
    status: "Closed",
    summary: "Welcome call and customer satisfaction survey regarding drivers and speed in Tagamoa.",
    action_taken: "Customer expressed complete satisfaction, rated 5 stars, and requested more weekend offers.",
    follow_up_required: false,
    created_at: new Date(new Date().setDate(new Date().getDate() - 4)).toISOString()
  }
];

export class DB {
  private static load(): LocalDatabase {
    if (!fs.existsSync(DB_FILE_PATH)) {
      const db: LocalDatabase = {
        users: SEED_USERS,
        interactions: SEED_INTERACTIONS,
        brands: SEED_BRANDS,
        categories: SEED_CATEGORIES,
        audit_logs: [],
      };
      fs.writeFileSync(DB_FILE_PATH, JSON.stringify(db, null, 2), "utf-8");
      return db;
    }
    try {
      const data = fs.readFileSync(DB_FILE_PATH, "utf-8");
      const parsed = JSON.parse(data);
      if (!parsed.audit_logs) {
        parsed.audit_logs = [];
      }
      return parsed;
    } catch (e) {
      console.error("Error reading db file, regenerating seed data", e);
      const db: LocalDatabase = {
        users: SEED_USERS,
        interactions: SEED_INTERACTIONS,
        brands: SEED_BRANDS,
        categories: SEED_CATEGORIES,
        audit_logs: [],
      };
      fs.writeFileSync(DB_FILE_PATH, JSON.stringify(db, null, 2), "utf-8");
      return db;
    }
  }

  private static save(db: LocalDatabase) {
    try {
      fs.writeFileSync(DB_FILE_PATH, JSON.stringify(db, null, 2), "utf-8");
    } catch (e) {
      console.error("Error writing to db file", e);
    }
  }

  // User methods
  static getUsers(): User[] {
    return this.load().users;
  }

  static getUserByEmail(email: string): User | undefined {
    return this.load().users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  }

  static getUserByUsernameOrEmail(identifier: string): User | undefined {
    const lower = identifier.toLowerCase();
    return this.load().users.find(
      (u) => u.email.toLowerCase() === lower || u.username.toLowerCase() === lower
    );
  }

  static getUserById(id: string): User | undefined {
    return this.load().users.find((u) => u.id === id);
  }

  static addUser(user: User): User {
    const db = this.load();
    db.users.push(user);
    this.save(db);
    return user;
  }

  static updateUser(id: string, updatedFields: Partial<User>): User | undefined {
    const db = this.load();
    const idx = db.users.findIndex((u) => u.id === id);
    if (idx !== -1) {
      db.users[idx] = {
        ...db.users[idx],
        ...updatedFields,
        updated_at: new Date().toISOString(),
        // Keep compat name field sync if full_name is updated:
        name: updatedFields.full_name || db.users[idx].full_name,
      };
      this.save(db);
      return db.users[idx];
    }
    return undefined;
  }

  static deleteUser(id: string): boolean {
    const db = this.load();
    const idx = db.users.findIndex((u) => u.id === id);
    if (idx !== -1) {
      db.users.splice(idx, 1);
      this.save(db);
      return true;
    }
    return false;
  }

  // Audit Logs methods
  static getAuditLogs(): AuditLog[] {
    return this.load().audit_logs || [];
  }

  static addAuditLog(log: Omit<AuditLog, "id" | "timestamp">): AuditLog {
    const db = this.load();
    if (!db.audit_logs) {
      db.audit_logs = [];
    }
    const newLog: AuditLog = {
      ...log,
      id: "log-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString(),
    };
    db.audit_logs.unshift(newLog); // Newest first
    this.save(db);
    return newLog;
  }

  // Brand methods
  static getBrands(): Brand[] {
    return this.load().brands;
  }

  static addBrand(name: string): Brand {
    const db = this.load();
    const newBrand: Brand = {
      id: "brand-" + Date.now(),
      brand_name: name,
    };
    db.brands.push(newBrand);
    this.save(db);
    return newBrand;
  }

  static deleteBrand(id: string): boolean {
    const db = this.load();
    const index = db.brands.findIndex((b) => b.id === id);
    if (index !== -1) {
      db.brands.splice(index, 1);
      this.save(db);
      return true;
    }
    return false;
  }

  // Category methods
  static getCategories(): Category[] {
    return this.load().categories;
  }

  static addCategory(name: string): Category {
    const db = this.load();
    const newCat: Category = {
      id: "cat-" + Date.now(),
      category_name: name,
    };
    db.categories.push(newCat);
    this.save(db);
    return newCat;
  }

  static deleteCategory(id: string): boolean {
    const db = this.load();
    const index = db.categories.findIndex((c) => c.id === id);
    if (index !== -1) {
      db.categories.splice(index, 1);
      this.save(db);
      return true;
    }
    return false;
  }

  // Interaction methods
  static getInteractions(): Interaction[] {
    return this.load().interactions;
  }

  static getInteractionById(id: string): Interaction | undefined {
    return this.load().interactions.find((item) => item.id === id);
  }

  static addInteraction(interaction: Omit<Interaction, "id"> & { id?: string }): Interaction {
    const db = this.load();
    const newInteraction: Interaction = {
      ...interaction,
      id: interaction.id || "int-" + Date.now(),
    };
    db.interactions.unshift(newInteraction); // Newest first
    this.save(db);
    return newInteraction;
  }

  static updateInteraction(id: string, updatedFields: Partial<Interaction>): Interaction | undefined {
    const db = this.load();
    const idx = db.interactions.findIndex((itm) => itm.id === id);
    if (idx !== -1) {
      db.interactions[idx] = {
        ...db.interactions[idx],
        ...updatedFields,
      };
      this.save(db);
      return db.interactions[idx];
    }
    return undefined;
  }

  static deleteInteraction(id: string): boolean {
    const db = this.load();
    const index = db.interactions.findIndex((itm) => itm.id === id);
    if (index !== -1) {
      db.interactions.splice(index, 1);
      this.save(db);
      return true;
    }
    return false;
  }
}
