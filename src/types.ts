export type UserRole = "agent" | "leader" | "supervisor" | "admin";

// Organizational team an employee belongs to (separate from the permission role)
export type Team = "Complain Team" | "Call Center" | "Technical Team" | "Team Leader";
export const TEAMS: Team[] = ["Complain Team", "Call Center", "Technical Team", "Team Leader"];

// Department an Agent / Team Leader belongs to (Operations & Logs system)
export type Department = "Call Center" | "Technical" | "Complaints";
export const DEPARTMENTS: Department[] = ["Call Center", "Technical", "Complaints"];

// The four log modules
export type LogType = "call_center" | "technical" | "complaint" | "team_leader";

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
  call_center: { title: "Call Center Log", department: "Call Center", activityLabel: "Activity Type", activityKey: "cc_activity", statusKey: "cc_status", fields: ["brand", "branch", "order_number", "notes"] },
  technical: { title: "Technical Log", department: "Technical", activityLabel: "Technical Task Type", activityKey: "tech_activity", statusKey: "cc_status", fields: ["brand", "branch", "order_number", "aggregator", "notes"] },
  complaint: { title: "Complaint Log", department: "Complaints", activityLabel: "Complaint Type", activityKey: "complaint_activity", statusKey: "complaint_status", fields: ["complaint_id", "order_number", "customer_name", "action_taken", "resolution_notes"] },
  team_leader: { title: "Team Leader Log", department: null, activityLabel: "Activity Type", activityKey: "tl_activity", fields: ["target_agent_name", "notes", "action_plan", "follow_up_date"] },
};

export interface User {
  id: string;
  full_name: string;
  username: string;
  email: string;
  password_hash: string;
  role: UserRole;
  team?: Team; // Legacy team field (kept for backward compatibility)
  department?: Department; // Department for the Operations & Logs system
  status: "Active" | "Inactive";
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
