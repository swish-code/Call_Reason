export type UserRole = "agent" | "leader" | "admin";

export interface User {
  id: string;
  full_name: string;
  username: string;
  email: string;
  password_hash: string;
  role: UserRole;
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
  action: string;
  details: string;
  ip_address?: string;
}

export type InteractionType = "SR" | "Complaint" | "Inquiry" | "Escalation" | "Follow Up" | "Feedback";
export type CommunicationType = "Call" | "Task";
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

export interface DashboardStats {
  totalCallsToday: number;
  totalSRs: number;
  totalTasks: number;
  totalInbound: number;
  totalOutbound: number;
  brandPerformance: { name: string; count: number }[];
  agentPerformance: { name: string; count: number }[];
  dailyReports: { date: string; calls: number; srs: number; tasks: number }[];
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
