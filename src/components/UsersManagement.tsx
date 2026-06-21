import React, { useState, useEffect } from "react";
import { User, Team, TEAMS, Department, DEPARTMENTS } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { 
  User as UserIcon, 
  Plus, 
  Trash2, 
  Edit, 
  Lock, 
  UserCheck, 
  UserX,
  X, 
  Shield, 
  Save, 
  Key,
  FileCheck2
} from "lucide-react";

interface UsersManagementProps {
  currentUser: User;
}

export default function UsersManagement({ currentUser }: UsersManagementProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Create/Edit states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "leader" | "agent">("agent");
  const [team, setTeam] = useState<Team>("Call Center");
  const [department, setDepartment] = useState<Department>("Call Center");
  const [status, setStatus] = useState<"Active" | "Inactive">("Active");

  // Reset password states
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resettingUser, setResettingUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch("/api/users");
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to load users roster checklist.");
      }
      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleOpenAdd = () => {
    setEditingUser(null);
    setFullName("");
    setUsername("");
    setPassword("");
    setRole("agent");
    setTeam("Call Center");
    setDepartment("Call Center");
    setStatus("Active");
    setError("");
    setIsModalOpen(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser(user);
    setFullName(user.full_name || user.name || "");
    setUsername(user.username);
    setPassword(""); // don't fill password
    setRole(user.role);
    setTeam(user.team || "Call Center");
    setDepartment(user.department || "Call Center");
    setStatus(user.status || "Active");
    setError("");
    setIsModalOpen(true);
  };

  const handleOpenReset = (user: User) => {
    setResettingUser(user);
    setNewPassword("");
    setError("");
    setIsResetOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    const payload = {
      full_name: fullName,
      username,
      role,
      team,
      department,
      status,
      ...(password && { password })
    };

    try {
      let res;
      if (editingUser) {
        res = await apiFetch(`/api/users/${editingUser.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        if (!password) {
          setError("A primary password is required for new users.");
          return;
        }
        res = await apiFetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, password })
        });
      }

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "An unexpected database execution error occurred.");
      }

      setSuccessMsg(editingUser ? "Account settings modified successfully." : "User record created successfully.");
      setIsModalOpen(false);
      fetchUsers();
      
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.trim() === "") {
      setError("Please specify a valid, secure password.");
      return;
    }

    try {
      setError("");
      const res = await apiFetch(`/api/users/${resettingUser?.id}/reset-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to modify pass-credentials.");
      }

      setSuccessMsg(`Password reset completed successfully for user: ${resettingUser?.username}.`);
      setIsResetOpen(false);
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteUser = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to permanently delete user account "${name}"?`)) {
      return;
    }

    try {
      setError("");
      setSuccessMsg("");
      const res = await apiFetch(`/api/users/${id}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to drop the user record.");
      }

      setSuccessMsg("User repository record dropped successfully.");
      fetchUsers();
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const getRoleBadgeColor = (r: string) => {
    if (r === "admin") return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
    if (r === "leader") return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    return "bg-blue-500/10 text-blue-400 border border-blue-500/20";
  };

  const getRoleLabel = (r: string) => {
    if (r === "admin") return "Admin";
    if (r === "leader") return "Team Leader";
    return "Support Agent";
  };

  return (
    <div className="space-y-6 font-sans select-none animate-fadeIn" id="users-management-root">
      
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-3">
            <Shield className="w-6 h-6 text-blue-500" />
            User Directory & Access Authorization
          </h2>
          <p className="text-xs text-zinc-500 mt-1">
            Provision employee profiles, define security clearance ranks, suspend/activate records, and enforce credential resets.
          </p>
        </div>

        <button
          onClick={handleOpenAdd}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition duration-150 flex items-center gap-2 shadow-lg shadow-blue-900/10 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Create New User
        </button>
      </div>

      {/* Notifications banner */}
      {successMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-xs text-emerald-400 font-bold flex items-center gap-2">
          <FileCheck2 className="w-5 h-5" />
          <p>{successMsg}</p>
        </div>
      )}

      {error && !isModalOpen && !isResetOpen && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-xs text-rose-400 font-bold flex items-center gap-2 animate-pulse">
          <X className="w-5 h-5" />
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="bg-[#121214] border border-[#27272a] rounded-3xl p-12 text-center text-zinc-500 text-xs font-medium space-y-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p>Fetching security roster records...</p>
        </div>
      ) : (
        <div className="bg-[#121214] border border-[#27272a] rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#27272a] bg-[#1c1c1f]/50">
                  <th className="px-6 py-4 text-xs font-bold text-zinc-400">Legal Identity</th>
                  <th className="px-6 py-4 text-xs font-bold text-zinc-400">Username</th>
                  <th className="px-6 py-4 text-xs font-bold text-zinc-400">Email Address</th>
                  <th className="px-6 py-4 text-xs font-bold text-zinc-400">System Role</th>
                  <th className="px-6 py-4 text-xs font-bold text-zinc-400">Access Status</th>
                  <th className="px-6 py-4 text-xs font-bold text-zinc-400 text-center">Administrative Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272a]/40">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-[#1c1c1f]/20 transition duration-100">
                    <td className="px-6 py-4 text-xs font-medium text-white flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-bold shrink-0">
                        {(user.full_name || user.name || "?").substring(0, 2)}
                      </div>
                      <div>
                        <div className="font-bold text-zinc-200">{user.full_name || user.name}</div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">UID: {user.id}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-zinc-300 font-mono" dir="ltr">{user.username}</td>
                    <td className="px-6 py-4 text-xs text-zinc-300 font-mono" dir="ltr">{user.email}</td>
                    <td className="px-6 py-4 text-xs">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${getRoleBadgeColor(user.role)}`}>
                        {getRoleLabel(user.role)}
                      </span>
                      {user.department && <div className="text-[10px] text-blue-400 mt-1 font-bold">{user.department}</div>}
                    </td>
                    <td className="px-6 py-4 text-xs">
                      {user.status === "Inactive" ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700 flex items-center gap-1 w-max">
                          <UserX className="w-3 h-3" />
                          Inactive
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 w-max">
                          <UserCheck className="w-3 h-3" />
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleOpenEdit(user)}
                          className="p-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-lg transition text-xs flex items-center gap-1"
                          title="Modify Profile"
                        >
                          <Edit className="w-3.5 h-3.5" />
                          Edit
                        </button>
                        
                        <button
                          onClick={() => handleOpenReset(user)}
                          className="p-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/20 text-zinc-300 border border-zinc-700 rounded-lg transition text-xs flex items-center gap-1"
                          title="Reset Credentials"
                        >
                          <Key className="w-3.5 h-3.5" />
                          Password
                        </button>

                        <button
                          onClick={() => handleDeleteUser(user.id, user.username)}
                          disabled={user.id === currentUser.id}
                          className="p-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-rose-500/10 text-zinc-300 hover:text-rose-400 hover:border-rose-500/20 border border-zinc-700 rounded-lg transition text-xs flex items-center gap-1 disabled:opacity-30 disabled:pointer-events-none"
                          title="Permanently Drop Record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CREATE & EDIT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-[#121214] border border-[#27272a] rounded-3xl overflow-hidden shadow-2xl relative p-6 space-y-4">
            
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <h3 className="text-sm font-bold text-white">
                {editingUser ? `Edit Profile: ${editingUser.username}` : "Create New User Account"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1.5 hover:bg-zinc-800 text-zinc-400 rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 font-bold flex items-center gap-2">
                <X className="w-4 h-4 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <form onSubmit={handleSaveUser} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-zinc-400 block">Full Legal Name:</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full px-3 py-2 bg-[#1c1c1f] text-white border border-[#27272a] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-zinc-400 block">Username:</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="sales_agent"
                  className="w-full px-3 py-2 bg-[#1c1c1f] text-white border border-[#27272a] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono text-left"
                  dir="ltr"
                />
              </div>

              {!editingUser && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-400 block">Default Password:</label>
                  <input
                    type="password"
                    required={!editingUser}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 bg-[#1c1c1f] text-white border border-[#27272a] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none text-left"
                    dir="ltr"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-400 block">Privilege Clearance Level:</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="w-full px-3 py-2 bg-[#1c1c1f] text-white border border-[#27272a] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="agent">Support Agent (agent)</option>
                    <option value="leader">Team Leader (leader)</option>
                    <option value="admin">System Administrator (admin)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-400 block">Personal Record Status:</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full px-3 py-2 bg-[#1c1c1f] text-white border border-[#27272a] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-400 block">Department:</label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value as Department)}
                    className="w-full px-3 py-2 bg-[#1c1c1f] text-white border border-[#27272a] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    {DEPARTMENTS.map((d) => (<option key={d} value={d}>{d}</option>))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-400 block">Team (legacy):</label>
                  <select
                    value={team}
                    onChange={(e) => setTeam(e.target.value as Team)}
                    className="w-full px-3 py-2 bg-[#1c1c1f] text-white border border-[#27272a] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    {TEAMS.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-[#27272a] flex items-center justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESET PASSWORD MODAL */}
      {isResetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans">
          <div className="w-full max-w-sm bg-[#121214] border border-[#27272a] rounded-3xl overflow-hidden shadow-2xl relative p-6 space-y-4">
            
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                Change Password credentials: {resettingUser?.username}
              </h3>
              <button onClick={() => setIsResetOpen(false)} className="p-1.5 hover:bg-zinc-800 text-zinc-400 rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 font-bold flex items-center gap-2">
                <X className="w-4 h-4 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-zinc-400 block">Specified Pass-Credential:</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Type a highly secure complex phrase"
                  className="w-full px-3 py-2.5 bg-[#1c1c1f] text-white border border-[#27272a] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none text-left"
                  dir="ltr"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setIsResetOpen(false)}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-[#0f0f10] font-extrabold rounded-xl transition"
                >
                  Enforce Reset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
