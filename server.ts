import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { DB } from "./server/db.js";
import { GoogleGenAI, Type } from "@google/genai";
import { Interaction } from "./src/types.js";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase request size limit for base64 file uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Shared server-side Gemini initialization as per instructions
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

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

// ----------------------------------------------------
// Authentication API
// ----------------------------------------------------
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body; // Represents either email or username input
  if (!email || !password) {
    return res.status(400).json({ error: "Please enter your email/username and password." });
  }

  const user = DB.getUserByUsernameOrEmail(email);
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
      full_name: user.full_name
    },
    JWT_SECRET,
    { expiresIn: "24h" }
  );

  // Success login log
  DB.addAuditLog({
    operator_id: user.id,
    operator_name: user.full_name,
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
    status: user.status,
    token
  };

  res.json(userData);
});

// ----------------------------------------------------
// Users Management API (Requires Admin)
// ----------------------------------------------------
app.get("/api/users", authenticateJWT, requireLeaderOrAdmin, (req: any, res: any) => {
  // Team leaders and admins can inspect users (e.g. view team)
  const users = DB.getUsers().map(({ password_hash, ...u }) => u);
  res.json(users);
});

app.post("/api/users", authenticateJWT, requireAdmin, (req: any, res: any) => {
  const { full_name, username, email, password, role, status } = req.body;

  if (!full_name || !username || !email || !password || !role || !status) {
    return res.status(400).json({ error: "Please fill in all required fields to create the account." });
  }

  // Conflict validation
  const existingEmail = DB.getUserByEmail(email);
  const existingUsername = DB.getUsers().find(
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

  const newUser = DB.addUser({
    id: "user-" + Date.now(),
    full_name,
    name: full_name,
    username,
    email,
    password_hash,
    role,
    status,
    created_at: nowString,
    updated_at: nowString,
    created_by: req.user.id
  });

  // Safe logging
  DB.addAuditLog({
    operator_id: req.user.id,
    operator_name: req.user.full_name,
    action: "Create User",
    details: `A new user account was created: ${username} (${role})`
  });

  const { password_hash: _, ...safeUser } = newUser;
  res.status(201).json(safeUser);
});

app.put("/api/users/:id", authenticateJWT, requireAdmin, (req: any, res: any) => {
  const { id } = req.params;
  const { full_name, username, email, role, status, password } = req.body;

  const targetUser = DB.getUserById(id);
  if (!targetUser) {
    return res.status(404).json({ error: "The user requested for update does not exist in the system." });
  }

  // Match conflicts
  if (email && email !== targetUser.email) {
    if (DB.getUserByEmail(email)) {
      return res.status(400).json({ error: "The new email is already in use by another account." });
    }
  }
  if (username && username !== targetUser.username) {
    const conflicts = DB.getUsers().find(
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
    status: status || targetUser.status,
  };

  if (password && password.trim() !== "") {
    updates.password_hash = bcrypt.hashSync(password, 10);
  }

  const updatedUser = DB.updateUser(id, updates);

  // Safe logging
  DB.addAuditLog({
    operator_id: req.user.id,
    operator_name: req.user.full_name,
    action: "Edit User",
    details: `User data updated: ${updates.username} (status: ${updates.status})`
  });

  const { password_hash: _, ...safeUser } = updatedUser!;
  res.json(safeUser);
});

app.delete("/api/users/:id", authenticateJWT, requireAdmin, (req: any, res: any) => {
  const { id } = req.params;

  if (id === req.user.id) {
    return res.status(400).json({ error: "You cannot delete your own logged-in account." });
  }

  const targetUser = DB.getUserById(id);
  if (!targetUser) {
    return res.status(404).json({ error: "User not found for deletion." });
  }

  DB.deleteUser(id);

  // Safe logging
  DB.addAuditLog({
    operator_id: req.user.id,
    operator_name: req.user.full_name,
    action: "Delete User",
    details: `User account permanently deleted: ${targetUser.username}`
  });

  res.json({ message: "User account deleted successfully." });
});

app.put("/api/users/:id/reset-password", authenticateJWT, requireAdmin, (req: any, res: any) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.trim() === "") {
    return res.status(400).json({ error: "New password is required." });
  }

  const targetUser = DB.getUserById(id);
  if (!targetUser) {
    return res.status(404).json({ error: "User not found for password reset." });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  DB.updateUser(id, { password_hash });

  // Safe logging
  DB.addAuditLog({
    operator_id: req.user.id,
    operator_name: req.user.full_name,
    action: "Password Reset",
    details: `A new password was successfully reset for user: ${targetUser.username}`
  });

  res.json({ message: "Password reset successfully." });
});

// Audit Logs list API
app.get("/api/audit-logs", authenticateJWT, requireLeaderOrAdmin, (req: any, res: any) => {
  res.json(DB.getAuditLogs());
});

// ----------------------------------------------------
// Brands API (Protected)
// ----------------------------------------------------
app.get("/api/brands", authenticateJWT, (req: any, res: any) => {
  res.json(DB.getBrands());
});

app.post("/api/brands", authenticateJWT, requireLeaderOrAdmin, (req: any, res: any) => {
  const { name } = req.body;
  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Brand name is required" });
  }
  const brand = DB.addBrand(name.trim());
  res.status(201).json(brand);
});

app.delete("/api/brands/:id", authenticateJWT, requireLeaderOrAdmin, (req: any, res: any) => {
  const success = DB.deleteBrand(req.params.id);
  if (success) {
    res.json({ message: "Brand deleted successfully" });
  } else {
    res.status(404).json({ error: "Brand not found" });
  }
});

// ----------------------------------------------------
// Categories API (Protected)
// ----------------------------------------------------
app.get("/api/categories", authenticateJWT, (req: any, res: any) => {
  res.json(DB.getCategories());
});

app.post("/api/categories", authenticateJWT, requireLeaderOrAdmin, (req: any, res: any) => {
  const { name } = req.body;
  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Category name is required" });
  }
  const category = DB.addCategory(name.trim());
  res.status(201).json(category);
});

app.delete("/api/categories/:id", authenticateJWT, requireLeaderOrAdmin, (req: any, res: any) => {
  const success = DB.deleteCategory(req.params.id);
  if (success) {
    res.json({ message: "Category deleted successfully" });
  } else {
    res.status(404).json({ error: "Category not found" });
  }
});

// ----------------------------------------------------
// Interactions API (Secure & Role-Filtered)
// ----------------------------------------------------
app.get("/api/interactions", authenticateJWT, (req: any, res: any) => {
  const list = DB.getInteractions();
  if (req.user.role === "agent") {
    // Agents only see tickets they created/assigned
    const filtered = list.filter((i) => i.agent_id === req.user.id);
    return res.json(filtered);
  }
  res.json(list);
});

app.get("/api/interactions/:id", authenticateJWT, (req: any, res: any) => {
  const interaction = DB.getInteractionById(req.params.id);
  if (interaction) {
    if (req.user.role === "agent" && interaction.agent_id !== req.user.id) {
      return res.status(403).json({ error: "Sorry, you are not authorized to view other agents' logs." });
    }
    res.json(interaction);
  } else {
    res.status(404).json({ error: "Interaction not found" });
  }
});

app.post("/api/interactions", authenticateJWT, (req: any, res: any) => {
  const {
    customer_name,
    customer_phone,
    interaction_type,
    communication_type,
    call_direction,
    brand,
    category,
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

  const newInteraction = DB.addInteraction({
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

  res.status(201).json(newInteraction);
});

app.put("/api/interactions/:id", authenticateJWT, (req: any, res: any) => {
  const interaction = DB.getInteractionById(req.params.id);
  if (!interaction) {
    return res.status(404).json({ error: "Interaction not found for editing" });
  }

  if (req.user.role === "agent" && interaction.agent_id !== req.user.id) {
    return res.status(403).json({ error: "Sorry, you are not authorized to update other agents' logs." });
  }

  const updated = DB.updateInteraction(req.params.id, req.body);
  res.json(updated);
});

app.delete("/api/interactions/:id", authenticateJWT, requireLeaderOrAdmin, (req: any, res: any) => {
  const success = DB.deleteInteraction(req.params.id);
  if (success) {
    res.json({ message: "Interaction deleted successfully" });
  } else {
    res.status(404).json({ error: "Interaction not found for deletion" });
  }
});

// ----------------------------------------------------
// Dashboard & Analytics Stats API (Protected)
// ----------------------------------------------------
app.get("/api/dashboard/stats", authenticateJWT, (req: any, res: any) => {
  let interactions = DB.getInteractions();
  const brands = DB.getBrands();
  const users = DB.getUsers();

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

  res.json({
    totalCallsToday,
    totalSRs,
    totalTasks,
    totalInbound,
    totalOutbound,
    brandPerformance,
    agentPerformance,
    dailyReports,
  });
});

// ----------------------------------------------------
// Reports PDF/CSV Export Generation API (Protected to TL/Admin)
// ----------------------------------------------------
app.get("/api/reports/daily", authenticateJWT, requireLeaderOrAdmin, (req: any, res: any) => {
  const interactions = DB.getInteractions();
  const users = DB.getUsers();
  
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
});

app.get("/api/reports/monthly", authenticateJWT, requireLeaderOrAdmin, (req: any, res: any) => {
  const interactions = DB.getInteractions();
  const brands = DB.getBrands();

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
});

// ----------------------------------------------------
// AI Auto-Classification API using Gemini SDK (Protected)
// ----------------------------------------------------
app.post("/api/ai/classify", authenticateJWT, async (req: any, res: any) => {
  const { notes } = req.body;
  
  if (!notes || notes.trim() === "") {
    return res.status(400).json({ error: "Please enter call details for AI auto-classification." });
  }

  if (!ai) {
    return res.status(503).json({
      error: "Gemini API Key is not set up correctly. Please add it from the Settings menu.",
    });
  }

  const activeBrands = DB.getBrands().map((b) => b.brand_name);
  const activeCategories = DB.getCategories().map((c) => c.category_name);

  const systemInstruction = `You are a professional sales representative and an AI assistant for a CRM Call Logging and customer service system.
Your task is to analyze the phone call notes (written in English or Arabic) and accurately extract the following fields in accordance with the system constraints.
Current database brand options are: [${activeBrands.join(", ")}].
Current database category options are: [${activeCategories.join(", ")}].

You must classify the brand and category based on these options as a top priority. If the brand does not match any registered option, choose the most appropriate one or 'Other' or a custom value and write its name in the brand field.
Accepted types and properties:
- interaction_type: must be strictly one of: ["SR", "Complaint", "Inquiry", "Escalation", "Follow Up", "Feedback"]
- category: must be strictly one of: [${activeCategories.map(c => `"${c}"`).join(", ")}]
- call_direction: must be strictly "Inbound" or "Outbound".
- priority: must be strictly one of: ["Low", "Medium", "High", "Critical"]
- status: must be strictly one of: ["Open", "Pending", "Resolved", "Closed"]
- summary: A precise and professional summary of the conversation in English.
- action_taken: A professional suggested or taken action to resolve the call, in English.
- follow_up_required: boolean value (true or false)
- follow_up_date: expected follow-up date in YYYY-MM-DD format if required.
- follow_up_notes: details for follow-up if applicable.

You must respond strictly with valid JSON conforming to the schema specification. Do not write any other text or markdown block indicators outside of the JSON output.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Analyze the following call and accurately extract its details. Formulate the summary and action_taken in English:\n\n"${notes}"`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: [
            "interaction_type",
            "brand",
            "call_direction",
            "category",
            "priority",
            "status",
            "summary",
            "action_taken",
            "follow_up_required",
          ],
          properties: {
            interaction_type: {
              type: Type.STRING,
              description: "Must be SR, Complaint, Inquiry, Escalation, Follow Up, or Feedback",
            },
            brand: {
              type: Type.STRING,
              description: "Highly aligned brand value matching registered list",
            },
            call_direction: {
              type: Type.STRING,
              description: "Inbound or Outbound",
            },
            category: {
              type: Type.STRING,
              description: "Matched interaction category",
            },
            priority: {
              type: Type.STRING,
              description: "Priority: Low, Medium, High, or Critical",
            },
            status: {
              type: Type.STRING,
              description: "Status: Open, Pending, Resolved, or Closed",
            },
            summary: {
              type: Type.STRING,
              description: "English professional summarization of the raw call notes",
            },
            action_taken: {
              type: Type.STRING,
              description: "English suggested or actual action taken to resolve the customer's request",
            },
            follow_up_required: {
              type: Type.BOOLEAN,
              description: "True if follow-up is necessary based on the issue, otherwise false",
            },
            follow_up_date: {
              type: Type.STRING,
              description: "If follow_up_required is true, a plausible date YYYY-MM-DD, else empty",
            },
            follow_up_notes: {
              type: Type.STRING,
              description: "Notes for the future agent doing the follow-up work",
            },
          },
        },
      },
    });

    const jsonText = response.text || "{}";
    const result = JSON.parse(jsonText.trim());
    res.json(result);
  } catch (error: any) {
    console.error("Gemini Classify Error:", error);
    res.status(500).json({
      error: "An error occurred while communicating with Gemini for call classification. Please check your API key or perform manual logging.",
      details: error.message,
    });
  }
});

// ----------------------------------------------------
// Mounting Vite Server Middleware
// ----------------------------------------------------
async function startServer() {
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

startServer();
