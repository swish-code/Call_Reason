import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { DB } from "./server/db.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Increase request size limit for base64 file uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ----------------------------------------------------
// Authentication & JWT Security Support
// ----------------------------------------------------
const JWT_SECRET = process.env.JWT_SECRET || "crm-system-super-secret-key-2026";

const authenticateJWT = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(" ")[1];
    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
      if (err) {
        return res.status(403).json({ error: "Work session is expired or invalid. Please log in again." });
      }
      req.user = decoded;
      next();
    });
  } else {
    res.status(401).json({ error: "Valid access credentials are required to view this page." });
  }
};

// Role Access Control Middlewares
const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ error: "Sorry, this action requires System Administrator (Admin) privileges." });
  }
};

const requireLeaderOrAdmin = (req: any, res: any, next: any) => {
  if (req.user && (req.user.role === "admin" || req.user.role === "leader")) {
    next();
  } else {
    res.status(403).json({ error: "Sorry, this action is restricted to Team Leaders or Admins." });
  }
};

// Any manager (Team Leader, Supervisor, or Admin) — i.e. not an agent
const requireManager = (req: any, res: any, next: any) => {
  if (req.user && req.user.role !== "agent") {
    next();
  } else {
    res.status(403).json({ error: "Sorry, this action is restricted to Team Leaders, Supervisors, or Admins." });
  }
};

// Wrap async route handlers so rejected promises become 500s instead of
// crashing the process with an unhandled rejection.
const asyncHandler = (fn: (req: any, res: any) => Promise<any>) => (req: any, res: any) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error("[CRM Server] Unhandled route error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error. Please try again." });
    }
  });
};

// ----------------------------------------------------
// Authentication API
// ----------------------------------------------------
app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body; // Represents either email or username input
  if (!email || !password) {
    return res.status(400).json({ error: "Please enter your email/username and password." });
  }

  const user = await DB.getUserByUsernameOrEmail(email);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials. Please try again." });
  }

  if (user.status === "Inactive") {
    return res.status(403).json({ error: "This account has been deactivated by the system administrator. Please contact management." });
  }

  const isPasswordMatch = bcrypt.compareSync(password, user.password_hash);
  if (!isPasswordMatch) {
    return res.status(401).json({ error: "Invalid credentials. Please try again." });
  }

  // Generate JWT token containing key user properties
  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      team: user.team,
      department: user.department,
      full_name: user.full_name
    },
    JWT_SECRET,
    { expiresIn: "24h" }
  );

  // Success login log
  await DB.addAuditLog({
    operator_id: user.id,
    operator_name: user.full_name,
    operator_role: user.role,
    category: user.team || "Call Center",
    action: "User Login",
    details: `User ${user.username} successfully logged in`
  });

  const userData = {
    id: user.id,
    full_name: user.full_name,
    name: user.full_name, // fallback helper
    username: user.username,
    email: user.email,
    role: user.role,
    team: user.team,
    department: user.department,
    status: user.status,
    token
  };

  res.json(userData);
}));

// ----------------------------------------------------
// Users Management API (Requires Admin)
// ----------------------------------------------------
app.get("/api/users", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  // Team leaders and admins can inspect users (e.g. view team)
  const users = (await DB.getUsers()).map(({ password_hash, ...u }) => u);
  res.json(users);
}));

app.post("/api/users", authenticateJWT, requireAdmin, asyncHandler(async (req, res) => {
  const { full_name, username, password, role, status, team, department } = req.body;

  if (!full_name || !username || !password || !role || !status) {
    return res.status(400).json({ error: "Please fill in all required fields to create the account." });
  }

  // Email is optional now — derive a stable internal address from the username
  const email = (req.body.email && String(req.body.email).trim()) ? String(req.body.email).trim() : `${username}@local`;

  // Conflict validation
  const existingEmail = await DB.getUserByEmail(email);
  const existingUsername = (await DB.getUsers()).find(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );

  if (existingEmail) {
    return res.status(400).json({ error: "The entered email is already in use by another account." });
  }
  if (existingUsername) {
    return res.status(400).json({ error: "This username is already taken by another account." });
  }

  const saltRounds = 10;
  const password_hash = bcrypt.hashSync(password, saltRounds);
  const nowString = new Date().toISOString();

  const newUser = await DB.addUser({
    id: "user-" + Date.now(),
    full_name,
    name: full_name,
    username,
    email,
    password_hash,
    role,
    team,
    department: department || "Call Center",
    status,
    created_at: nowString,
    updated_at: nowString,
    created_by: req.user.id
  });

  // Safe logging
  await DB.addAuditLog({
    operator_id: req.user.id,
    operator_name: req.user.full_name,
    operator_role: req.user.role,
    category: "Team Leader",
    action: "Create User",
    details: `A new user account was created: ${username} (${role})`
  });

  const { password_hash: _, ...safeUser } = newUser;
  res.status(201).json(safeUser);
}));

app.put("/api/users/:id", authenticateJWT, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { full_name, username, email, role, status, password, team, department } = req.body;

  const targetUser = await DB.getUserById(id);
  if (!targetUser) {
    return res.status(404).json({ error: "The user requested for update does not exist in the system." });
  }

  // Match conflicts
  if (email && email !== targetUser.email) {
    if (await DB.getUserByEmail(email)) {
      return res.status(400).json({ error: "The new email is already in use by another account." });
    }
  }
  if (username && username !== targetUser.username) {
    const conflicts = (await DB.getUsers()).find(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    );
    if (conflicts) {
      return res.status(400).json({ error: "The new username is already taken by another account." });
    }
  }

  const updates: any = {
    full_name: full_name || targetUser.full_name,
    name: full_name || targetUser.full_name,
    username: username || targetUser.username,
    email: email || targetUser.email,
    role: role || targetUser.role,
    team: team || targetUser.team,
    department: department || targetUser.department,
    status: status || targetUser.status,
  };

  if (password && password.trim() !== "") {
    updates.password_hash = bcrypt.hashSync(password, 10);
  }

  const updatedUser = await DB.updateUser(id, updates);

  // Safe logging
  await DB.addAuditLog({
    operator_id: req.user.id,
    operator_name: req.user.full_name,
    operator_role: req.user.role,
    category: "Team Leader",
    action: "Edit User",
    details: `User data updated: ${updates.username} (status: ${updates.status})`
  });

  const { password_hash: _, ...safeUser } = updatedUser!;
  res.json(safeUser);
}));

app.delete("/api/users/:id", authenticateJWT, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (id === req.user.id) {
    return res.status(400).json({ error: "You cannot delete your own logged-in account." });
  }

  const targetUser = await DB.getUserById(id);
  if (!targetUser) {
    return res.status(404).json({ error: "User not found for deletion." });
  }

  await DB.deleteUser(id);

  // Safe logging
  await DB.addAuditLog({
    operator_id: req.user.id,
    operator_name: req.user.full_name,
    operator_role: req.user.role,
    category: "Team Leader",
    action: "Delete User",
    details: `User account permanently deleted: ${targetUser.username}`
  });

  res.json({ message: "User account deleted successfully." });
}));

app.put("/api/users/:id/reset-password", authenticateJWT, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.trim() === "") {
    return res.status(400).json({ error: "New password is required." });
  }

  const targetUser = await DB.getUserById(id);
  if (!targetUser) {
    return res.status(404).json({ error: "User not found for password reset." });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  await DB.updateUser(id, { password_hash });

  // Safe logging
  await DB.addAuditLog({
    operator_id: req.user.id,
    operator_name: req.user.full_name,
    operator_role: req.user.role,
    category: "Team Leader",
    action: "Password Reset",
    details: `A new password was successfully reset for user: ${targetUser.username}`
  });

  res.json({ message: "Password reset successfully." });
}));

// Audit Logs list API
app.get("/api/audit-logs", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  res.json(await DB.getAuditLogs());
}));

// ----------------------------------------------------
// Brands API (Protected)
// ----------------------------------------------------
app.get("/api/brands", authenticateJWT, asyncHandler(async (req, res) => {
  res.json(await DB.getBrands());
}));

app.post("/api/brands", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Brand name is required" });
  }
  const brand = await DB.addBrand(name.trim());
  res.status(201).json(brand);
}));

app.delete("/api/brands/:id", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const success = await DB.deleteBrand(req.params.id);
  if (success) {
    res.json({ message: "Brand deleted successfully" });
  } else {
    res.status(404).json({ error: "Brand not found" });
  }
}));

// ----------------------------------------------------
// Categories API (Protected)
// ----------------------------------------------------
app.get("/api/categories", authenticateJWT, asyncHandler(async (req, res) => {
  res.json(await DB.getCategories());
}));

app.post("/api/categories", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Category name is required" });
  }
  const category = await DB.addCategory(name.trim());
  res.status(201).json(category);
}));

app.delete("/api/categories/:id", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const success = await DB.deleteCategory(req.params.id);
  if (success) {
    res.json({ message: "Category deleted successfully" });
  } else {
    res.status(404).json({ error: "Category not found" });
  }
}));

// ----------------------------------------------------
// Branches API (stores shown for Complaint call reasons)
// ----------------------------------------------------
app.get("/api/branches", authenticateJWT, asyncHandler(async (req, res) => {
  res.json(await DB.getBranches());
}));

app.post("/api/branches", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Branch name is required" });
  }
  const branch = await DB.addBranch(name.trim());
  res.status(201).json(branch);
}));

app.delete("/api/branches/:id", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const success = await DB.deleteBranch(req.params.id);
  if (success) {
    res.json({ message: "Branch deleted successfully" });
  } else {
    res.status(404).json({ error: "Branch not found" });
  }
}));

// ----------------------------------------------------
// Dropdown Options API (Configuration page)
// ----------------------------------------------------
// Full list (incl. inactive) for the Configuration screen
app.get("/api/options", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  res.json(await DB.getAllOptions());
}));

// Reorder a list — defined before "/:id" routes (POST, distinct path)
app.post("/api/options/reorder", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const { list_key, ids } = req.body;
  if (!list_key || !Array.isArray(ids)) {
    return res.status(400).json({ error: "list_key and ids[] are required." });
  }
  await DB.reorderOptions(list_key, ids);
  res.json({ message: "Reordered successfully" });
}));

// Active options for one list — used by the forms (any authenticated user)
app.get("/api/options/:key", authenticateJWT, asyncHandler(async (req, res) => {
  res.json(await DB.getOptionsByKey(req.params.key, true));
}));

app.post("/api/options", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const { list_key, label } = req.body;
  if (!list_key || !label || !label.trim()) {
    return res.status(400).json({ error: "list_key and a non-empty label are required." });
  }
  const option = await DB.addOption(list_key, label.trim());
  res.status(201).json(option);
}));

app.put("/api/options/:id", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const { label, active, sort_order } = req.body;
  const updated = await DB.updateOption(req.params.id, {
    ...(label !== undefined ? { label: String(label).trim() } : {}),
    ...(active !== undefined ? { active: !!active } : {}),
    ...(sort_order !== undefined ? { sort_order } : {}),
  });
  if (!updated) return res.status(404).json({ error: "Option not found or no changes provided." });
  res.json(updated);
}));

app.delete("/api/options/:id", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const success = await DB.deleteOption(req.params.id);
  if (success) {
    res.json({ message: "Option deleted successfully" });
  } else {
    res.status(404).json({ error: "Option not found" });
  }
}));

// ----------------------------------------------------
// Operations & Logs API (Agent / Team Leader, department-scoped)
// ----------------------------------------------------
const DEPT_TO_LOGTYPE: Record<string, string> = {
  "Call Center": "call_center",
  "Technical": "technical",
  "Complaints": "complaint",
};
const LOG_FIELDS = ["department", "activity_type", "status", "branch", "brand", "order_number", "aggregator", "customer_name", "complaint_id", "target_agent_name", "notes", "action_taken", "resolution_notes", "action_plan", "follow_up_date"];

// ----------------------------------------------------
// Recurring tasks — date helpers & lazy daily generation (Kuwait time, UTC+3)
// ----------------------------------------------------
const KW_OFFSET_MS = 3 * 3600 * 1000;
function kuwaitToday(): { date: string; weekday: number } {
  const kw = new Date(Date.now() + KW_OFFSET_MS);
  const date = kw.toISOString().slice(0, 10); // YYYY-MM-DD in Kuwait local
  const weekday = new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun..6=Sat
  return { date, weekday };
}
function templateFiresOn(tpl: any, weekday: number): boolean {
  if (!tpl.active) return false;
  if (tpl.recurrence_type === "daily") return true;
  const days = String(tpl.days_of_week || "").split(",").map((d: string) => Number(d.trim())).filter((n: number) => !isNaN(n));
  return days.includes(weekday); // covers "weekly" (single day) & "weekdays" (multiple)
}

// Ensure today's instances exist for active templates (optionally a single department).
// Idempotent via the unique (template_id, task_date) index.
async function ensureTodayInstances(department?: string): Promise<void> {
  const { date, weekday } = kuwaitToday();
  const templates = await DB.getRecurringTemplates(department ? { department } : {});
  for (const tpl of templates) {
    if (!templateFiresOn(tpl, weekday)) continue;
    if (await DB.recurringInstanceExists(tpl.id, date)) continue;
    const due_date = tpl.due_time ? `${date}T${tpl.due_time}` : `${date}T23:59`;
    let assigned_to: string | null = null;
    let assigned_to_name: string | null = null;
    let status = "Available";
    if (tpl.assign_mode === "auto") {
      const onShift = await DB.getOnShiftAgents(tpl.department);
      if (onShift.length) {
        const counts = await DB.getOpenTaskCounts(tpl.department);
        onShift.sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0));
        assigned_to = onShift[0].id; assigned_to_name = onShift[0].full_name; status = "New";
      } // else: no one on shift → falls back to the pool
    }
    await DB.addRecurringInstance({
      id: "rtask-" + tpl.id.slice(-6) + "-" + date,
      title: tpl.title, description: tpl.description || undefined,
      assigned_by: tpl.created_by || "system", assigned_by_name: tpl.created_by_name || "Recurring",
      assigned_to, assigned_to_name, department: tpl.department,
      priority: tpl.priority || "Medium", due_date, status,
      template_id: tpl.id, task_date: date, created_at: new Date().toISOString(),
    } as any);
  }
}

// List logs (scoped by role/department)
app.get("/api/logs", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const { role, id, department } = req.user;
  const typeFilter = (req.query.type as string) || undefined;
  let logs;
  if (role === "admin") {
    logs = await DB.getLogs({ log_type: typeFilter, department: (req.query.department as string) || undefined });
  } else if (role === "leader" || role === "supervisor") {
    logs = await DB.getLogs({ department, log_type: typeFilter });
  } else {
    logs = await DB.getLogs({ agent_id: id, log_type: typeFilter });
  }
  res.json(logs);
}));

// Role-aware dashboard metrics (computed from the scoped logs)
app.get("/api/logs/dashboard", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const { role, id, department } = req.user;
  let logs;
  if (role === "admin") logs = await DB.getLogs({});
  else if (role === "leader" || role === "supervisor") logs = await DB.getLogs({ department });
  else logs = await DB.getLogs({ agent_id: id });

  // Optional date-range filter (YYYY-MM-DD, inclusive)
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  if (from) logs = logs.filter((l) => (l.created_at || "").slice(0, 10) >= from);
  if (to) logs = logs.filter((l) => (l.created_at || "").slice(0, 10) <= to);

  const OPEN = ["Open"];
  const PENDING = ["In Progress", "Waiting Feedback", "Not Solved"];
  const DONE = ["Completed", "Solved"];
  const inSet = (s: string | undefined, set: string[]) => !!s && set.includes(s);

  const now = Date.now();
  const since = (days: number) => now - days * 24 * 60 * 60 * 1000;
  const ts = (l: any) => new Date(l.created_at).getTime();

  const group = (keyFn: (l: any) => string | undefined) => {
    const m: Record<string, number> = {};
    logs.forEach((l) => { const k = keyFn(l); if (k) m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map((name) => ({ name, count: m[name] })).sort((a, b) => b.count - a.count);
  };

  // 7-day trend
  const trendMap: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) trendMap[new Date(now - i * 864e5).toISOString().split("T")[0]] = 0;
  logs.forEach((l) => { const d = (l.created_at || "").split("T")[0]; if (trendMap[d] !== undefined) trendMap[d]++; });
  const trend = Object.keys(trendMap).map((d) => ({ date: d, count: trendMap[d] }));

  const complaintLogs = logs.filter((l) => l.log_type === "complaint");
  const solved = complaintLogs.filter((l) => l.status === "Solved").length;
  const notSolved = complaintLogs.filter((l) => l.status === "Not Solved").length;
  const complaintResolutionRate = solved + notSolved ? Math.round((solved / (solved + notSolved)) * 100) : 0;

  const technicalLogs = logs.filter((l) => l.log_type === "technical");
  const technicalStatus = (() => {
    const m: Record<string, number> = {};
    technicalLogs.forEach((l) => { const k = l.status || "—"; m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map((name) => ({ name, count: m[name] }));
  })();

  // Handling time metrics (from the logged time spent)
  const dur = (l: any) => Number(l.duration_seconds || 0);
  const timed = logs.filter((l) => dur(l) > 0);
  const totalHandlingSeconds = timed.reduce((a, l) => a + dur(l), 0);
  const avgHandlingSeconds = timed.length ? Math.round(totalHandlingSeconds / timed.length) : 0;

  // Productivity windows — COMPLETED tasks only (open / in-progress don't count
  // toward performance until the agent completes them)
  const todayStr = new Date(now).toISOString().split("T")[0];
  const todayLogs = logs.filter((l) => (l.created_at || "").split("T")[0] === todayStr && inSet(l.status, DONE));
  const weekLogs = logs.filter((l) => ts(l) >= since(7) && inSet(l.status, DONE));
  const todayTasks = todayLogs.length;
  const weekTasks = weekLogs.length;
  const todaySeconds = todayLogs.reduce((a, l) => a + dur(l), 0);
  const weekSeconds = weekLogs.reduce((a, l) => a + dur(l), 0);

  // Per-agent shift hours (today / this week) from logged shift sessions
  let shiftByAgent: { name: string; today: number; week: number }[] = [];
  if (role !== "agent") {
    const sessions = role === "admin" ? await DB.getShiftSessions({}) : await DB.getShiftSessions({ department });
    const kwTodayStr = kuwaitToday().date;
    const kwDate = (iso: string) => new Date(new Date(iso).getTime() + KW_OFFSET_MS).toISOString().slice(0, 10);
    const eff = (s: any) => {
      const start = new Date(s.started_at).getTime();
      const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
      return Math.max(0, Math.round((end - start) / 1000));
    };
    const map: Record<string, { name: string; today: number; week: number }> = {};
    sessions.forEach((s: any) => {
      if (!s.started_at) return;
      const name = s.user_name || "—";
      if (!map[name]) map[name] = { name, today: 0, week: 0 };
      const e = eff(s);
      if (kwDate(s.started_at) === kwTodayStr) map[name].today += e;
      if (new Date(s.started_at).getTime() >= since(7)) map[name].week += e;
    });
    shiftByAgent = Object.values(map).sort((a, b) => b.week - a.week);
  }

  res.json({
    shiftByAgent,
    role,
    department: department || null,
    totalLogs: logs.length,
    totalHandlingSeconds,
    avgHandlingSeconds,
    todayTasks,
    weekTasks,
    todaySeconds,
    weekSeconds,
    open: logs.filter((l) => inSet(l.status, OPEN)).length,
    pending: logs.filter((l) => inSet(l.status, PENDING)).length,
    completed: logs.filter((l) => inSet(l.status, DONE)).length,
    daily: logs.filter((l) => ts(l) >= since(1)).length,
    weekly: logs.filter((l) => ts(l) >= since(7)).length,
    monthly: logs.filter((l) => ts(l) >= since(30)).length,
    byActivity: group((l) => l.activity_type).slice(0, 12),
    byDepartment: group((l) => l.department),
    agentProductivity: group((l) => l.agent_name).slice(0, 15),
    complaintResolutionRate,
    technicalStatus,
    coachingSessions: logs.filter((l) => l.log_type === "team_leader").length,
    trend,
  });
}));

// History / audit trail (Team Leaders + Admin)
app.get("/api/logs/history", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req: any, res: any) => {
  let logs = await DB.getAuditLogs();
  if (req.user.role === "leader") {
    logs = logs.filter((l) => !l.department || l.department === req.user.department);
  }
  res.json(logs);
}));

app.post("/api/logs", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const { role, id, full_name, department } = req.user;
  const body = req.body;
  if (role === "supervisor") return res.status(403).json({ error: "Supervisors have view & export access only." });
  if (!body.activity_type) return res.status(400).json({ error: "Activity type is required." });
  if (["Completed", "Solved"].includes(body.status) && Number(body.duration_seconds) <= 0) {
    return res.status(400).json({ error: "Time spent is required to complete a task." });
  }

  let log_type: string, dept: string, agent_id: string, agent_name: string;
  if (role === "agent") {
    log_type = DEPT_TO_LOGTYPE[department];
    if (!log_type) return res.status(400).json({ error: "Your account is not assigned to a valid department." });
    dept = department; agent_id = id; agent_name = full_name;
  } else if (role === "leader") {
    log_type = "team_leader"; dept = department || "Call Center"; agent_id = id; agent_name = full_name;
  } else {
    log_type = body.log_type || "call_center";
    dept = body.department || department || "Call Center";
    agent_id = body.agent_id || id; agent_name = body.agent_name || full_name;
  }

  const now = new Date().toISOString();
  const newLog = await DB.addLog({
    log_type: log_type as any, department: dept, activity_type: body.activity_type, status: body.status,
    agent_id, agent_name,
    branch: body.branch, brand: body.brand, order_number: body.order_number, aggregator: body.aggregator,
    customer_name: body.customer_name, complaint_id: body.complaint_id, target_agent_name: body.target_agent_name,
    notes: body.notes, action_taken: body.action_taken, resolution_notes: body.resolution_notes,
    action_plan: body.action_plan, follow_up_date: body.follow_up_date,
    duration_seconds: Number(body.duration_seconds) > 0 ? Math.round(Number(body.duration_seconds)) : 0,
    created_at: now, updated_at: now, created_by: id,
  });

  await DB.addAuditLog({
    operator_id: id, operator_name: full_name, operator_role: role, category: dept, department: dept,
    action: "Create Log", related_ref: newLog.id,
    details: `${log_type} · ${body.activity_type}${body.branch ? " · " + body.branch : ""}`,
    new_value: JSON.stringify({ activity_type: body.activity_type, status: body.status ?? null }),
  });
  res.status(201).json(newLog);
}));

app.put("/api/logs/:id", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const log = await DB.getLogById(req.params.id);
  if (!log) return res.status(404).json({ error: "Log not found." });
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only an administrator can edit logs." });
  }

  // Diff changed fields for the audit trail
  const prev: any = {}, next: any = {};
  for (const f of LOG_FIELDS) {
    if (f in req.body && req.body[f] !== (log as any)[f]) { prev[f] = (log as any)[f] ?? null; next[f] = req.body[f]; }
  }
  const updated = await DB.updateLog(req.params.id, req.body);

  await DB.addAuditLog({
    operator_id: req.user.id, operator_name: req.user.full_name, operator_role: req.user.role,
    category: log.department, department: log.department, action: "Edit Log", related_ref: log.id,
    details: `${log.log_type} · ${log.activity_type}`,
    previous_value: JSON.stringify(prev), new_value: JSON.stringify(next),
  });
  res.json(updated);
}));

app.delete("/api/logs/:id", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const log = await DB.getLogById(req.params.id);
  if (!log) return res.status(404).json({ error: "Log not found." });
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only an administrator can delete logs." });
  }
  await DB.deleteLog(req.params.id);
  await DB.addAuditLog({
    operator_id: req.user.id, operator_name: req.user.full_name, operator_role: req.user.role,
    category: log.department, department: log.department, action: "Delete Log", related_ref: log.id,
    details: `${log.log_type} · ${log.activity_type}`, previous_value: JSON.stringify({ activity_type: log.activity_type, status: log.status }),
  });
  res.json({ message: "Log deleted successfully" });
}));

// Owner progress update — change status + time spent on an Open/In Progress task
app.put("/api/logs/:id/progress", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const log = await DB.getLogById(req.params.id);
  if (!log) return res.status(404).json({ error: "Log not found." });
  const isOwner = log.agent_id === req.user.id;
  if (req.user.role !== "admin" && !isOwner) {
    return res.status(403).json({ error: "You can only update your own tasks." });
  }
  if (req.user.role !== "admin" && !["Open", "In Progress"].includes(log.status || "")) {
    return res.status(403).json({ error: "This task is already closed and can no longer be updated." });
  }
  const fields: any = {};
  if (req.body.status !== undefined) fields.status = req.body.status;
  if (req.body.duration_seconds !== undefined) fields.duration_seconds = Math.max(0, Math.round(Number(req.body.duration_seconds) || 0));
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: "Nothing to update." });

  const finalStatus = fields.status ?? log.status;
  const finalDuration = fields.duration_seconds ?? log.duration_seconds ?? 0;
  if (["Completed", "Solved"].includes(finalStatus || "") && Number(finalDuration) <= 0) {
    return res.status(400).json({ error: "Time spent is required to complete a task." });
  }

  const updated = await DB.updateLog(req.params.id, fields);
  await DB.addAuditLog({
    operator_id: req.user.id, operator_name: req.user.full_name, operator_role: req.user.role,
    category: log.department, department: log.department, action: "Update Task Progress", related_ref: log.id,
    details: `${log.log_type} · ${log.activity_type}`,
    previous_value: JSON.stringify({ status: log.status, duration_seconds: log.duration_seconds ?? 0 }),
    new_value: JSON.stringify(fields),
  });
  res.json(updated);
}));

// Task timer — start / pause / complete (accumulates active handling time)
app.post("/api/logs/:id/timer", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const log = await DB.getLogById(req.params.id);
  if (!log) return res.status(404).json({ error: "Log not found." });
  if (req.user.role !== "admin" && log.agent_id !== req.user.id) {
    return res.status(403).json({ error: "You can only time your own tasks." });
  }
  const action = req.body.action;
  if (!["start", "pause", "complete"].includes(action)) {
    return res.status(400).json({ error: "action must be start, pause or complete." });
  }
  const completeStatus = log.log_type === "complaint" ? "Solved" : "Completed";
  const updated = await DB.controlTimer(req.params.id, action, completeStatus);
  await DB.addAuditLog({
    operator_id: req.user.id, operator_name: req.user.full_name, operator_role: req.user.role,
    category: log.department, department: log.department, action: `Timer ${action}`, related_ref: log.id,
    details: `${log.log_type} · ${log.activity_type}`,
    new_value: JSON.stringify({ duration_seconds: (updated as any)?.duration_seconds ?? 0 }),
  });
  res.json(updated);
}));

// ----------------------------------------------------
// Assigned Tasks API (manager assigns to agent)
// ----------------------------------------------------
// Create & assign — any non-agent (leader/supervisor/admin)
app.post("/api/tasks", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.role === "agent") return res.status(403).json({ error: "Agents cannot assign tasks." });
  const { title, description, assigned_to, due_date, priority } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Task title is required." });
  if (!assigned_to) return res.status(400).json({ error: "Please choose an agent to assign the task to." });

  const target = await DB.getUserById(assigned_to);
  if (!target || target.role !== "agent") return res.status(400).json({ error: "Selected user is not a valid agent." });
  if (req.user.role !== "admin" && target.department !== req.user.department) {
    return res.status(403).json({ error: "You can only assign tasks to agents in your own department." });
  }

  const now = new Date().toISOString();
  const task = await DB.addAssignedTask({
    id: "task-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
    title: title.trim(),
    description: description || undefined,
    assigned_by: req.user.id,
    assigned_by_name: req.user.full_name,
    assigned_to: target.id,
    assigned_to_name: target.full_name,
    department: target.department,
    priority: priority || "Medium",
    due_date: due_date || undefined,
    status: "New",
    created_at: now,
  });
  await DB.addAuditLog({
    operator_id: req.user.id, operator_name: req.user.full_name, operator_role: req.user.role,
    category: target.department, department: target.department, action: "Assign Task", related_ref: task.id,
    details: `${title.trim()} → ${target.full_name}`,
  });
  res.status(201).json(task);
}));

// List tasks (scoped)
app.get("/api/tasks", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const { role, id, department } = req.user;
  // Make sure today's recurring instances exist before listing
  await ensureTodayInstances(role === "admin" ? undefined : department);
  let tasks;
  if (role === "admin") tasks = await DB.getAssignedTasks({});
  else if (role === "agent") tasks = await DB.getAssignedTasks({ assigned_to: id });
  else tasks = await DB.getAssignedTasks({ department });
  res.json(tasks);
}));

// ---- Pool: available (unclaimed) recurring tasks for on-shift agents ----
app.get("/api/tasks/pool", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const { role, department } = req.user;
  if (role !== "agent") {
    // Managers can view their department's pool (admin: all)
    if (role === "admin") {
      let all: any[] = [];
      for (const d of ["Call Center", "Technical", "Complaints"]) { await ensureTodayInstances(d); all = all.concat(await DB.getPoolTasks(d)); }
      return res.json(all);
    }
    await ensureTodayInstances(department);
    return res.json(await DB.getPoolTasks(department));
  }
  await ensureTodayInstances(department);
  res.json(await DB.getPoolTasks(department));
}));

// ---- Claim a pool task (agent must be on shift) ----
app.post("/api/tasks/:id/claim", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== "agent") return res.status(403).json({ error: "Only agents can claim tasks." });
  const me = await DB.getUserById(req.user.id);
  if (!me || me.shift_status !== "on") return res.status(400).json({ error: "You must be On Shift to claim tasks." });
  const task = await DB.getAssignedTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found." });
  if (task.department !== me.department) return res.status(403).json({ error: "This task is not for your department." });
  const claimed = await DB.claimTask(req.params.id, me.id, me.full_name);
  if (!claimed) return res.status(409).json({ error: "This task was already claimed by someone else." });
  res.json(claimed);
}));

// Notification badge — agent's unseen tasks
app.get("/api/tasks/unseen-count", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== "agent") return res.json({ count: 0 });
  res.json({ count: await DB.countUnseenTasks(req.user.id) });
}));

// Mark all of the agent's tasks as seen
app.post("/api/tasks/mark-seen", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.role === "agent") await DB.markTasksSeen(req.user.id);
  res.json({ message: "ok" });
}));

// Agents a manager can assign to (own department; admin = all)
app.get("/api/tasks/agents", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.role === "agent") return res.status(403).json({ error: "Forbidden" });
  let agents = (await DB.getUsers()).filter((u) => u.role === "agent" && u.status !== "Inactive");
  if (req.user.role !== "admin") agents = agents.filter((u) => u.department === req.user.department);
  res.json(agents.map((u) => ({ id: u.id, full_name: u.full_name, department: u.department })));
}));

// Update a task (agent owner updates status; manager/admin can update)
app.put("/api/tasks/:id", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const task = await DB.getAssignedTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found." });
  const { role, id, department } = req.user;
  const isOwnerAgent = role === "agent" && task.assigned_to === id;
  const isManager = role === "admin" || (role !== "agent" && task.department === department);
  if (!isOwnerAgent && !isManager) return res.status(403).json({ error: "Not authorized to update this task." });

  const fields: any = {};

  if (isOwnerAgent) {
    // Agent: progress the task (status / time / note). Only the agent completes.
    if (req.body.status !== undefined) fields.status = req.body.status;
    if (req.body.duration_seconds !== undefined) fields.duration_seconds = Math.max(0, Math.round(Number(req.body.duration_seconds) || 0));
    if (req.body.note !== undefined) fields.note = req.body.note;
  } else if (isManager) {
    // Manager: edit details + reassign (NOT complete)
    ["title", "description", "priority", "due_date"].forEach((k) => { if (req.body[k] !== undefined) fields[k] = req.body[k]; });
    if (req.body.assigned_to !== undefined && req.body.assigned_to !== task.assigned_to) {
      const target = await DB.getUserById(req.body.assigned_to);
      if (!target || target.role !== "agent") return res.status(400).json({ error: "Selected user is not a valid agent." });
      if (role !== "admin" && target.department !== department) return res.status(403).json({ error: "You can only reassign within your department." });
      fields.assigned_to = target.id; fields.assigned_to_name = target.full_name; fields.department = target.department; fields.seen = false;
    }
  }

  // Completing a task requires the time spent (can't be edited afterwards)
  const finalDuration = fields.duration_seconds ?? task.duration_seconds ?? 0;
  if (fields.status === "Completed" && Number(finalDuration) <= 0) {
    return res.status(400).json({ error: "Time spent is required to complete the task." });
  }
  const newlyCompleted = fields.status === "Completed" && task.status !== "Completed";
  if (newlyCompleted && !task.completed_at) fields.completed_at = new Date().toISOString();
  const updated = await DB.updateAssignedTask(req.params.id, fields);

  // On completion, record a Log for the assigned agent (shows in My Logs + Dashboard)
  if (newlyCompleted) {
    const logType = DEPT_TO_LOGTYPE[task.department || ""] || "call_center";
    const now = new Date().toISOString();
    const note = fields.note ?? task.note;
    await DB.addLog({
      log_type: logType as any, department: task.department, activity_type: task.title,
      status: logType === "complaint" ? "Solved" : "Completed",
      agent_id: task.assigned_to, agent_name: task.assigned_to_name,
      notes: `[Assigned task] ${task.title}${task.description ? " — " + task.description : ""}${note ? " | Note: " + note : ""}`,
      duration_seconds: Number(finalDuration), created_at: now, updated_at: now, created_by: id,
    });
  }

  await DB.addAuditLog({
    operator_id: id, operator_name: req.user.full_name, operator_role: role,
    category: task.department, department: task.department, action: "Update Task", related_ref: task.id,
    details: task.title, previous_value: JSON.stringify({ status: task.status }), new_value: JSON.stringify(fields),
  });
  res.json(updated);
}));

// Delete a task (assigner or admin)
app.delete("/api/tasks/:id", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const task = await DB.getAssignedTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found." });
  if (req.user.role !== "admin" && task.assigned_by !== req.user.id) {
    return res.status(403).json({ error: "Only the assigner or an admin can delete this task." });
  }
  await DB.deleteAssignedTask(req.params.id);
  res.json({ message: "Task deleted." });
}));

// ----------------------------------------------------
// Recurring task templates (managers; department-scoped)
// ----------------------------------------------------
app.get("/api/recurring", authenticateJWT, requireManager, asyncHandler(async (req: any, res: any) => {
  const tpls = req.user.role === "admin" ? await DB.getRecurringTemplates({}) : await DB.getRecurringTemplates({ department: req.user.department });
  res.json(tpls);
}));

app.post("/api/recurring", authenticateJWT, requireManager, asyncHandler(async (req: any, res: any) => {
  const { title, description, priority, recurrence_type, days_of_week, due_time, assign_mode } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Task is required." });
  let department = req.user.department;
  if (req.user.role === "admin" && req.body.department) department = req.body.department;
  if (!department) return res.status(400).json({ error: "Department is required." });
  if ((recurrence_type === "weekly" || recurrence_type === "weekdays") && !String(days_of_week || "").trim()) {
    return res.status(400).json({ error: "Please choose at least one day of the week." });
  }
  const tpl = await DB.addRecurringTemplate({
    id: "tpl-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
    title: title.trim(), description: description || undefined, department,
    priority: priority || "Medium", recurrence_type: recurrence_type || "daily",
    days_of_week: days_of_week || null, due_time: due_time || null,
    assign_mode: assign_mode === "auto" ? "auto" : "pool", active: true,
    created_by: req.user.id, created_by_name: req.user.full_name, created_at: new Date().toISOString(),
  });
  await DB.addAuditLog({
    operator_id: req.user.id, operator_name: req.user.full_name, operator_role: req.user.role,
    category: department, department, action: "Create Recurring Task", related_ref: tpl.id, details: title.trim(),
  });
  res.status(201).json(tpl);
}));

app.put("/api/recurring/:id", authenticateJWT, requireManager, asyncHandler(async (req: any, res: any) => {
  const tpl = await DB.getRecurringTemplateById(req.params.id);
  if (!tpl) return res.status(404).json({ error: "Template not found." });
  if (req.user.role !== "admin" && tpl.department !== req.user.department) return res.status(403).json({ error: "Not authorized." });
  const fields: any = {};
  ["title", "description", "priority", "recurrence_type", "days_of_week", "due_time", "assign_mode", "active"].forEach((k) => { if (req.body[k] !== undefined) fields[k] = req.body[k]; });
  if (req.user.role === "admin" && req.body.department !== undefined) fields.department = req.body.department;
  const updated = await DB.updateRecurringTemplate(req.params.id, fields);
  res.json(updated);
}));

app.delete("/api/recurring/:id", authenticateJWT, requireManager, asyncHandler(async (req: any, res: any) => {
  const tpl = await DB.getRecurringTemplateById(req.params.id);
  if (!tpl) return res.status(404).json({ error: "Template not found." });
  if (req.user.role !== "admin" && tpl.department !== req.user.department) return res.status(403).json({ error: "Not authorized." });
  await DB.deleteRecurringTemplate(req.params.id);
  res.json({ message: "Template deleted." });
}));

// ----------------------------------------------------
// Shift presence (On Shift / Out of Shift) + sessions for reports
// ----------------------------------------------------
app.get("/api/shift/status", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const me = await DB.getUserById(req.user.id);
  res.json({ status: me?.shift_status || "off", since: (me as any)?.shift_started_at || null });
}));

app.post("/api/shift/start", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== "agent") return res.status(403).json({ error: "Only agents have shifts." });
  const me = await DB.getUserById(req.user.id);
  if (!me) return res.status(404).json({ error: "User not found." });
  const now = new Date().toISOString();
  if (me.shift_status === "on") return res.json({ status: "on", since: (me as any).shift_started_at });
  await DB.setShiftStatus(me.id, "on", now);
  await DB.startShiftSession({ id: "sh-" + Date.now() + "-" + Math.floor(Math.random() * 1000), user_id: me.id, user_name: me.full_name, department: me.department || "", started_at: now });
  // Auto-assign any unassigned auto-mode tasks waiting in the pool to this newcomer if appropriate is left to next generation; just return.
  res.json({ status: "on", since: now });
}));

app.post("/api/shift/end", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== "agent") return res.status(403).json({ error: "Only agents have shifts." });
  const me = await DB.getUserById(req.user.id);
  if (!me) return res.status(404).json({ error: "User not found." });
  const now = new Date().toISOString();
  if (me.shift_status === "on") await DB.endShiftSession(me.id, now);
  await DB.setShiftStatus(me.id, "off", null);
  res.json({ status: "off" });
}));

app.get("/api/shift/sessions", authenticateJWT, requireManager, asyncHandler(async (req: any, res: any) => {
  const sessions = req.user.role === "admin" ? await DB.getShiftSessions({}) : await DB.getShiftSessions({ department: req.user.department });
  res.json(sessions);
}));

// ----------------------------------------------------
// Interactions API (Secure & Role-Filtered)
// ----------------------------------------------------
app.get("/api/interactions", authenticateJWT, asyncHandler(async (req, res) => {
  const list = await DB.getInteractions();
  if (req.user.role === "agent") {
    // Agents only see tickets they created/assigned
    const filtered = list.filter((i) => i.agent_id === req.user.id);
    return res.json(filtered);
  }
  res.json(list);
}));

// Agent History lookup for the Call Reason screen (by customer phone and/or order number)
app.get("/api/interactions/history", authenticateJWT, asyncHandler(async (req, res) => {
  const phone = (req.query.phone as string) || "";
  const order = (req.query.order as string) || "";
  if (!phone && !order) return res.json([]);
  let history = await DB.getInteractionHistory({ phone: phone || undefined, order: order || undefined });
  if (req.user.role === "agent") {
    history = history.filter((i) => i.agent_id === req.user.id);
  }
  res.json(history);
}));

app.get("/api/interactions/:id", authenticateJWT, asyncHandler(async (req, res) => {
  const interaction = await DB.getInteractionById(req.params.id);
  if (interaction) {
    if (req.user.role === "agent" && interaction.agent_id !== req.user.id) {
      return res.status(403).json({ error: "Sorry, you are not authorized to view other agents' logs." });
    }
    res.json(interaction);
  } else {
    res.status(404).json({ error: "Interaction not found" });
  }
}));

app.post("/api/interactions", authenticateJWT, asyncHandler(async (req, res) => {
  const {
    customer_name,
    customer_phone,
    interaction_type,
    communication_type,
    call_direction,
    brand,
    category,
    call_reason,
    order_number,
    branch,
    team,
    customer_type,
    call_from,
    aggregator_name,
    comments,
    complaint_reason,
    fcr,
    priority,
    status,
    summary,
    action_taken,
    follow_up_required,
    follow_up_date,
    follow_up_notes,
    attachments, // Array of { file_name, mime_type, file_data }
  } = req.body;

  // Basic validation
  if (!customer_name || !customer_phone || !interaction_type || !communication_type || !call_direction) {
    return res.status(400).json({ error: "Please fill in all required fields." });
  }

  // Force secure session-based injection of Agent details
  const agent_id = req.user.id;
  const agent_name = req.user.full_name;

  // Team defaults to the logged-in operator's own team when not provided
  const operator = await DB.getUserById(agent_id);
  const resolvedTeam = team || operator?.team || "Call Center";

  // Parse attachments
  const parsedAttachments = Array.isArray(attachments)
    ? attachments.map((att: any, idx: number) => ({
        id: `att-${Date.now()}-${idx}`,
        file_name: att.file_name,
        mime_type: att.mime_type,
        file_data: att.file_data,
      }))
    : [];

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toTimeString().split(" ")[0].substring(0, 5); // HH:MM

  const newInteraction = await DB.addInteraction({
    interaction_date: dateStr,
    interaction_time: timeStr,
    agent_id,
    agent_name,
    customer_name,
    customer_phone,
    interaction_type,
    communication_type,
    call_direction,
    brand: brand || "Talabat",
    category: category || "Other",
    call_reason: call_reason || undefined,
    order_number: order_number || undefined,
    branch: branch || undefined,
    team: resolvedTeam,
    customer_type: customer_type || undefined,
    call_from: call_from || undefined,
    aggregator_name: aggregator_name || undefined,
    comments: comments || undefined,
    complaint_reason: call_reason === "Complaint" ? (complaint_reason || undefined) : undefined,
    fcr: call_reason === "Complaint" ? (fcr || undefined) : undefined,
    priority: priority || "Medium",
    status: status || "Open",
    summary: summary || "",
    action_taken: action_taken || "",
    follow_up_required: !!follow_up_required,
    follow_up_date: follow_up_required ? follow_up_date : undefined,
    follow_up_notes: follow_up_required ? follow_up_notes : undefined,
    attachments: parsedAttachments,
    created_at: now.toISOString(),
  });

  // Activity log for the Agent Logs module
  await DB.addAuditLog({
    operator_id: agent_id,
    operator_name: agent_name,
    operator_role: req.user.role,
    category: resolvedTeam,
    action: `Logged Call — ${call_reason || newInteraction.interaction_type}`,
    details: `${newInteraction.brand}${newInteraction.branch ? " / " + newInteraction.branch : ""} · ${newInteraction.customer_phone}${newInteraction.complaint_reason ? " · " + newInteraction.complaint_reason : ""}${newInteraction.fcr ? " · FCR: " + newInteraction.fcr : ""}`,
    related_ref: newInteraction.id,
  });

  res.status(201).json(newInteraction);
}));

app.put("/api/interactions/:id", authenticateJWT, asyncHandler(async (req, res) => {
  const interaction = await DB.getInteractionById(req.params.id);
  if (!interaction) {
    return res.status(404).json({ error: "Interaction not found for editing" });
  }

  if (req.user.role === "agent" && interaction.agent_id !== req.user.id) {
    return res.status(403).json({ error: "Sorry, you are not authorized to update other agents' logs." });
  }

  const updated = await DB.updateInteraction(req.params.id, req.body);
  res.json(updated);
}));

app.delete("/api/interactions/:id", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const success = await DB.deleteInteraction(req.params.id);
  if (success) {
    res.json({ message: "Interaction deleted successfully" });
  } else {
    res.status(404).json({ error: "Interaction not found for deletion" });
  }
}));

// ----------------------------------------------------
// Dashboard & Analytics Stats API (Protected)
// ----------------------------------------------------
app.get("/api/dashboard/stats", authenticateJWT, asyncHandler(async (req, res) => {
  let interactions = await DB.getInteractions();
  const brands = await DB.getBrands();
  const users = await DB.getUsers();

  const todayStr = new Date().toISOString().split("T")[0];

  // RBAC scope limiting for basic agents
  if (req.user.role === "agent") {
    interactions = interactions.filter((i) => i.agent_id === req.user.id);
  }

  // Filters
  const todayInteractions = interactions.filter((i) => i.interaction_date === todayStr);

  const totalCallsToday = todayInteractions.filter((i) => i.communication_type === "Call").length;
  const totalSRs = todayInteractions.filter((i) => i.interaction_type === "SR").length;
  const totalTasks = todayInteractions.filter((i) => i.communication_type === "Task").length;
  const totalInbound = todayInteractions.filter((i) => i.call_direction === "Inbound").length;
  const totalOutbound = todayInteractions.filter((i) => i.call_direction === "Outbound").length;

  // Brand Performance
  const brandPerfMap: Record<string, number> = {};
  brands.forEach((b) => {
    brandPerfMap[b.brand_name] = 0;
  });
  interactions.forEach((i) => {
    if (brandPerfMap[i.brand] !== undefined) {
      brandPerfMap[i.brand]++;
    } else {
      brandPerfMap[i.brand] = 1;
    }
  });
  const brandPerformance = Object.keys(brandPerfMap).map((k) => ({
    name: k,
    count: brandPerfMap[k],
  }));

  // Agent Performance (total)
  const agentPerfMap: Record<string, number> = {};
  users.forEach((u) => {
    if (u.role === "agent") {
      agentPerfMap[u.full_name] = 0;
    }
  });
  interactions.forEach((i) => {
    if (agentPerfMap[i.agent_name] !== undefined) {
      agentPerfMap[i.agent_name]++;
    } else {
      agentPerfMap[i.agent_name] = 1;
    }
  });
  let agentPerformance = Object.keys(agentPerfMap).map((k) => ({
    name: k,
    count: agentPerfMap[k],
  }));

  if (req.user.role === "agent") {
    agentPerformance = agentPerformance.filter((x) => x.name === req.user.full_name);
  }

  // Daily Reports graph (compiled from past 7 days)
  const dailyGraph: Record<string, { calls: number; srs: number; tasks: number }> = {};
  for (let i = 6; i >= 0; i--) {
    const dStr = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    dailyGraph[dStr] = { calls: 0, srs: 0, tasks: 0 };
  }

  interactions.forEach((i) => {
    if (dailyGraph[i.interaction_date]) {
      if (i.communication_type === "Call") {
        dailyGraph[i.interaction_date].calls++;
      }
      if (i.interaction_type === "SR") {
        dailyGraph[i.interaction_date].srs++;
      }
      if (i.communication_type === "Task") {
        dailyGraph[i.interaction_date].tasks++;
      }
    }
  });

  const dailyReports = Object.keys(dailyGraph).map((d) => ({
    date: d,
    calls: dailyGraph[d].calls,
    srs: dailyGraph[d].srs,
    tasks: dailyGraph[d].tasks,
  }));

  // ---- Extended metrics (call center spec) ----
  const isComplaint = (i: any) => i.interaction_type === "Complaint" || i.call_reason === "Complaint";
  const totalCalls = interactions.filter((i) => i.communication_type === "Call").length;
  const complaints = interactions.filter(isComplaint);
  const totalComplaints = complaints.length;
  const solvedCases = complaints.filter((i) => i.fcr === "Solved").length;
  const unsolvedCases = complaints.filter((i) => i.fcr === "Not Solved").length;
  const fcrDenom = solvedCases + unsolvedCases;
  const fcrRate = fcrDenom ? Math.round((solvedCases / fcrDenom) * 100) : 0;

  const groupCount = (keyFn: (i: any) => string) => {
    const m: Record<string, number> = {};
    interactions.forEach((i) => { const k = keyFn(i) || "Unspecified"; m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map((name) => ({ name, count: m[name] })).sort((a, b) => b.count - a.count);
  };
  const callsByType = groupCount((i) => i.call_reason || i.interaction_type);
  const callsByBranch = groupCount((i) => i.branch);

  // Complaint trends over the past 7 days
  const trendMap: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const dStr = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    trendMap[dStr] = 0;
  }
  complaints.forEach((i) => { if (trendMap[i.interaction_date] !== undefined) trendMap[i.interaction_date]++; });
  const complaintTrends = Object.keys(trendMap).map((d) => ({ date: d, count: trendMap[d] }));

  res.json({
    totalCallsToday,
    totalSRs,
    totalTasks,
    totalInbound,
    totalOutbound,
    brandPerformance,
    agentPerformance,
    dailyReports,
    // extended
    totalCalls,
    totalComplaints,
    solvedCases,
    unsolvedCases,
    fcrRate,
    callsByType,
    callsByBranch,
    complaintTrends,
  });
}));

// ----------------------------------------------------
// Reports PDF/CSV Export Generation API (Protected to TL/Admin)
// ----------------------------------------------------
app.get("/api/reports/daily", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const interactions = await DB.getInteractions();
  const users = await DB.getUsers();

  const targetDate = (req.query.date as string) || new Date().toISOString().split("T")[0];
  const dailyLogs = interactions.filter((i) => i.interaction_date === targetDate);

  const totalCalls = dailyLogs.filter((i) => i.communication_type === "Call").length;
  const totalSRs = dailyLogs.filter((i) => i.interaction_type === "SR").length;
  const totalTasks = dailyLogs.filter((i) => i.communication_type === "Task").length;
  const inboundCount = dailyLogs.filter((i) => i.call_direction === "Inbound").length;
  const outboundCount = dailyLogs.filter((i) => i.call_direction === "Outbound").length;

  // Agent productivity
  const productivityMap: Record<string, { calls: number; srs: number; tasks: number }> = {};
  users.forEach((u) => {
    if (u.role === "agent") {
      productivityMap[u.full_name] = { calls: 0, srs: 0, tasks: 0 };
    }
  });

  dailyLogs.forEach((i) => {
    if (!productivityMap[i.agent_name]) {
      productivityMap[i.agent_name] = { calls: 0, srs: 0, tasks: 0 };
    }
    if (i.communication_type === "Call") productivityMap[i.agent_name].calls++;
    if (i.interaction_type === "SR") productivityMap[i.agent_name].srs++;
    if (i.communication_type === "Task") productivityMap[i.agent_name].tasks++;
  });

  const agentProductivity = Object.keys(productivityMap).map((k) => ({
    name: k,
    calls: productivityMap[k].calls,
    srs: productivityMap[k].srs,
    tasks: productivityMap[k].tasks,
  }));

  res.json({
    totalCalls,
    totalSRs,
    totalTasks,
    inboundCount,
    outboundCount,
    agentProductivity,
  });
}));

app.get("/api/reports/monthly", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const interactions = await DB.getInteractions();
  const brands = await DB.getBrands();

  const resolved = interactions.filter((i) => i.status === "Resolved" || i.status === "Closed").length;
  const resolutionRate = interactions.length ? Math.round((resolved / interactions.length) * 100) : 0;

  const followUpRequiredNum = interactions.filter((i) => i.follow_up_required).length;
  const followUpRate = interactions.length ? Math.round((followUpRequiredNum / interactions.length) * 100) : 0;

  const categoryMap: Record<string, number> = {};
  interactions.forEach((i) => {
    categoryMap[i.category] = (categoryMap[i.category] || 0) + 1;
  });
  const topCategories = Object.keys(categoryMap)
    .map((k) => ({
      name: k,
      count: categoryMap[k],
    }))
    .sort((a, b) => b.count - a.count);

  const brandPerf = brands.map((b) => {
    const brandInteractions = interactions.filter((i) => i.brand === b.brand_name);
    const resolvedInBrand = brandInteractions.filter((i) => i.status === "Resolved" || i.status === "Closed").length;
    const rate = brandInteractions.length ? Math.round((resolvedInBrand / brandInteractions.length) * 100) : 100;
    return {
      name: b.brand_name,
      count: brandInteractions.length,
      resolvedRate: rate,
    };
  });

  res.json({
    brandPerformance: brandPerf,
    topCategories,
    resolutionRate,
    averageHandlingTime: "4m 12s",
    followUpRate,
  });
}));

// ----------------------------------------------------
// Mounting Vite Server Middleware
// ----------------------------------------------------
async function startServer() {
  // Ensure database schema exists and is seeded before serving traffic
  await DB.init();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serving built production static assets
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[CRM Server] Running successfully on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("[CRM Server] Failed to start:", err);
  process.exit(1);
});
