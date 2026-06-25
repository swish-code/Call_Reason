// Coarse permission bucket. Authority order is driven by `level` (below), not by role.
export type UserRole = "agent" | "leader" | "supervisor" | "manager" | "owner" | "admin";

// Organizational team an employee belongs to (separate from the permission role)
export type Team = "Complain Team" | "Call Center" | "Technical Team" | "Team Leader";
export const TEAMS: Team[] = ["Complain Team", "Call Center", "Technical Team", "Team Leader"];

// Department an employee belongs to (Operations & Logs system)
export type Department = "Call Center" | "Technical" | "Complaints" | "Quality";
export const DEPARTMENTS: Department[] = ["Call Center", "Technical", "Complaints", "Quality"];

// Org hierarchy levels (higher number = more authority).
// Roles at level <= 3 are department-scoped; level >= 4 (management) act across departments.
export const LEVEL = {
  AGENT: 1,
  LEADER: 2,
  SUPERVISOR: 3,
  ASSISTANT_MANAGER: 4,
  MANAGER: 5, // Operations / Marketing / Call Center managers (peers)
  OWNER: 6,
  ADMIN: 99, // System Admin — full system access
} as const;
// A role/level is "executive" (cross-department) once it reaches Assistant Manager.
export const EXECUTIVE_LEVEL = LEVEL.ASSISTANT_MANAGER;

// A selectable account type encodes the permission role, department and hierarchy level.
export interface UserType { value: string; label: string; role: UserRole; department: Department | null; level: number; }
export const USER_TYPES: UserType[] = [
  { value: "call_center_agent", label: "Call Center Agent", role: "agent", department: "Call Center", level: LEVEL.AGENT },
  { value: "call_center_leader", label: "Call Center Team Leader", role: "leader", department: "Call Center", level: LEVEL.LEADER },
  { value: "technical_agent", label: "Technical Agent", role: "agent", department: "Technical", level: LEVEL.AGENT },
  { value: "technical_leader", label: "Technical Team Leader", role: "leader", department: "Technical", level: LEVEL.LEADER },
  { value: "complaint_agent", label: "Complaint Team Agent", role: "agent", department: "Complaints", level: LEVEL.AGENT },
  { value: "complaint_leader", label: "Complaint Team Leader", role: "leader", department: "Complaints", level: LEVEL.LEADER },
  { value: "quality_agent", label: "Quality Agent", role: "agent", department: "Quality", level: LEVEL.AGENT },
  { value: "quality_leader", label: "Quality Team Leader", role: "leader", department: "Quality", level: LEVEL.LEADER },
  { value: "supervisor_call_center", label: "Supervisor Call Center", role: "supervisor", department: "Call Center", level: LEVEL.SUPERVISOR },
  { value: "supervisor_complaint", label: "Supervisor Complaint", role: "supervisor", department: "Complaints", level: LEVEL.SUPERVISOR },
  { value: "supervisor_technical", label: "Supervisor Technical", role: "supervisor", department: "Technical", level: LEVEL.SUPERVISOR },
  { value: "quality_supervisor", label: "Quality Supervisor", role: "supervisor", department: "Quality", level: LEVEL.SUPERVISOR },
  { value: "assistant_manager", label: "Assistant Manager", role: "manager", department: null, level: LEVEL.ASSISTANT_MANAGER },
  { value: "call_center_manager", label: "Call Center Manager", role: "manager", department: null, level: LEVEL.MANAGER },
  { value: "marketing_manager", label: "Marketing Manager", role: "manager", department: null, level: LEVEL.MANAGER },
  { value: "operations_manager", label: "Operations Manager", role: "manager", department: null, level: LEVEL.MANAGER },
  { value: "owner", label: "Owner", role: "owner", department: null, level: LEVEL.OWNER },
  { value: "system_admin", label: "System Admin", role: "admin", department: null, level: LEVEL.ADMIN },
];

// Default level for a bare role (used to backfill legacy accounts without a stored level)
export const roleDefaultLevel = (role: string): number =>
  role === "owner" ? LEVEL.OWNER : role === "admin" ? LEVEL.ADMIN : role === "manager" ? LEVEL.MANAGER
  : role === "supervisor" ? LEVEL.SUPERVISOR : role === "leader" ? LEVEL.LEADER : LEVEL.AGENT;

// The log modules
export type LogType = "call_center" | "technical" | "complaint" | "team_leader" | "quality";

export interface OpsLog {
  id: string;
  log_type: LogType;
  department: string;
  activity_type: string;
  status?: string;
  agent_id: string;       // creator/owner (the Team Leader for team_leader logs)
  agent_name: string;
  branch?: string;
  brand?: string;
  order_number?: string;
  aggregator?: string;
  customer_name?: string;
  complaint_id?: string;
  target_agent_name?: string; // agent being coached (team_leader logs)
  notes?: string;
  action_taken?: string;
  resolution_notes?: string;
  action_plan?: string;
  follow_up_date?: string;
  // Task time tracking (live timer)
  started_at?: string;
  duration_seconds?: number;
  running_since?: string | null;
  created_at: string;
  updated_at?: string;
  created_by?: string;
}

// Drives the generic log form & list per type. activityKey/statusKey reference
// option lists managed from the Configuration page.
export const LOG_TYPE_CONFIG: Record<LogType, {
  title: string;
  department: Department | null; // null = Team Leader module (not department-bound)
  activityLabel: string;
  activityKey: string;
  statusKey?: string;
  fields: string[];
}> = {
  call_center: { title: "Call Center Log", department: "Call Center", activityLabel: "Activity Type", activityKey: "cc_activity", statusKey: "cc_status", fields: ["brand", "order_number", "notes"] },
  technical: { title: "Technical Log", department: "Technical", activityLabel: "Technical Task Type", activityKey: "tech_activity", statusKey: "cc_status", fields: ["brand", "notes"] },
  complaint: { title: "Complaint Log", department: "Complaints", activityLabel: "Complaint Type", activityKey: "complaint_activity", statusKey: "complaint_status", fields: ["complaint_id", "resolution_notes"] },
  team_leader: { title: "Team Leader Log", department: null, activityLabel: "Activity Type", activityKey: "tl_activity", fields: ["target_agent_name", "notes", "action_plan", "follow_up_date"] },
  quality: { title: "Quality Log", department: "Quality", activityLabel: "Quality Activity", activityKey: "quality_activity", statusKey: "cc_status", fields: ["brand", "notes"] },
};

export interface User {
  id: string;
  full_name: string;
  username: string;
  email: string;
  password_hash: string;
  role: UserRole;
  level?: number; // Org hierarchy level (see LEVEL)
  job_title?: string; // Human-facing account type label (e.g. "Call Center Manager")
  team?: Team; // Legacy team field (kept for backward compatibility)
  department?: Department; // Department for the Operations & Logs system
  status: "Active" | "Inactive";
  shift_status?: "on" | "off"; // Agent shift presence
  shift_started_at?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;

  // Backward compatibility compatibility fields
  name?: string;
  token?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  operator_id: string;
  operator_name: string;
  operator_role?: string; // Role at the time of the action
  category?: string; // Team category for Agent Logs grouping
  action: string;
  details: string;
  related_ref?: string; // Reference to a related record (e.g. interaction id)
  department?: string;
  previous_value?: string;
  new_value?: string;
  ip_address?: string;
}

export type InteractionType = "SR" | "Complaint" | "Inquiry" | "Escalation" | "Follow Up" | "Feedback";
export type CommunicationType = "Call" | "Task";

// Call Reason / Call Type: the reason an agent selects first when a call comes in.
export type CallReason = "New Order" | "Follow Up" | "Complaint" | "Inquiry" | "Additional Request";
export const CALL_REASONS: CallReason[] = ["New Order", "Follow Up", "Complaint", "Inquiry", "Additional Request"];

// Caller information classification
export type CustomerType = "Customer" | "Aggregator" | "Driver";
export const CUSTOMER_TYPES: CustomerType[] = ["Customer", "Aggregator", "Driver"];

export type CallFrom = "Customer" | "Aggregator" | "Driver";
export const CALL_FROM_OPTIONS: CallFrom[] = ["Customer", "Aggregator", "Driver"];

export const AGGREGATORS: string[] = ["Talabat", "Keeta", "Other Aggregators"];

// Complaint-specific fields
export type ComplaintReason = "Late Delivery" | "Late Preparation" | "Missing Items" | "Wrong Order" | "Other";
export const COMPLAINT_REASONS: ComplaintReason[] = ["Late Delivery", "Late Preparation", "Missing Items", "Wrong Order", "Other"];

export type FCR = "Solved" | "Not Solved";
export const FCR_OPTIONS: FCR[] = ["Solved", "Not Solved"];
export type CallDirection = "Inbound" | "Outbound";
export type PriorityLevel = "Low" | "Medium" | "High" | "Critical";
export type InteractionStatus = "Open" | "Pending" | "Resolved" | "Closed";

export interface Attachment {
  id: string;
  interaction_id: string;
  file_name: string;
  mime_type: string;
  file_data: string; // Base64 representation for simple local JSON file db storage
}

export interface Interaction {
  id: string;
  interaction_date: string; // YYYY-MM-DD
  interaction_time: string; // HH:MM
  agent_id: string;
  agent_name: string; // Cache agent name for speed and offline robustness
  customer_name: string;
  customer_phone: string;
  interaction_type: InteractionType;
  communication_type: CommunicationType;
  call_direction: CallDirection;
  brand: string;
  category: string;
  call_reason?: CallReason | string; // Call Type chosen at the start of the call
  order_number?: string;
  branch?: string; // Store/branch, shown for Complaint call reasons
  team?: Team; // Team that handled the interaction (defaults to the agent's team)
  customer_type?: CustomerType | string;
  call_from?: CallFrom | string;
  aggregator_name?: string; // Talabat / Keeta / Other Aggregators
  comments?: string; // Free-text call notes
  complaint_reason?: ComplaintReason | string; // Set when call_reason is Complaint
  fcr?: FCR | string; // First Call Resolution: Solved / Not Solved
  priority: PriorityLevel;
  status: InteractionStatus;
  summary: string;
  action_taken: string;
  follow_up_required: boolean;
  follow_up_date?: string; // YYYY-MM-DD
  follow_up_notes?: string;
  attachments?: Omit<Attachment, "interaction_id">[]; // Nested for easy retrieval
  created_at: string;
}

// A task assigned by a manager (leader/supervisor/admin) to an agent
export interface AssignedTask {
  id: string;
  title: string;
  description?: string;
  assigned_by: string;
  assigned_by_name: string;
  assigned_to: string;
  assigned_to_name: string;
  department?: string;
  priority?: string;
  due_date?: string; // YYYY-MM-DDTHH:mm
  status: string; // New | In Progress | Completed
  seen?: boolean;
  duration_seconds?: number;
  note?: string; // Agent's completion note
  created_at: string;
  updated_at?: string;
  completed_at?: string;
}
export const TASK_STATUSES = ["New", "In Progress", "Completed"];

export interface Brand {
  id: string;
  brand_name: string;
}

export interface Category {
  id: string;
  category_name: string;
}

export interface Branch {
  id: string;
  branch_name: string;
  brand?: string; // Owning brand (branches are per-brand)
}

// Generic, admin-managed dropdown option (Configuration page)
export interface DropdownOption {
  id: string;
  list_key: string;
  label: string;
  sort_order: number;
  active: boolean;
}

// Catalog of the dropdown lists managed from the Configuration page
export const CONFIGURABLE_LISTS: { key: string; title: string; description: string }[] = [
  { key: "call_type", title: "Call Types", description: "Call Reason form — Call Type" },
  { key: "customer_type", title: "Customer Types", description: "Caller Information — Customer Type" },
  { key: "call_from", title: "Call From", description: "Caller Information — Call From" },
  { key: "aggregator", title: "Aggregators", description: "Aggregator names (Talabat, Keeta, …)" },
  { key: "complaint_reason", title: "Complaint Reasons", description: "Shown when the call is a Complaint" },
  { key: "fcr", title: "FCR Options", description: "First Call Resolution values" },
  { key: "priority", title: "Priority Levels", description: "Ticket priority" },
  { key: "status", title: "Statuses", description: "Ticket status" },
  { key: "team", title: "Teams", description: "Operational teams (legacy)" },
  { key: "call_direction", title: "Call Directions", description: "Inbound / Outbound" },
  { key: "department", title: "Departments", description: "User departments (Call Center / Technical / Complaints)" },
  { key: "cc_activity", title: "Call Center — Activities", description: "Call Center log activity types" },
  { key: "tech_activity", title: "Technical — Task Types", description: "Technical log task types" },
  { key: "complaint_activity", title: "Complaints — Types", description: "Complaint log types" },
  { key: "quality_activity", title: "Quality — Activities", description: "Quality log activity types" },
  { key: "tl_activity", title: "Team Leader — Activities", description: "Team Leader log activity types" },
  { key: "cc_status", title: "Log Status (CC/Technical)", description: "Open / In Progress / Completed" },
  { key: "complaint_status", title: "Complaint Status", description: "Solved / Not Solved / Waiting Feedback" },
];

export interface DashboardStats {
  totalCallsToday: number;
  totalSRs: number;
  totalTasks: number;
  totalInbound: number;
  totalOutbound: number;
  brandPerformance: { name: string; count: number }[];
  agentPerformance: { name: string; count: number }[];
  dailyReports: { date: string; calls: number; srs: number; tasks: number }[];
  // extended call-center metrics
  totalCalls: number;
  totalComplaints: number;
  solvedCases: number;
  unsolvedCases: number;
  fcrRate: number;
  callsByType: { name: string; count: number }[];
  callsByBranch: { name: string; count: number }[];
  complaintTrends: { date: string; count: number }[];
}

export interface DailyReportData {
  totalCalls: number;
  totalSRs: number;
  totalTasks: number;
  inboundCount: number;
  outboundCount: number;
  agentProductivity: { name: string; calls: number; srs: number; tasks: number }[];
}

export interface MonthlyReportData {
  brandPerformance: { name: string; count: number; resolvedRate: number }[];
  topCategories: { name: string; count: number }[];
  resolutionRate: number; // percentage
  averageHandlingTime: string; // e.g. "4m 32s" (simulation based on logging logs, custom)
  followUpRate: number; // percentage
}
